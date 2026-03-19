"""Israel alert ingestion via Tzofar WebSocket push feed.

Connects to wss://ws.tzevaadom.co.il/socket?platform=ANDROID and receives
real-time ALERT and SYSTEM_MESSAGE events. Every inbound event is stored
in the unified `pikud_alerts` table — one flat row per city for ALERTs,
one row per SYSTEM_MESSAGE.

On startup, _backfill_gap() checks for a gap between the last recorded event
and now. Priority: (1) Signal Archive listener, (2) Oref history API.

City names are resolved to lat/lon via the LAMAS geodata JSON from GitHub.

DB: /app/data/pikud_alerts.db (Docker volume — persists across restarts)
  - pikud_alerts: unified table for all signal types
"""
import json
import logging
import sqlite3
import threading
import time as _time_mod
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from services.fetchers._store import latest_data, _data_lock, _mark_fresh
from services.network_utils import fetch_with_curl

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_LAMAS_URL = "https://raw.githubusercontent.com/idodov/RedAlert/main/apps/red_alerts_israel/lamas_data.json"

# SQLite on the persistent Docker volume (/app/data is mounted as backend_data)
_DB_PATH = Path("/app/data/pikud_alerts.db")

ALERT_CATEGORIES = {
    "1": "Rockets / Missiles",
    "2": "Hostile Aircraft Intrusion (UAV)",
    "3": "Seismic Event",
    "4": "Tsunami",
    "5": "Hostile Aircraft Intrusion (UAV)",
    "6": "Terrorist Incursion",
    "7": "Projectile Fire",
    "8": "Unidentified Vessel",
    "9": "Hazardous Materials",
    "10": "Chemical Emergency",
    "13": "Pre-Alert / Special Update",
    "14": "Non-Conventional Threat",
}

ALERT_COLORS = {
    "1": "#ff2222",     # Rockets — red
    "2": "#ff8800",     # UAV — orange
    "3": "#ffdd00",     # Seismic — yellow
    "4": "#0088ff",     # Tsunami — blue
    "5": "#ff8800",     # UAV — orange (same as cat 2)
    "6": "#ff0055",     # Terror — hot pink
    "7": "#ff4400",     # Projectile — red-orange
    "8": "#00ccff",     # Vessel — cyan
    "9": "#aa44ff",     # Hazmat — purple
    "10": "#44ff88",    # Chemical — green
    "13": "#ffaa00",    # Pre-alert — amber
    "14": "#ff00aa",    # Non-conventional — magenta
}

# Tzofar threat IDs (int) → Oref-compatible cat strings
_TZOFAR_THREAT_TO_CAT = {
    0: "1",   # Rockets / Missiles
    1: "1",   # Rockets / Missiles (variant)
    2: "2",   # Hostile Aircraft Intrusion (UAV)
    3: "3",   # Seismic Event
    4: "4",   # Tsunami
    5: "5",   # Hostile Aircraft Intrusion (UAV)
    6: "6",   # Terrorist Incursion
    7: "7",   # Projectile Fire
    8: "8",   # Unidentified Vessel
    9: "9",   # Hazardous Materials
    10: "10", # Chemical Emergency
    13: "13", # Pre-Alert / Special Update
    14: "14", # Non-Conventional Threat
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
                logger.info(f"LAMAS: loaded {len(_lamas_data)} city locations")
            else:
                logger.error(f"LAMAS: fetch failed HTTP {resp.status_code}")
        except Exception as e:
            logger.error(f"LAMAS: load error: {e}")


def _resolve_city(city_name: str) -> dict | None:
    with _lamas_lock:
        return _lamas_data.get(city_name)


# ---------------------------------------------------------------------------
# SQLite persistence — unified pikud_alerts table
# ---------------------------------------------------------------------------

_db_lock = threading.Lock()

_PIKUD_COLS = [
    "id", "source", "ts", "timestamp", "lat", "lng", "city", "area",
    "msg_type", "cat", "cat_label", "threat", "color", "notification_id",
    "is_drill", "instruction", "instruction_type",
    "title", "title_he", "title_en", "title_ar", "title_ru", "title_es",
    "body_he", "body_en", "body_ar", "body_ru", "body_es",
    "cities_json", "areas_ids_json", "cities_ids_json", "pin_until",
    "oref_rid", "oref_category_desc", "raw_json",
]


def init_pikud_db():
    """Create the unified pikud_alerts table, migrating from old schema if needed."""
    try:
        _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _db_lock:
            conn = sqlite3.connect(_DB_PATH)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS pikud_alerts (
                    id                TEXT PRIMARY KEY,
                    source            TEXT NOT NULL,
                    ts                REAL NOT NULL,
                    timestamp         TEXT NOT NULL,
                    lat               REAL,
                    lng               REAL,
                    city              TEXT,
                    area              TEXT,
                    msg_type          TEXT NOT NULL DEFAULT 'ALERT',
                    cat               TEXT,
                    cat_label         TEXT,
                    threat            INTEGER,
                    color             TEXT,
                    notification_id   TEXT,
                    is_drill          INTEGER,
                    instruction       INTEGER,
                    instruction_type  INTEGER,
                    title             TEXT,
                    title_he          TEXT,
                    title_en          TEXT,
                    title_ar          TEXT,
                    title_ru          TEXT,
                    title_es          TEXT,
                    body_he           TEXT,
                    body_en           TEXT,
                    body_ar           TEXT,
                    body_ru           TEXT,
                    body_es           TEXT,
                    cities_json       TEXT,
                    areas_ids_json    TEXT,
                    cities_ids_json   TEXT,
                    pin_until         REAL,
                    oref_rid          INTEGER,
                    oref_category_desc TEXT,
                    raw_json          TEXT,
                    inserted_at       REAL NOT NULL DEFAULT (strftime('%s', 'now'))
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_pikud_ts ON pikud_alerts (ts)")
            conn.execute("""CREATE INDEX IF NOT EXISTS idx_pikud_notification
                            ON pikud_alerts (notification_id)
                            WHERE notification_id IS NOT NULL""")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_pikud_msg_type ON pikud_alerts (msg_type)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_pikud_inserted ON pikud_alerts (inserted_at)")
            conn.commit()

            # --- Migrate from old tables if they exist ---
            tables = {r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()}

            # Migrate old `alerts` table → pikud_alerts
            if "alerts" in tables:
                migrated = 0
                conn.row_factory = sqlite3.Row
                old_rows = conn.execute("SELECT * FROM alerts").fetchall()
                conn.row_factory = None
                for r in old_rows:
                    rd = dict(r)
                    try:
                        conn.execute(
                            """INSERT OR IGNORE INTO pikud_alerts
                               (id, source, ts, timestamp, lat, lng, city, area,
                                msg_type, cat, cat_label, threat, color, notification_id,
                                is_drill, title)
                               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                            (
                                rd.get("id"),
                                "tzofar_ws" if str(rd.get("id", "")).startswith("tz-") else "oref_history",
                                rd.get("ts") or 0,
                                rd.get("timestamp", ""),
                                rd.get("lat"), rd.get("lng"),
                                rd.get("city"), rd.get("area"),
                                rd.get("msg_type", "ALERT"),
                                rd.get("cat"), rd.get("cat_label"),
                                rd.get("threat"), rd.get("color"),
                                rd.get("notification_id"),
                                rd.get("is_drill"),
                                rd.get("title"),
                            ),
                        )
                        migrated += conn.execute("SELECT changes()").fetchone()[0]
                    except Exception as ex:
                        logger.debug(f"Pikud DB: alerts migration skip: {ex}")
                conn.commit()
                if migrated:
                    logger.info(f"Pikud DB: migrated {migrated} rows from alerts → pikud_alerts")
                conn.execute("DROP TABLE alerts")
                conn.commit()
                logger.info("Pikud DB: dropped old alerts table")

            # Migrate old `tzofar_events` SYSTEM_MESSAGE rows → pikud_alerts
            if "tzofar_events" in tables:
                migrated = 0
                conn.row_factory = sqlite3.Row
                sys_rows = conn.execute(
                    "SELECT * FROM tzofar_events WHERE msg_type = 'SYSTEM_MESSAGE'"
                ).fetchall()
                conn.row_factory = None
                for r in sys_rows:
                    rd = dict(r)
                    try:
                        fid = f"tz-sys-{rd.get('notification_id', '')}-{int(rd.get('ts', 0))}"
                        conn.execute(
                            """INSERT OR IGNORE INTO pikud_alerts
                               (id, source, ts, timestamp, msg_type,
                                notification_id, instruction, instruction_type,
                                title_he, title_en, title_ar, title_ru, title_es,
                                body_he, body_en, body_ar, body_ru, body_es,
                                cities_json, areas_ids_json, cities_ids_json,
                                pin_until, raw_json)
                               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                            (
                                fid,
                                "tzofar_ws",
                                rd.get("ts", 0),
                                rd.get("timestamp", ""),
                                "SYSTEM_MESSAGE",
                                rd.get("notification_id"),
                                rd.get("instruction"),
                                rd.get("instruction_type"),
                                rd.get("title_he"), rd.get("title_en"),
                                rd.get("title_ar"), rd.get("title_ru"), rd.get("title_es"),
                                rd.get("body_he"), rd.get("body_en"),
                                rd.get("body_ar"), rd.get("body_ru"), rd.get("body_es"),
                                rd.get("cities_json"), rd.get("areas_ids_json"),
                                rd.get("cities_ids_json"),
                                rd.get("pin_until"),
                                rd.get("raw_json"),
                            ),
                        )
                        migrated += conn.execute("SELECT changes()").fetchone()[0]
                    except Exception as ex:
                        logger.debug(f"Pikud DB: tzofar_events migration skip: {ex}")
                conn.commit()
                if migrated:
                    logger.info(f"Pikud DB: migrated {migrated} SYSTEM_MESSAGE rows from tzofar_events → pikud_alerts")
                conn.execute("DROP TABLE tzofar_events")
                conn.commit()
                logger.info("Pikud DB: dropped old tzofar_events table")

            conn.close()
        logger.info(f"Pikud DB: ready at {_DB_PATH}")
    except Exception as e:
        logger.error(f"Pikud DB: init error: {e}")


def _safe_float(val) -> float | None:
    """Convert to float without raising. Returns None on any failure."""
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _safe_int(val, default: int = 0) -> int:
    """Convert to int without raising. Returns default on any failure."""
    if val is None:
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


def _persist_rows(rows: list[dict]):
    """Insert flat pikud_alerts rows, ignoring duplicates."""
    if not rows:
        return
    cols = _PIKUD_COLS
    placeholders = ", ".join(f":{c}" for c in cols)
    col_list = ", ".join(cols)
    sql = f"INSERT OR IGNORE INTO pikud_alerts ({col_list}) VALUES ({placeholders})"
    try:
        with _db_lock:
            conn = sqlite3.connect(_DB_PATH)
            for row in rows:
                params = {c: row.get(c) for c in cols}
                conn.execute(sql, params)
            conn.commit()
            conn.close()
    except Exception as e:
        logger.error(f"Pikud DB: persist error: {e}")


def query_alerts(from_ts: float, until_ts: float) -> list[dict]:
    """Return all ALERT rows with ts between from_ts and until_ts."""
    try:
        with _db_lock:
            conn = sqlite3.connect(_DB_PATH)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM pikud_alerts WHERE ts >= ? AND ts <= ? AND msg_type = 'ALERT' ORDER BY ts DESC",
                (from_ts, until_ts),
            ).fetchall()
            conn.close()
        return [dict(r) for r in rows]
    except Exception as e:
        logger.error(f"Pikud DB: query error: {e}")
        return []


def get_db_time_range() -> dict:
    """Return the earliest and latest Unix timestamps for ALERT rows."""
    try:
        with _db_lock:
            conn = sqlite3.connect(_DB_PATH)
            row = conn.execute(
                "SELECT MIN(ts), MAX(ts), COUNT(*) FROM pikud_alerts WHERE msg_type = 'ALERT' AND ts IS NOT NULL"
            ).fetchone()
            conn.close()
        if row and row[2]:
            return {"earliest": row[0], "latest": row[1], "count": row[2]}
    except Exception as e:
        logger.error(f"Pikud DB: range error: {e}")
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
# Tzofar WebSocket handlers
# ---------------------------------------------------------------------------

_TZOFAR_WS_URL = "wss://ws.tzevaadom.co.il/socket?platform=ANDROID"

# Oref alerts-history API — returns up to 3000 per-city entries (Hebrew city names)
_OREF_HISTORY_URL = "https://alerts-history.oref.org.il/Shared/Ajax/GetAlarmsHistory.aspx?lang=he&mode=0"
_OREF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://www.oref.org.il/",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json",
}
# Oref category IDs to ingest (all types including pre-alerts and event-ended signals)
_OREF_ALERT_CATS = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 14}

_tzofar_thread: threading.Thread | None = None
_tzofar_running = threading.Event()


def _tzofar_handle_alert(data: dict, raw_msg: dict):
    """Parse a Tzofar ALERT payload and inject into ring + DB immediately."""
    if not _lamas_loaded:
        _load_lamas()

    cities = data.get("cities", [])
    if not cities:
        return

    notification_id = data.get("notificationId", "")
    threat = _safe_int(data.get("threat"), 0)
    is_drill = bool(data.get("isDrill", False))

    cat = _TZOFAR_THREAT_TO_CAT.get(threat, str(threat))
    cat_label = ALERT_CATEGORIES.get(cat, f"Category {cat}")
    color = ALERT_COLORS.get(cat, "#ff2222")

    alert_ts = _safe_float(data.get("time"))
    if alert_ts:
        alert_iso = datetime.fromtimestamp(alert_ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    else:
        alert_ts = datetime.now(timezone.utc).timestamp()
        alert_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    title = cat_label if not is_drill else f"Drill — {cat_label}"
    raw_json_str = json.dumps(raw_msg, ensure_ascii=False)

    rows = []
    for city in cities:
        if not isinstance(city, str):
            continue
        geo = _resolve_city(city)
        fid = f"tz-{notification_id}-{city}" if notification_id else f"tz-{alert_ts}-{city}"
        rows.append({
            "id": fid,
            "source": "tzofar_ws",
            "ts": alert_ts,
            "timestamp": alert_iso,
            "lat": geo["lat"] if geo else None,
            "lng": geo["lng"] if geo else None,
            "city": city,
            "area": geo.get("area", "") if geo else "",
            "msg_type": "ALERT",
            "cat": cat,
            "cat_label": cat_label,
            "threat": threat,
            "color": color,
            "notification_id": notification_id or None,
            "is_drill": int(is_drill),
            "title": title,
            "title_he": data.get("titleHe"),
            "title_en": data.get("titleEn"),
            "title_ar": data.get("titleAr"),
            "title_ru": data.get("titleRu"),
            "title_es": data.get("titleEs"),
            "body_he": data.get("bodyHe"),
            "body_en": data.get("bodyEn") or data.get("body"),
            "body_ar": data.get("bodyAr"),
            "body_ru": data.get("bodyRu"),
            "body_es": data.get("bodyEs"),
            "cities_json": json.dumps(cities, ensure_ascii=False),
            "areas_ids_json": json.dumps(data.get("areasIds", []), ensure_ascii=False) if data.get("areasIds") else None,
            "cities_ids_json": json.dumps(data.get("citiesIds", []), ensure_ascii=False) if data.get("citiesIds") else None,
            "pin_until": _safe_float(data.get("pinUntil")),
            "raw_json": raw_json_str,
        })

    if not rows:
        return

    logger.info(
        f"Tzofar ALERT: threat={threat} ({cat_label}) cities={[r['city'] for r in rows[:5]]}"
        + (f" +{len(rows)-5} more" if len(rows) > 5 else "")
        + (" [DRILL]" if is_drill else "")
    )

    _add_to_ring(rows)
    _persist_rows([r for r in rows if r.get("lat") is not None])

    # Update live payload immediately
    with _ring_lock:
        ring_list = [dict(f) for f in _alert_ring]
    active_ids = {r["id"] for r in rows}
    active_feats = [dict(r, active=True) for r in rows if r.get("lat") is not None]
    historical = [f for f in ring_list if f["id"] not in active_ids and f.get("lat") is not None]
    with _data_lock:
        latest_data["pikud_alerts"] = active_feats + historical
    _mark_fresh("pikud_alerts")


def _tzofar_handle_system_message(data: dict, raw_msg: dict):
    """Parse a Tzofar SYSTEM_MESSAGE (early warning / all-clear) and persist."""
    notification_id = data.get("notificationId", "")
    time_val = data.get("time")
    try:
        ts = float(time_val) if time_val else datetime.now(timezone.utc).timestamp()
    except (ValueError, TypeError):
        ts = datetime.now(timezone.utc).timestamp()
    ts_iso = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    instruction = data.get("instruction")
    instruction_type = data.get("instructionType")

    if instruction:
        label = "EARLY WARNING"
    elif instruction_type == 1:
        label = "ALL CLEAR"
    else:
        label = "SYSTEM"

    fid = f"tz-sys-{notification_id}-{int(ts)}" if notification_id else f"tz-sys-{int(ts)}"

    row = {
        "id": fid,
        "source": "tzofar_ws",
        "ts": ts,
        "timestamp": ts_iso,
        "lat": None,
        "lng": None,
        "city": None,
        "area": None,
        "msg_type": "SYSTEM_MESSAGE",
        "cat": None,
        "cat_label": None,
        "threat": None,
        "color": None,
        "notification_id": notification_id or None,
        "is_drill": None,
        "instruction": int(bool(instruction)) if instruction is not None else None,
        "instruction_type": instruction_type,
        "title": label,
        "title_he": data.get("titleHe"),
        "title_en": data.get("titleEn") or "",
        "title_ar": data.get("titleAr"),
        "title_ru": data.get("titleRu"),
        "title_es": data.get("titleEs"),
        "body_he": data.get("bodyHe"),
        "body_en": data.get("bodyEn") or data.get("body") or "",
        "body_ar": data.get("bodyAr"),
        "body_ru": data.get("bodyRu"),
        "body_es": data.get("bodyEs"),
        "cities_json": json.dumps(data.get("cities", []), ensure_ascii=False) if data.get("cities") else None,
        "areas_ids_json": json.dumps(data.get("areasIds", []), ensure_ascii=False) if data.get("areasIds") else None,
        "cities_ids_json": json.dumps(data.get("citiesIds", []), ensure_ascii=False) if data.get("citiesIds") else None,
        "pin_until": _safe_float(data.get("pinUntil")),
        "raw_json": json.dumps(raw_msg, ensure_ascii=False),
    }

    _persist_rows([row])

    body_en = data.get("bodyEn") or data.get("body") or ""
    title_en = data.get("titleEn") or ""
    areas = data.get("areasIds", [])
    cities_ids = data.get("citiesIds", [])

    logger.info(
        f"Tzofar {label}: {title_en} — {body_en}"
        f"  areas={areas[:5]}{'...' if len(areas) > 5 else ''}"
        f"  cities_ids={len(cities_ids)}"
    )


# ---------------------------------------------------------------------------
# Tzofar WebSocket listener (daemon thread)
# ---------------------------------------------------------------------------

def _tzofar_listener_loop():
    """Daemon loop: connect to Tzofar WS, handle messages, reconnect on error."""
    import asyncio
    import json as _json

    try:
        import websockets
    except ImportError:
        logger.error("Tzofar WebSocket: 'websockets' package not installed. Install it to enable push alerts.")
        return

    async def _run():
        backoff = 1.0
        connect_count = 0

        while _tzofar_running.is_set():
            connect_count += 1
            try:
                async with websockets.connect(
                    _TZOFAR_WS_URL,
                    ping_interval=60,
                    ping_timeout=420,
                    open_timeout=20,
                    additional_headers={
                        "User-Agent": "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36",
                        "Origin": "https://www.tzevaadom.co.il",
                    },
                ) as ws:
                    backoff = 1.0
                    logger.info(f"Tzofar WebSocket: connected (#{connect_count})")
                    async for raw in ws:
                        if not _tzofar_running.is_set():
                            break
                        # Binary frames = server keepalive pings — skip
                        if isinstance(raw, bytes):
                            continue
                        try:
                            msg = _json.loads(raw)
                        except (ValueError, _json.JSONDecodeError):
                            continue
                        if not isinstance(msg, dict):
                            continue

                        msg_type = str(msg.get("type", "")).upper()
                        data = msg.get("data", msg)

                        if msg_type == "ALERT":
                            try:
                                _tzofar_handle_alert(data, msg)
                            except Exception as e:
                                logger.error(f"Tzofar: error handling ALERT: {e}  data={str(data)[:200]}")

                        elif msg_type in ("SYSTEM_MESSAGE", "SYSTEM"):
                            try:
                                _tzofar_handle_system_message(data, msg)
                            except Exception as e:
                                logger.error(f"Tzofar: error handling SYSTEM_MESSAGE: {e}  data={str(data)[:200]}")

                        # else: PING/PONG/HEARTBEAT — ignore

            except Exception as e:
                if not _tzofar_running.is_set():
                    break
                logger.warning(f"Tzofar WebSocket: disconnected (#{connect_count}): {type(e).__name__}: {e}")

            if not _tzofar_running.is_set():
                break
            logger.info(f"Tzofar WebSocket: reconnecting in {backoff:.0f}s...")
            # Sleep in small increments so we can exit promptly on shutdown
            import time as _time
            waited = 0.0
            while waited < backoff and _tzofar_running.is_set():
                _time.sleep(0.5)
                waited += 0.5
            backoff = min(backoff * 2, 30)

        logger.info("Tzofar WebSocket: listener stopped.")

    asyncio.run(_run())


def _backfill_from_listener(gap_start: float, now_ts: float) -> bool:
    """Try to backfill from the always-on Signal Archive listener.

    The listener now serves flat pikud_alerts rows — direct INSERT OR IGNORE.
    Returns True if the listener had data and we successfully backfilled.
    """
    import os
    import urllib.request
    listener_url = os.environ.get("LISTENER_URL", "").rstrip("/")
    if not listener_url:
        return False

    try:
        # Check if the listener has pikud_alerts data covering our gap
        range_req = urllib.request.Request(
            f"{listener_url}/range/pikud_alerts",
            headers={"Accept": "application/json"},
        )
        with urllib.request.urlopen(range_req, timeout=10) as resp:
            listener_range = json.loads(resp.read().decode())

        if not listener_range.get("latest") or not listener_range.get("count"):
            logger.info("Backfill: listener has no data — falling back to Oref")
            return False

        logger.info(
            f"Backfill: listener has data "
            f"{datetime.fromtimestamp(listener_range['earliest'], tz=timezone.utc).strftime('%Y-%m-%d %H:%M')} "
            f"to {datetime.fromtimestamp(listener_range['latest'], tz=timezone.utc).strftime('%Y-%m-%d %H:%M')} "
            f"({listener_range['count']} events)"
        )

        # Fetch in 7-day chunks to avoid huge responses
        _CHUNK = 7 * 24 * 3600
        chunk_start = gap_start
        total_inserted = 0

        while chunk_start < now_ts:
            chunk_end = min(chunk_start + _CHUNK, now_ts)
            url = f"{listener_url}/backfill/pikud_alerts?from_ts={chunk_start}&until_ts={chunk_end}"
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = json.loads(resp.read().decode())
            records = payload.get("records", [])

            # Records are already flat pikud_alerts rows — direct insert
            if records:
                _persist_rows(records)
                total_inserted += len(records)

            chunk_start = chunk_end

        if total_inserted:
            logger.info(f"Backfill: listener provided {total_inserted} rows (direct insert)")
            return True

        logger.info("Backfill: listener returned no records for the gap window")
        return False

    except Exception as e:
        logger.warning(f"Backfill: listener query failed ({e}), falling back to Oref history")
        return False


def _backfill_gap():
    """Detect a gap in pikud_alerts and backfill from available sources.

    Priority:
      1. Signal Archive listener (always-on server, has full WS fidelity)
      2. Oref alerts-history API (up to 3000 per-city entries, less metadata)

    Called once on startup, before the WebSocket thread starts.
    """
    try:
        # --- 1. Detect gap ---
        with _db_lock:
            conn = sqlite3.connect(_DB_PATH)
            row = conn.execute("SELECT MIN(ts), MAX(ts), COUNT(*) FROM pikud_alerts").fetchone()
            conn.close()
        first_ts = row[0] if row and row[0] else None
        last_ts = row[1] if row and row[1] else None
        local_count = row[2] if row else 0
        now_ts = _time_mod.time()

        if last_ts is None:
            logger.info("Backfill: no prior events in DB — backfilling all available history")
            gap_start = 0.0
        else:
            gap_seconds = now_ts - last_ts
            gap_hours = gap_seconds / 3600
            logger.info(
                f"Backfill: {local_count} local rows, "
                f"range {datetime.fromtimestamp(first_ts, tz=timezone.utc).strftime('%Y-%m-%d %H:%M')} "
                f"to {datetime.fromtimestamp(last_ts, tz=timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC "
                f"(forward gap: {gap_hours:.1f}h)"
            )
            gap_start = last_ts

        # --- 2. Try Signal Archive listener ---
        # Always fetch the full listener range (INSERT OR IGNORE handles dedup).
        # This covers both forward gaps AND older data the listener has.
        if _backfill_from_listener(0.0, now_ts):
            return  # Listener had data — done

        # --- 3. Fall back to Oref history API ---
        resp = fetch_with_curl(_OREF_HISTORY_URL, timeout=20, headers=_OREF_HEADERS)
        if not resp or resp.status_code != 200:
            logger.warning(f"Backfill: Oref history fetch failed (HTTP {getattr(resp, 'status_code', '?')})")
            return

        try:
            entries = resp.json()
        except Exception:
            logger.warning("Backfill: Oref history response is not valid JSON")
            return

        if not isinstance(entries, list) or not entries:
            logger.info("Backfill: Oref history returned empty — nothing to backfill")
            return

        # --- 3b. Filter to gap window & alert categories only ---
        gap_entries = []
        for entry in entries:
            cat_val = entry.get("category")
            if cat_val not in _OREF_ALERT_CATS:
                continue
            alert_date_str = entry.get("alertDate", "")
            try:
                dt = datetime.strptime(alert_date_str[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
                ts = dt.timestamp()
            except (ValueError, IndexError):
                continue
            if ts <= gap_start:
                continue
            if ts > now_ts + 60:
                continue
            entry["_parsed_ts"] = ts
            entry["_parsed_iso"] = dt.strftime("%Y-%m-%d %H:%M:%S")
            gap_entries.append(entry)

        if not gap_entries:
            logger.info("Backfill: no Oref history entries fall within the gap window")
            return

        logger.info(f"Backfill: {len(gap_entries)} alert entries from Oref history to process")

        # --- 4. Build flat rows and insert ---
        rows = []
        for entry in gap_entries:
            city = entry.get("data", "")
            if not city:
                continue
            geo = _resolve_city(city)
            rid = entry.get("rid", "")
            ts = entry["_parsed_ts"]
            iso_str = entry["_parsed_iso"]
            oref_cat = str(entry.get("category", 1))
            cat_label = ALERT_CATEGORIES.get(oref_cat, f"Category {oref_cat}")
            color = ALERT_COLORS.get(oref_cat, "#ff2222")

            # Map Oref category to Tzofar threat int
            threat = None
            if oref_cat == "1":
                threat = 0
            elif oref_cat == "5":
                threat = 5
            elif oref_cat in _TZOFAR_THREAT_TO_CAT:
                for t, c in _TZOFAR_THREAT_TO_CAT.items():
                    if c == oref_cat:
                        threat = t
                        break

            fid = f"bf-{rid}" if rid else f"bf-{ts}-{city}"
            rows.append({
                "id": fid,
                "source": "oref_history",
                "ts": ts,
                "timestamp": iso_str,
                "lat": geo["lat"] if geo else None,
                "lng": geo["lng"] if geo else None,
                "city": city,
                "area": geo.get("area", "") if geo else "",
                "msg_type": "ALERT",
                "cat": oref_cat,
                "cat_label": cat_label,
                "threat": threat,
                "color": color,
                "title": cat_label,
                "oref_rid": rid if rid else None,
                "oref_category_desc": entry.get("category_desc"),
                "raw_json": json.dumps({"_backfill": True, "source": "oref_history"}, ensure_ascii=False),
            })

        if rows:
            _persist_rows(rows)
            logger.info(f"Backfill: inserted {len(rows)} per-city alerts from Oref history")

    except Exception as e:
        logger.error(f"Backfill: unexpected error: {e}", exc_info=True)
    finally:
        # Seed the live payload from DB so recent alerts show immediately
        _seed_live_from_db()


def _seed_live_from_db():
    """Load recent ALERT rows from the DB into latest_data so the frontend
    can display them before the next WebSocket push arrives."""
    try:
        cutoff = _time_mod.time() - 30 * 60  # 30-minute live window
        with _db_lock:
            conn = sqlite3.connect(_DB_PATH)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM pikud_alerts WHERE ts >= ? AND msg_type = 'ALERT' ORDER BY ts DESC",
                (cutoff,),
            ).fetchall()
            conn.close()
        if rows:
            feats = [dict(r) for r in rows if r["lat"] is not None]
            # Also populate the ring buffer so subsequent WS pushes merge correctly
            _add_to_ring(feats)
            with _data_lock:
                latest_data["pikud_alerts"] = feats
            _mark_fresh("pikud_alerts")
            logger.info(f"Seeded live pikud_alerts with {len(feats)} recent alerts from DB")
    except Exception as e:
        logger.error(f"Seed live from DB failed: {e}", exc_info=True)


def start_tzofar_listener():
    """Start the Tzofar WebSocket push listener as a background daemon thread.

    Before connecting the WebSocket, loads LAMAS geodata and runs gap-fill
    to recover any alerts missed while the system was offline.
    """
    global _tzofar_thread
    if _tzofar_thread and _tzofar_thread.is_alive():
        logger.info("Tzofar WebSocket: already running")
        return

    # Ensure LAMAS is loaded before backfill (need geo resolution for city coords)
    _load_lamas()

    # Detect and fill any gap in the alert journal
    _backfill_gap()

    _tzofar_running.set()
    _tzofar_thread = threading.Thread(
        target=_tzofar_listener_loop,
        name="tzofar-ws",
        daemon=True,
    )
    _tzofar_thread.start()
    logger.info("Tzofar WebSocket: listener thread started")


def stop_tzofar_listener():
    """Signal the Tzofar WebSocket listener to exit cleanly."""
    _tzofar_running.clear()
    logger.info("Tzofar WebSocket: stop requested")
