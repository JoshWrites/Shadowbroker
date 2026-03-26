"""Ukraine air raid / artillery alert fetcher.

Polls alerts.in.ua every 30 seconds for oblast-level active alerts.
Requires UKRAINE_ALERTS_TOKEN environment variable.

All alerts are persisted to SQLite at /app/data/ukraine_alerts.db (Docker volume)
for historical time-scrubbing via the /api/ukraine-alerts/history endpoint.

API: https://api.alerts.in.ua/v1/alerts/active.json
     Authorization: Bearer <token>
"""
import json
import logging
import os
import sqlite3
import threading
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from services.fetchers._store import latest_data, _data_lock, _mark_fresh
from services.network_utils import fetch_with_curl

logger = logging.getLogger(__name__)

_DB_PATH = Path("/app/data/ukraine_alerts.db")
_ACTIVE_URL = "https://api.alerts.in.ua/v1/alerts/active.json"

# Alert type → human label + color
ALERT_TYPES = {
    "AIR":          {"label": "Air Raid",       "color": "#ff2222"},
    "ARTILLERY":    {"label": "Artillery",       "color": "#ff8800"},
    "URBAN_FIGHTS": {"label": "Urban Combat",   "color": "#ff0055"},
    "CHEMICAL":     {"label": "Chemical Threat","color": "#aa44ff"},
    "NUCLEAR":      {"label": "Nuclear Threat", "color": "#ff00aa"},
    "MISSILE":      {"label": "Missile Strike", "color": "#ff4400"},
    "UNKNOWN":      {"label": "Alert",          "color": "#ffdd00"},
}

# Oblast region IDs → name + approximate centre lat/lng
OBLAST_GEO = {
    1:  {"name": "Vinnytsia Oblast",      "lat": 49.2328, "lng": 28.4682},
    2:  {"name": "Volyn Oblast",          "lat": 50.7472, "lng": 25.3254},
    3:  {"name": "Dnipropetrovsk Oblast", "lat": 48.4647, "lng": 35.0462},
    4:  {"name": "Donetsk Oblast",        "lat": 48.0159, "lng": 37.8028},
    5:  {"name": "Zhytomyr Oblast",       "lat": 50.2549, "lng": 28.6587},
    6:  {"name": "Zakarpattia Oblast",    "lat": 48.6208, "lng": 22.2879},
    7:  {"name": "Zaporizhzhia Oblast",   "lat": 47.8388, "lng": 35.1396},
    8:  {"name": "Ivano-Frankivsk Oblast","lat": 48.9226, "lng": 24.7111},
    9:  {"name": "Kyiv Oblast",           "lat": 50.5330, "lng": 30.6671},
    10: {"name": "Kirovohrad Oblast",     "lat": 48.5132, "lng": 32.2597},
    11: {"name": "Luhansk Oblast",        "lat": 48.5740, "lng": 39.3078},
    12: {"name": "Lviv Oblast",           "lat": 49.8397, "lng": 24.0297},
    13: {"name": "Mykolaiv Oblast",       "lat": 46.9750, "lng": 31.9946},
    14: {"name": "Odesa Oblast",          "lat": 46.4825, "lng": 30.7233},
    15: {"name": "Poltava Oblast",        "lat": 49.5883, "lng": 34.5514},
    16: {"name": "Rivne Oblast",          "lat": 50.6199, "lng": 26.2516},
    17: {"name": "Sumy Oblast",           "lat": 50.9077, "lng": 34.7981},
    18: {"name": "Ternopil Oblast",       "lat": 49.5535, "lng": 25.5948},
    19: {"name": "Kharkiv Oblast",        "lat": 49.9935, "lng": 36.2304},
    20: {"name": "Kherson Oblast",        "lat": 46.6354, "lng": 32.6169},
    21: {"name": "Khmelnytskyi Oblast",   "lat": 49.4220, "lng": 26.9987},
    22: {"name": "Cherkasy Oblast",       "lat": 49.4444, "lng": 32.0598},
    23: {"name": "Chernivtsi Oblast",     "lat": 48.2916, "lng": 25.9352},
    24: {"name": "Chernihiv Oblast",      "lat": 51.4982, "lng": 31.2893},
    25: {"name": "Kyiv City",             "lat": 50.4501, "lng": 30.5234},
}

# ---------------------------------------------------------------------------
# SQLite persistence
# ---------------------------------------------------------------------------

_db_lock = threading.Lock()


def init_ukraine_db():
    """Create the alerts table if it doesn't exist. Safe to call multiple times."""
    try:
        _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _db_lock:
            conn = sqlite3.connect(_DB_PATH)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS alerts (
                    id          TEXT PRIMARY KEY,
                    region      TEXT NOT NULL,
                    region_id   INTEGER,
                    lat         REAL,
                    lng         REAL,
                    type        TEXT,
                    type_label  TEXT,
                    color       TEXT,
                    timestamp   TEXT NOT NULL,
                    ts          REAL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_ts ON alerts (ts)")
            conn.commit()
            conn.close()
        logger.info(f"Ukraine alerts: DB ready at {_DB_PATH}")
    except Exception as e:
        logger.error(f"Ukraine alerts: DB init error: {e}")


def _persist_alerts(records: list[dict]):
    if not records:
        return
    try:
        with _db_lock:
            conn = sqlite3.connect(_DB_PATH)
            conn.executemany(
                """INSERT OR IGNORE INTO alerts
                   (id, region, region_id, lat, lng, type, type_label, color, timestamp, ts)
                   VALUES (:id, :region, :region_id, :lat, :lng, :type, :type_label, :color, :timestamp, :ts)""",
                records,
            )
            conn.commit()
            conn.close()
    except Exception as e:
        logger.error(f"Ukraine alerts: DB persist error: {e}")


def query_ukraine_alerts(from_ts: float, until_ts: float) -> list[dict]:
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
        logger.error(f"Ukraine alerts: DB query error: {e}")
        return []


def get_ukraine_db_time_range() -> dict:
    try:
        with _db_lock:
            conn = sqlite3.connect(_DB_PATH)
            row = conn.execute(
                "SELECT MIN(ts), MAX(ts), COUNT(*) FROM alerts WHERE ts IS NOT NULL"
            ).fetchone()
            conn.close()
        if row and row[2]:
            return {"earliest": row[0], "latest": row[1], "count": row[2]}
    except Exception as e:
        logger.error(f"Ukraine alerts: DB range error: {e}")
    return {"earliest": None, "latest": None, "count": 0}


# ---------------------------------------------------------------------------
# In-memory ring buffer
# ---------------------------------------------------------------------------

_alert_ring: deque = deque(maxlen=500)
_ring_lock = threading.Lock()
_seen_ids: set = set()


def _add_to_ring(records: list[dict]):
    with _ring_lock:
        for r in records:
            rid = r.get("id", "")
            if rid and rid not in _seen_ids:
                _seen_ids.add(rid)
                _alert_ring.appendleft(dict(r))
        if len(_seen_ids) > 20000:
            _seen_ids.clear()


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def _parse_active(raw: list) -> list[dict]:
    now = datetime.now(timezone.utc)
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%S")
    now_ts = now.timestamp()
    records = []
    for alert in raw:
        region_id = alert.get("regionId") or alert.get("region_id")
        alert_type = (alert.get("type") or "UNKNOWN").upper()
        if not region_id:
            continue
        geo = OBLAST_GEO.get(int(region_id))
        if not geo:
            continue
        type_info = ALERT_TYPES.get(alert_type, ALERT_TYPES["UNKNOWN"])
        alerted_at = alert.get("alertedAt") or alert.get("alerted_at") or now_iso
        try:
            alert_ts = datetime.strptime(alerted_at[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
        except (ValueError, TypeError):
            alert_ts = now_ts
        fid = f"ua-{region_id}-{alert_type}-{int(alert_ts)}"
        records.append({
            "id": fid,
            "region": geo["name"],
            "region_id": int(region_id),
            "lat": geo["lat"],
            "lng": geo["lng"],
            "type": alert_type,
            "type_label": type_info["label"],
            "color": type_info["color"],
            "timestamp": alerted_at,
            "ts": alert_ts,
            "active": True,
        })
    return records


# ---------------------------------------------------------------------------
# Public fetch function (called by scheduler)
# ---------------------------------------------------------------------------

def fetch_ukraine_alerts():
    """Poll for active Ukraine alerts every 30 seconds.

    Two modes:
      1. Direct API polling if UKRAINE_ALERTS_TOKEN is set.
      2. Pull from LXC 110 listener API if UKRAINE_LISTENER_URL (or LISTENER_URL) is set.
    At least one must be configured for this layer to show data.
    """
    token = os.environ.get("UKRAINE_ALERTS_TOKEN", "").strip()
    active_records = []

    if token:
        # Mode 1: Direct API polling
        try:
            headers = {
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
            }
            resp = fetch_with_curl(_ACTIVE_URL, timeout=10, headers=headers)
            if resp.status_code == 200:
                raw = resp.json()
                alerts_list = raw if isinstance(raw, list) else raw.get("alerts", [])
                active_records = _parse_active(alerts_list)
                if active_records:
                    logger.info(f"Ukraine alerts ACTIVE: {len(active_records)} oblasts")
                    _add_to_ring(active_records)
                    _persist_alerts(active_records)
        except Exception as e:
            logger.error(f"Ukraine alerts fetch error: {e}")
    else:
        # Mode 2: Pull recent alerts from the listener API
        active_records = _fetch_from_listener()

    with _ring_lock:
        ring_list = list(_alert_ring)

    active_ids = {r["id"] for r in active_records}
    historical = [r for r in ring_list if r["id"] not in active_ids]
    combined = active_records + [dict(r, active=False) for r in historical]

    with _data_lock:
        latest_data["ukraine_alerts"] = combined

    _mark_fresh("ukraine_alerts")


def _fetch_from_listener() -> list[dict]:
    """Fetch the last 60 minutes of alerts from the Ukraine listener API."""
    import time as _time
    import urllib.request

    listener_url = (os.environ.get("UKRAINE_LISTENER_URL") or os.environ.get("LISTENER_URL", "")).rstrip("/")
    if not listener_url:
        return []

    try:
        now = _time.time()
        from_ts = now - 3600  # last 60 minutes
        url = f"{listener_url}/backfill/ukraine_alerts?from_ts={from_ts}&until_ts={now}"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status != 200:
                return []
            payload = json.loads(resp.read().decode())

        records = payload.get("records", [])
        parsed = []
        for r in records:
            p = r.get("payload", r)
            region_id = p.get("region_id")
            geo = OBLAST_GEO.get(int(region_id)) if region_id else None
            alert_type = (p.get("type") or "UNKNOWN").upper()
            type_info = ALERT_TYPES.get(alert_type, ALERT_TYPES["UNKNOWN"])
            fid = r.get("id") or f"ua-{region_id}-{alert_type}-{int(r.get('ts', 0))}"
            rec = {
                "id": fid,
                "region": p.get("region") or (geo["name"] if geo else "Unknown"),
                "region_id": int(region_id) if region_id else None,
                "lat": r.get("lat") or (geo["lat"] if geo else None),
                "lng": r.get("lng") or (geo["lng"] if geo else None),
                "type": alert_type,
                "type_label": p.get("type_label") or type_info["label"],
                "color": p.get("color") or type_info["color"],
                "timestamp": p.get("timestamp", ""),
                "ts": r.get("ts"),
                "active": p.get("active", False),
            }
            parsed.append(rec)
        if parsed:
            _add_to_ring(parsed)
            _persist_alerts(parsed)
            logger.info(f"Ukraine alerts from listener: {len(parsed)} records")
        return [r for r in parsed if r.get("active")]
    except Exception as e:
        logger.warning(f"Ukraine alerts listener fetch: {e}")
        return []


# ---------------------------------------------------------------------------
# Backfill from listener (optional, non-breaking)
# ---------------------------------------------------------------------------

def backfill_ukraine_from_listener():
    """Fetch missing Ukraine alerts from the Signal Archive listener on startup.

    Gated on LISTENER_URL env var. No-op if unset or listener unreachable.
    Paginates in 7-day chunks — no time limit.
    """
    import time as _time
    import urllib.request

    listener_url = (os.environ.get("UKRAINE_LISTENER_URL") or os.environ.get("LISTENER_URL", "")).rstrip("/")
    if not listener_url:
        return

    try:
        range_req = urllib.request.Request(
            f"{listener_url}/range/ukraine_alerts",
            headers={"Accept": "application/json"},
        )
        with urllib.request.urlopen(range_req, timeout=10) as resp:
            if resp.status != 200:
                logger.warning(f"Ukraine backfill: range check returned HTTP {resp.status}")
                return
            listener_range = json.loads(resp.read().decode())

        listener_earliest = listener_range.get("earliest")
        if not listener_earliest:
            logger.info("Ukraine backfill: listener has no data yet")
            return

        local_range = get_ukraine_db_time_range()
        from_ts = local_range["latest"] if local_range["latest"] else listener_earliest
        until_ts = _time.time()

        if from_ts >= until_ts:
            logger.info("Ukraine backfill: already up to date")
            return

        _CHUNK = 7 * 24 * 3600
        total_inserted = 0
        chunk_start = from_ts

        while chunk_start < until_ts:
            chunk_end = min(chunk_start + _CHUNK, until_ts)
            url = f"{listener_url}/backfill/ukraine_alerts?from_ts={chunk_start}&until_ts={chunk_end}"
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status != 200:
                    logger.warning(f"Ukraine backfill: chunk returned HTTP {resp.status}")
                    break
                payload = json.loads(resp.read().decode())

            records = payload.get("records", payload) if isinstance(payload, dict) else payload
            if records:
                to_persist = []
                for r in records:
                    p = r.get("payload", r)
                    region_id = p.get("region_id")
                    geo = OBLAST_GEO.get(int(region_id)) if region_id else None
                    alert_type = (p.get("type") or "UNKNOWN").upper()
                    type_info = ALERT_TYPES.get(alert_type, ALERT_TYPES["UNKNOWN"])
                    fid = r.get("id") or f"ua-backfill-{region_id}-{r.get('ts', 0)}"
                    to_persist.append({
                        "id": fid,
                        "region": p.get("region") or (geo["name"] if geo else "Unknown"),
                        "region_id": int(region_id) if region_id else None,
                        "lat": r.get("lat") or (geo["lat"] if geo else None),
                        "lng": r.get("lng") or (geo["lng"] if geo else None),
                        "type": alert_type,
                        "type_label": p.get("type_label") or type_info["label"],
                        "color": p.get("color") or type_info["color"],
                        "timestamp": p.get("timestamp", ""),
                        "ts": r.get("ts"),
                    })
                if to_persist:
                    _persist_alerts(to_persist)
                    total_inserted += len(to_persist)

            chunk_start = chunk_end

        if total_inserted:
            logger.info(f"Ukraine backfill: inserted {total_inserted} records from listener")
        else:
            logger.info("Ukraine backfill: no new records from listener")

    except Exception as e:
        logger.warning(f"Ukraine backfill: skipped — {e}")
