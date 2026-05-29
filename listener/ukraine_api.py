"""Lightweight backfill API for the LXC 110 Ukraine alerts collector.

Reads the existing collector SQLite DB (alerts table with per-city/hromada rows)
and serves data in signal-archive format for Shadowbroker backend to pull.

Deployed alongside the existing collector — does NOT replace it.

Endpoints:
  GET /health
  GET /range/ukraine_alerts
  GET /backfill/ukraine_alerts?from_ts=<unix>&until_ts=<unix>
"""
import json
import os
import sqlite3
import threading
from datetime import datetime, timezone

from fastapi import FastAPI, Query, HTTPException
import uvicorn

DB_PATH = os.environ.get("DB_PATH", "/app/data/alerts.db")

app = FastAPI(title="Ukraine Alerts API", version="0.1.0")

_db_lock = threading.Lock()

# Ukrainian oblast name → Shadowbroker region_id + lat/lng (matches OBLAST_GEO in backend)
OBLAST_MAP = {
    "Вінницька область":         {"id": 1,  "name": "Vinnytsia Oblast",      "lat": 49.2328, "lng": 28.4682},
    "Волинська область":         {"id": 2,  "name": "Volyn Oblast",          "lat": 50.7472, "lng": 25.3254},
    "Дніпропетровська область":  {"id": 3,  "name": "Dnipropetrovsk Oblast", "lat": 48.4647, "lng": 35.0462},
    "Донецька область":          {"id": 4,  "name": "Donetsk Oblast",        "lat": 48.0159, "lng": 37.8028},
    "Житомирська область":       {"id": 5,  "name": "Zhytomyr Oblast",       "lat": 50.2549, "lng": 28.6587},
    "Закарпатська область":      {"id": 6,  "name": "Zakarpattia Oblast",    "lat": 48.6208, "lng": 22.2879},
    "Запорізька область":        {"id": 7,  "name": "Zaporizhzhia Oblast",   "lat": 47.8388, "lng": 35.1396},
    "Івано-Франківська область": {"id": 8,  "name": "Ivano-Frankivsk Oblast","lat": 48.9226, "lng": 24.7111},
    "Київська область":          {"id": 9,  "name": "Kyiv Oblast",           "lat": 50.5330, "lng": 30.6671},
    "Кіровоградська область":    {"id": 10, "name": "Kirovohrad Oblast",     "lat": 48.5132, "lng": 32.2597},
    "Луганська область":         {"id": 11, "name": "Luhansk Oblast",        "lat": 48.5740, "lng": 39.3078},
    "Львівська область":         {"id": 12, "name": "Lviv Oblast",           "lat": 49.8397, "lng": 24.0297},
    "Миколаївська область":      {"id": 13, "name": "Mykolaiv Oblast",       "lat": 46.9750, "lng": 31.9946},
    "Одеська область":           {"id": 14, "name": "Odesa Oblast",          "lat": 46.4825, "lng": 30.7233},
    "Полтавська область":        {"id": 15, "name": "Poltava Oblast",        "lat": 49.5883, "lng": 34.5514},
    "Рівненська область":        {"id": 16, "name": "Rivne Oblast",          "lat": 50.6199, "lng": 26.2516},
    "Сумська область":           {"id": 17, "name": "Sumy Oblast",           "lat": 50.9077, "lng": 34.7981},
    "Тернопільська область":     {"id": 18, "name": "Ternopil Oblast",       "lat": 49.5535, "lng": 25.5948},
    "Харківська область":        {"id": 19, "name": "Kharkiv Oblast",        "lat": 49.9935, "lng": 36.2304},
    "Херсонська область":        {"id": 20, "name": "Kherson Oblast",        "lat": 46.6354, "lng": 32.6169},
    "Хмельницька область":       {"id": 21, "name": "Khmelnytskyi Oblast",   "lat": 49.4220, "lng": 26.9987},
    "Черкаська область":         {"id": 22, "name": "Cherkasy Oblast",       "lat": 49.4444, "lng": 32.0598},
    "Чернівецька область":       {"id": 23, "name": "Chernivtsi Oblast",     "lat": 48.2916, "lng": 25.9352},
    "Чернігівська область":      {"id": 24, "name": "Chernihiv Oblast",      "lat": 51.4982, "lng": 31.2893},
    "м. Київ":                   {"id": 25, "name": "Kyiv City",             "lat": 50.4501, "lng": 30.5234},
}

# alerts.in.ua alert_type → Shadowbroker type + label + color
ALERT_TYPE_MAP = {
    "air_raid":            {"type": "AIR",          "label": "Air Raid",       "color": "#ff2222"},
    "artillery_shelling":  {"type": "ARTILLERY",    "label": "Artillery",      "color": "#ff8800"},
    "urban_fights":        {"type": "URBAN_FIGHTS", "label": "Urban Combat",   "color": "#ff0055"},
    "chemical":            {"type": "CHEMICAL",     "label": "Chemical Threat","color": "#aa44ff"},
    "nuclear":             {"type": "NUCLEAR",      "label": "Nuclear Threat", "color": "#ff00aa"},
    "missile_attack":      {"type": "MISSILE",      "label": "Missile Strike", "color": "#ff4400"},
}
_DEFAULT_TYPE = {"type": "UNKNOWN", "label": "Alert", "color": "#ffdd00"}


def _parse_ts(started_at: str) -> float:
    """Parse ISO timestamp to Unix epoch seconds."""
    try:
        s = started_at.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except (ValueError, TypeError):
        return 0.0


def _row_to_event(row: dict) -> dict | None:
    """Transform a collector DB row into signal-archive format."""
    oblast_ua = row.get("location_oblast", "")
    geo = OBLAST_MAP.get(oblast_ua)
    if not geo:
        return None

    alert_type_raw = row.get("alert_type", "unknown")
    type_info = ALERT_TYPE_MAP.get(alert_type_raw, _DEFAULT_TYPE)
    started_at = row.get("started_at", "")
    ts = _parse_ts(started_at)
    if ts == 0.0:
        return None

    region_id = geo["id"]
    fid = f"ua-{region_id}-{type_info['type']}-{int(ts)}"

    return {
        "id": fid,
        "ts": ts,
        "lat": geo["lat"],
        "lng": geo["lng"],
        "payload": {
            "region": geo["name"],
            "region_id": region_id,
            "type": type_info["type"],
            "type_label": type_info["label"],
            "color": type_info["color"],
            "timestamp": started_at,
            "active": row.get("finished_at") is None,
        },
    }


def _query_db(sql: str, params: tuple = ()) -> list[dict]:
    with _db_lock:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(sql, params).fetchall()
        conn.close()
    return [dict(r) for r in rows]


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/range/ukraine_alerts")
def ukraine_range():
    rows = _query_db(
        "SELECT MIN(started_at) as earliest, MAX(started_at) as latest, COUNT(*) as c FROM alerts"
    )
    if not rows or rows[0]["c"] == 0:
        return {"earliest": None, "latest": None, "count": 0}
    return {
        "earliest": _parse_ts(rows[0]["earliest"]),
        "latest": _parse_ts(rows[0]["latest"]),
        "count": rows[0]["c"],
    }


@app.get("/backfill/ukraine_alerts")
def ukraine_backfill(
    from_ts: float = Query(..., description="Start of range (Unix epoch)"),
    until_ts: float = Query(..., description="End of range (Unix epoch)"),
):
    if until_ts < from_ts:
        raise HTTPException(status_code=400, detail="until_ts must be >= from_ts")

    # Convert Unix timestamps to ISO for the started_at column query
    from_iso = datetime.fromtimestamp(from_ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    until_iso = datetime.fromtimestamp(until_ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    rows = _query_db(
        "SELECT * FROM alerts WHERE started_at >= ? AND started_at <= ? ORDER BY started_at ASC",
        (from_iso, until_iso),
    )

    # Deduplicate at oblast level — multiple cities in same oblast at same time = one event
    seen = set()
    events = []
    for row in rows:
        ev = _row_to_event(row)
        if ev and ev["id"] not in seen:
            seen.add(ev["id"])
            events.append(ev)

    return {"signal": "ukraine_alerts", "count": len(events), "records": events}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7654, log_level="info")
