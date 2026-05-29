"""Shared SQLite helpers for the signal archive.

Each signal gets its own DB file at /data/{signal}.db.
Generic signals use a flat `events` table with a JSON payload column.
Pikud alerts use the unified `pikud_alerts` table (flat, no payload JSON).
"""
import json
import sqlite3
import threading
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

DATA_DIR = Path("/data")
_locks: dict[str, threading.Lock] = {}
_locks_lock = threading.Lock()


def _get_lock(signal: str) -> threading.Lock:
    with _locks_lock:
        if signal not in _locks:
            _locks[signal] = threading.Lock()
        return _locks[signal]


def db_path(signal: str) -> Path:
    return DATA_DIR / f"{signal}.db"


# ---------------------------------------------------------------------------
# Generic events table (used by non-pikud signals like Ukraine)
# ---------------------------------------------------------------------------

def init_db(signal: str) -> None:
    """Create the events table for a signal if it doesn't exist."""
    path = db_path(signal)
    path.parent.mkdir(parents=True, exist_ok=True)
    with _get_lock(signal):
        conn = sqlite3.connect(path)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id        TEXT PRIMARY KEY,
                signal    TEXT NOT NULL,
                ts        REAL NOT NULL,
                lat       REAL,
                lng       REAL,
                payload   TEXT NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_ts ON events (ts)")
        conn.commit()
        conn.close()
    logger.info(f"[{signal}] DB ready at {path}")


def insert_events(signal: str, events: list[dict]) -> int:
    """Insert events, ignoring duplicates. Returns count inserted."""
    if not events:
        return 0
    path = db_path(signal)
    inserted = 0
    with _get_lock(signal):
        conn = sqlite3.connect(path)
        for e in events:
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO events (id, signal, ts, lat, lng, payload) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (e["id"], signal, e["ts"], e.get("lat"), e.get("lng"),
                     json.dumps(e.get("payload", {})))
                )
                inserted += conn.execute("SELECT changes()").fetchone()[0]
            except Exception as ex:
                logger.error(f"[{signal}] Insert error for {e.get('id')}: {ex}")
        conn.commit()
        conn.close()
    return inserted


def query_events(signal: str, from_ts: float, until_ts: float) -> list[dict]:
    """Return all events between two Unix timestamps."""
    path = db_path(signal)
    if not path.exists():
        return []
    with _get_lock(signal):
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM events WHERE ts >= ? AND ts <= ? ORDER BY ts ASC",
            (from_ts, until_ts)
        ).fetchall()
        conn.close()
    result = []
    for r in rows:
        d = dict(r)
        d["payload"] = json.loads(d["payload"])
        result.append(d)
    return result


def get_time_range(signal: str) -> dict:
    """Return earliest ts, latest ts, and count for a signal."""
    path = db_path(signal)
    if not path.exists():
        return {"earliest": None, "latest": None, "count": 0}
    with _get_lock(signal):
        conn = sqlite3.connect(path)
        row = conn.execute(
            "SELECT MIN(ts), MAX(ts), COUNT(*) FROM events"
        ).fetchone()
        conn.close()
    if row and row[2]:
        return {"earliest": row[0], "latest": row[1], "count": row[2]}
    return {"earliest": None, "latest": None, "count": 0}


# ---------------------------------------------------------------------------
# Unified pikud_alerts table
# ---------------------------------------------------------------------------

_PIKUD_COLS = [
    "id", "source", "ts", "timestamp", "lat", "lng", "city", "area",
    "msg_type", "cat", "cat_label", "threat", "color", "notification_id",
    "is_drill", "instruction", "instruction_type",
    "title", "title_he", "title_en", "title_ar", "title_ru", "title_es",
    "body_he", "body_en", "body_ar", "body_ru", "body_es",
    "cities_json", "areas_ids_json", "cities_ids_json", "pin_until",
    "oref_rid", "oref_category_desc", "raw_json", "inserted_at",
]

_PIKUD_SIGNAL = "pikud_alerts"


def init_pikud_db() -> None:
    """Create the unified pikud_alerts table, migrating from old schema if needed."""
    path = db_path(_PIKUD_SIGNAL)
    path.parent.mkdir(parents=True, exist_ok=True)
    with _get_lock(_PIKUD_SIGNAL):
        conn = sqlite3.connect(path)

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

        # --- Migrate from old generic events table if it exists ---
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}

        if "events" in tables:
            migrated = 0
            conn.row_factory = sqlite3.Row
            rows = conn.execute("SELECT * FROM events").fetchall()
            conn.row_factory = None
            for r in rows:
                rd = dict(r)
                try:
                    payload = json.loads(rd.get("payload", "{}"))
                    row_id = rd["id"]
                    ts = rd["ts"]
                    lat = rd.get("lat")
                    lng = rd.get("lng")
                    msg_type = payload.get("msg_type", "ALERT")
                    conn.execute(
                        """INSERT OR IGNORE INTO pikud_alerts
                           (id, source, ts, timestamp, lat, lng, city, area,
                            msg_type, cat, cat_label, threat, color, notification_id,
                            is_drill, instruction, instruction_type, title, raw_json)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (
                            row_id,
                            "tzofar_ws" if row_id.startswith("tz-") else "oref_history",
                            ts,
                            payload.get("timestamp", ""),
                            lat, lng,
                            payload.get("city"),
                            payload.get("area"),
                            msg_type,
                            payload.get("cat"),
                            payload.get("cat_label"),
                            payload.get("threat"),
                            payload.get("color"),
                            payload.get("notification_id"),
                            payload.get("is_drill"),
                            payload.get("instruction"),
                            payload.get("instruction_type"),
                            payload.get("title") or payload.get("label"),
                            json.dumps(payload.get("raw")) if payload.get("raw") else None,
                        ),
                    )
                    migrated += conn.execute("SELECT changes()").fetchone()[0]
                except Exception as ex:
                    logger.debug(f"[pikud] migration skip row: {ex}")
            conn.commit()
            if migrated:
                logger.info(f"[pikud] migrated {migrated} rows from events → pikud_alerts")
            conn.execute("DROP TABLE events")
            conn.commit()
            logger.info("[pikud] dropped old events table")

        conn.close()
    logger.info(f"[{_PIKUD_SIGNAL}] pikud_alerts DB ready at {path}")


def insert_pikud_rows(rows: list[dict]) -> int:
    """Insert flat pikud_alerts rows, ignoring duplicates. Returns count inserted."""
    if not rows:
        return 0
    path = db_path(_PIKUD_SIGNAL)
    cols = [
        "id", "source", "ts", "timestamp", "lat", "lng", "city", "area",
        "msg_type", "cat", "cat_label", "threat", "color", "notification_id",
        "is_drill", "instruction", "instruction_type",
        "title", "title_he", "title_en", "title_ar", "title_ru", "title_es",
        "body_he", "body_en", "body_ar", "body_ru", "body_es",
        "cities_json", "areas_ids_json", "cities_ids_json", "pin_until",
        "oref_rid", "oref_category_desc", "raw_json",
    ]
    placeholders = ", ".join(f":{c}" for c in cols)
    col_list = ", ".join(cols)
    sql = f"INSERT OR IGNORE INTO pikud_alerts ({col_list}) VALUES ({placeholders})"

    inserted = 0
    with _get_lock(_PIKUD_SIGNAL):
        conn = sqlite3.connect(path)
        for row in rows:
            # Fill missing keys with None
            params = {c: row.get(c) for c in cols}
            try:
                conn.execute(sql, params)
                inserted += conn.execute("SELECT changes()").fetchone()[0]
            except Exception as ex:
                logger.error(f"[pikud] insert error for {row.get('id')}: {ex}")
        conn.commit()
        conn.close()
    return inserted


def query_pikud(from_ts: float, until_ts: float, msg_type: str | None = None) -> list[dict]:
    """Return pikud_alerts rows between two Unix timestamps."""
    path = db_path(_PIKUD_SIGNAL)
    if not path.exists():
        return []
    with _get_lock(_PIKUD_SIGNAL):
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        if msg_type:
            rows = conn.execute(
                "SELECT * FROM pikud_alerts WHERE ts >= ? AND ts <= ? AND msg_type = ? ORDER BY ts ASC",
                (from_ts, until_ts, msg_type),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM pikud_alerts WHERE ts >= ? AND ts <= ? ORDER BY ts ASC",
                (from_ts, until_ts),
            ).fetchall()
        conn.close()
    return [dict(r) for r in rows]


def get_pikud_time_range(msg_type: str | None = None) -> dict:
    """Return earliest ts, latest ts, and count for pikud_alerts."""
    path = db_path(_PIKUD_SIGNAL)
    if not path.exists():
        return {"earliest": None, "latest": None, "count": 0}
    with _get_lock(_PIKUD_SIGNAL):
        conn = sqlite3.connect(path)
        if msg_type:
            row = conn.execute(
                "SELECT MIN(ts), MAX(ts), COUNT(*) FROM pikud_alerts WHERE msg_type = ?",
                (msg_type,),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT MIN(ts), MAX(ts), COUNT(*) FROM pikud_alerts"
            ).fetchone()
        conn.close()
    if row and row[2]:
        return {"earliest": row[0], "latest": row[1], "count": row[2]}
    return {"earliest": None, "latest": None, "count": 0}
