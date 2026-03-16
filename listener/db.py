"""Shared SQLite helpers for the signal archive.

Each signal gets its own DB file at /data/{signal}.db.
All DBs share the same schema — a flat `events` table with
a JSON payload column for signal-specific fields.
"""
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
    import json
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
    import json
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
