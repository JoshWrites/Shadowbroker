"""Pikud HaOref (Israel Home Front Command) real-time rocket/missile alert fetcher.

Polls the official Oref API every 5 seconds (via a dedicated scheduler job in data_fetcher.py).
City names in active alerts are resolved to lat/lon using the LAMAS geodata JSON.
All alerts are persisted to SQLite at /app/data/pikud_alerts.db (Docker volume) for
historical time-scrubbing via the /api/pikud-alerts/history endpoint.

Endpoints:
  Live alerts:  https://www.oref.org.il/WarningMessages/alert/alerts.json
  History:      https://www.oref.org.il/WarningMessages/alert/History/AlertsHistory.json
  LAMAS data:   https://raw.githubusercontent.com/idodov/RedAlert/main/apps/red_alerts_israel/lamas_data.json

The live endpoint returns an empty body when no alert is active (NOT valid JSON).
When active, returns: {"id": "...", "cat": "1", "title": "...", "desc": "...", "data": ["city1", ...]}
"""
import json
import logging
import sqlite3
import threading
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from services.fetchers._store import latest_data, _data_lock, _mark_fresh
from services.network_utils import fetch_with_curl

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_OREF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.oref.org.il/",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json",
    "Accept-Language": "he,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}

_LIVE_URL = "https://www.oref.org.il/WarningMessages/alert/alerts.json"
_HISTORY_URL = "https://www.oref.org.il/WarningMessages/alert/History/AlertsHistory.json"
_LAMAS_URL = "https://raw.githubusercontent.com/idodov/RedAlert/main/apps/red_alerts_israel/lamas_data.json"

# SQLite on the persistent Docker volume (/app/data is mounted as backend_data)
_DB_PATH = Path("/app/data/pikud_alerts.db")

ALERT_CATEGORIES = {
    "1": "Rockets / Missiles",
    "2": "Unauthorized Aircraft",
    "3": "Seismic Event",
    "4": "Tsunami",
    "5": "Hazardous Materials",
    "6": "Terrorist Incursion",
    "7": "Projectile Fire",
    "8": "Unidentified Vessel",
    "9": "Chemical Emergency",
    "13": "Pre-Alert / Special Update",
    "14": "Non-Conventional Threat",
}

ALERT_COLORS = {
    "1": "#ff2222",
    "2": "#ff8800",
    "3": "#ffdd00",
    "4": "#0088ff",
    "5": "#aa44ff",
    "6": "#ff0055",
    "7": "#ff4400",
    "8": "#00ccff",
    "9": "#44ff88",
    "13": "#ffaa00",
    "14": "#ff00aa",
}

# ---------------------------------------------------------------------------
# LAMAS geodata (city name → lat/lng)
# ---------------------------------------------------------------------------

_lamas_lock = threading.Lock()
_lamas_data: dict[str, dict] = {}
_lamas_loaded = False
_lamas_last_attempt: float = 0.0
_LAMAS_RETRY_INTERVAL = 60  # seconds between retries on failure


def _load_lamas():
    global _lamas_data, _lamas_loaded, _lamas_last_attempt
    import time as _time
    with _lamas_lock:
        if _lamas_loaded:
            return
        if _time.time() - _lamas_last_attempt < _LAMAS_RETRY_INTERVAL:
            return
        _lamas_last_attempt = _time.time()
        try:
            resp = fetch_with_curl(_LAMAS_URL, timeout=20)
            if resp.status_code == 200:
                raw = resp.json()
                # Format: {"areas": {"region_name": {"city_name": {"lat": ..., "long": ...}}}}
                areas = raw.get("areas", {}) if isinstance(raw, dict) else {}
                for area_name, cities in areas.items():
                    if not isinstance(cities, dict):
                        continue
                    for city_name, coords in cities.items():
                        if not isinstance(coords, dict):
                            continue
                        lat = coords.get("lat")
                        lng = coords.get("long") or coords.get("lng") or coords.get("lon")
                        if lat is not None and lng is not None:
                            _lamas_data[city_name] = {"lat": float(lat), "lng": float(lng), "area": area_name}
                _lamas_loaded = True
                logger.info(f"Pikud HaOref: loaded {len(_lamas_data)} LAMAS locations")
            else:
                logger.error(f"Pikud HaOref: LAMAS fetch failed HTTP {resp.status_code}")
        except Exception as e:
            logger.error(f"Pikud HaOref: LAMAS load error: {e}")


def _resolve_city(city_name: str) -> dict | None:
    with _lamas_lock:
        return _lamas_data.get(city_name)


# ---------------------------------------------------------------------------
# SQLite persistence
# ---------------------------------------------------------------------------

_db_lock = threading.Lock()


def init_pikud_db():
    """Create the alerts table if it doesn't exist. Safe to call multiple times.
    Also runs a migration to add the `ts` column to existing DBs if missing.
    """
    try:
        _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _db_lock:
            conn = sqlite3.connect(_DB_PATH)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS alerts (
                    id          TEXT PRIMARY KEY,
                    city        TEXT NOT NULL,
                    area        TEXT,
                    lat         REAL,
                    lng         REAL,
                    cat         TEXT,
                    cat_label   TEXT,
                    title       TEXT,
                    desc        TEXT,
                    color       TEXT,
                    timestamp   TEXT NOT NULL,
                    ts          REAL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_timestamp ON alerts (timestamp)")
            conn.commit()
            # Migration: add ts column to existing DBs that predate this field
            # Must run BEFORE creating idx_ts — ALTER TABLE must precede the index
            cols = [r[1] for r in conn.execute("PRAGMA table_info(alerts)").fetchall()]
            if "ts" not in cols:
                conn.execute("ALTER TABLE alerts ADD COLUMN ts REAL")
                logger.info("Pikud HaOref: migrated DB — added ts column")
                conn.commit()
            conn.execute("CREATE INDEX IF NOT EXISTS idx_ts ON alerts (ts)")
            # Backfill ts for any rows where it's NULL (from old schema)
            conn.execute("""
                UPDATE alerts SET ts = CAST(strftime('%s', substr(timestamp, 1, 19)) AS REAL)
                WHERE ts IS NULL AND timestamp IS NOT NULL
            """)
            conn.commit()
            conn.close()
        logger.info(f"Pikud HaOref: DB ready at {_DB_PATH}")
    except Exception as e:
        logger.error(f"Pikud HaOref: DB init error: {e}")


def _persist_alerts(features: list[dict]):
    """Insert new alert records into SQLite, ignoring duplicates."""
    if not features:
        return
    try:
        with _db_lock:
            conn = sqlite3.connect(_DB_PATH)
            conn.executemany(
                """INSERT OR IGNORE INTO alerts
                   (id, city, area, lat, lng, cat, cat_label, title, desc, color, timestamp, ts)
                   VALUES (:id, :city, :area, :lat, :lng, :cat, :cat_label, :title, :desc, :color, :timestamp, :ts)""",
                features,
            )
            conn.commit()
            conn.close()
    except Exception as e:
        logger.error(f"Pikud HaOref: DB persist error: {e}")


def query_alerts(from_ts: float, until_ts: float) -> list[dict]:
    """Return all alerts with ts between from_ts and until_ts (Unix epoch floats)."""
    try:
        with _db_lock:
            conn = sqlite3.connect(_DB_PATH)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM alerts WHERE ts >= ? AND ts <= ? ORDER BY ts DESC",
                (from_ts, until_ts),
            ).fetchall()
            conn.close()
        return [dict(r) for r in rows]
    except Exception as e:
        logger.error(f"Pikud HaOref: DB query error: {e}")
        return []


def get_db_time_range() -> dict:
    """Return the earliest and latest Unix timestamps in the DB."""
    try:
        with _db_lock:
            conn = sqlite3.connect(_DB_PATH)
            row = conn.execute("SELECT MIN(ts), MAX(ts), COUNT(*) FROM alerts WHERE ts IS NOT NULL").fetchone()
            conn.close()
        if row and row[2]:
            return {"earliest": row[0], "latest": row[1], "count": row[2]}
    except Exception as e:
        logger.error(f"Pikud HaOref: DB range error: {e}")
    return {"earliest": None, "latest": None, "count": 0}


# ---------------------------------------------------------------------------
# In-memory ring buffer (for live fast endpoint — no DB round-trip)
# ---------------------------------------------------------------------------

_alert_ring: deque = deque(maxlen=200)
_ring_lock = threading.Lock()
_seen_ids: set = set()


def _add_to_ring(features: list[dict]):
    with _ring_lock:
        for f in features:
            fid = f.get("id", "")
            if fid and fid not in _seen_ids:
                _seen_ids.add(fid)
                _alert_ring.appendleft(dict(f))
        if len(_seen_ids) > 10000:
            _seen_ids.clear()


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def _parse_live_alert(resp) -> list[dict]:
    text = resp.text.strip() if hasattr(resp, "text") else ""
    if not text:
        return []
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return []
    if not isinstance(data, dict):
        return []
    cities = data.get("data", [])
    if not cities:
        return []

    alert_id = data.get("id", "")
    cat = str(data.get("cat") or data.get("category") or "1")
    title = data.get("title", "")
    desc = data.get("desc", "")
    color = ALERT_COLORS.get(cat, "#ff2222")
    cat_label = ALERT_CATEGORIES.get(cat, f"Category {cat}")
    now = datetime.now(timezone.utc)
    now_iso = now.strftime("%Y-%m-%d %H:%M:%S")
    now_ts = now.timestamp()

    features = []
    for city in cities:
        geo = _resolve_city(city)
        features.append({
            "id": f"{alert_id}-{city}",
            "lat": geo["lat"] if geo else None,
            "lng": geo["lng"] if geo else None,
            "city": city,
            "area": geo.get("area", "") if geo else "",
            "cat": cat,
            "cat_label": cat_label,
            "title": title,
            "desc": desc,
            "color": color,
            "active": True,
            "timestamp": now_iso,
            "ts": now_ts,
        })
    return features


# ---------------------------------------------------------------------------
# Public fetch functions (called by scheduler)
# ---------------------------------------------------------------------------

def fetch_pikud_haoref():
    """Poll the live alerts endpoint every 5 seconds."""
    if not _lamas_loaded:
        _load_lamas()

    active_features = []
    try:
        resp = fetch_with_curl(_LIVE_URL, timeout=8, headers=_OREF_HEADERS)
        if resp.status_code == 200:
            active_features = _parse_live_alert(resp)
            if active_features:
                logger.info(f"Pikud HaOref ACTIVE: {len(active_features)} cities, cat={active_features[0]['cat']}")
                _add_to_ring(active_features)
                _persist_alerts([f for f in active_features if f.get("lat") is not None])
    except Exception as e:
        logger.error(f"Pikud HaOref live fetch error: {e}")

    # Build live payload: active alerts + recent ring buffer
    with _ring_lock:
        ring_list = [dict(f, active=False) for f in _alert_ring]

    active_ids = {f["id"] for f in active_features}
    historical = [f for f in ring_list if f["id"] not in active_ids]
    combined = [f for f in (active_features + historical) if f.get("lat") is not None]

    with _data_lock:
        latest_data["pikud_alerts"] = combined

    if combined or active_features:
        _mark_fresh("pikud_alerts")


def fetch_pikud_history():
    """Fetch 24h alert history from Oref API and persist to DB. Called at startup + every 30min."""
    if not _lamas_loaded:
        _load_lamas()

    try:
        resp = fetch_with_curl(_HISTORY_URL, timeout=15, headers=_OREF_HEADERS)
        if resp.status_code != 200:
            return
        text = resp.text.strip()
        if not text:
            return
        history = json.loads(text)
        if not isinstance(history, list):
            return

        to_persist = []
        for entry in history:
            city = entry.get("data", "")
            title = entry.get("title", "")
            alert_date = entry.get("alertDate", "")
            cat = str(entry.get("cat") or entry.get("category") or "1")
            if not city or not alert_date:
                continue
            geo = _resolve_city(city)
            if geo is None:
                continue
            color = ALERT_COLORS.get(cat, "#ff2222")
            cat_label = ALERT_CATEGORIES.get(cat, f"Category {cat}")
            fid = f"hist-{alert_date}-{city}"
            # Parse alertDate to Unix epoch — format is "YYYY-MM-DD HH:MM:SS"
            try:
                alert_ts = datetime.strptime(alert_date[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
            except (ValueError, TypeError):
                alert_ts = None
            to_persist.append({
                "id": fid,
                "lat": geo["lat"],
                "lng": geo["lng"],
                "city": city,
                "area": geo.get("area", ""),
                "cat": cat,
                "cat_label": cat_label,
                "title": title,
                "desc": "",
                "color": color,
                "active": False,
                "timestamp": alert_date,
                "ts": alert_ts,
            })

        if to_persist:
            _persist_alerts(to_persist)
            _add_to_ring(to_persist)
            logger.info(f"Pikud HaOref: persisted {len(to_persist)} historical alerts")

        # Refresh live store from ring buffer
        with _ring_lock:
            ring_list = [dict(f, active=False) for f in _alert_ring]
        combined = [f for f in ring_list if f.get("lat") is not None]
        with _data_lock:
            latest_data["pikud_alerts"] = combined
        if combined:
            _mark_fresh("pikud_alerts")

    except Exception as e:
        logger.error(f"Pikud HaOref history fetch error: {e}")
