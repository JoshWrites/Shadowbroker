"""Pikud HaOref (Israel Home Front Command) collector.

Polls the Oref live alerts endpoint every 5 seconds.
Fetches 24h history at startup and every 30 minutes.
Persists to /data/pikud_alerts.db via the unified pikud_alerts table.

Dedup key: f"{alert_id}-{city}" for live, f"hist-{alertDate}-{city}" for history.

This collector is currently disabled (pikud_ws handles live via WebSocket),
but kept as a fallback. collect_history() is used by pikud_ws for startup backfill.
"""
import json
import logging
import time
import threading
import requests
from datetime import datetime, timezone
from collectors.base import BaseCollector

logger = logging.getLogger(__name__)

_OREF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://www.oref.org.il/",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json",
    "Accept-Language": "he,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}

_LIVE_URL    = "https://www.oref.org.il/WarningMessages/alert/alerts.json"
_HISTORY_URL = "https://www.oref.org.il/WarningMessages/alert/History/AlertsHistory.json"
_LAMAS_URL   = "https://raw.githubusercontent.com/idodov/RedAlert/main/apps/red_alerts_israel/lamas_data.json"

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
    "1": "#ff2222", "2": "#ff8800", "3": "#ffdd00", "4": "#0088ff",
    "5": "#aa44ff", "6": "#ff0055", "7": "#ff4400", "8": "#00ccff",
    "9": "#44ff88", "13": "#ffaa00", "14": "#ff00aa",
}

# ---------------------------------------------------------------------------
# LAMAS geodata (city name → lat/lng) — shared across collect() calls
# ---------------------------------------------------------------------------
_lamas_lock = threading.Lock()
_lamas_data: dict[str, dict] = {}
_lamas_loaded = False
_lamas_last_attempt: float = 0.0
_LAMAS_RETRY_INTERVAL = 60


def _load_lamas():
    global _lamas_data, _lamas_loaded, _lamas_last_attempt
    with _lamas_lock:
        if _lamas_loaded:
            return
        if time.time() - _lamas_last_attempt < _LAMAS_RETRY_INTERVAL:
            return
        _lamas_last_attempt = time.time()
        try:
            resp = requests.get(_LAMAS_URL, timeout=20)
            if resp.status_code == 200:
                raw = resp.json()
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
                            _lamas_data[city_name] = {
                                "lat": float(lat), "lng": float(lng), "area": area_name
                            }
                _lamas_loaded = True
                logger.info(f"[pikud] LAMAS loaded: {len(_lamas_data)} locations")
            else:
                logger.error(f"[pikud] LAMAS fetch failed HTTP {resp.status_code}")
        except Exception as e:
            logger.error(f"[pikud] LAMAS load error: {e}")


def _resolve_city(city_name: str) -> dict | None:
    with _lamas_lock:
        return _lamas_data.get(city_name)


def _make_row(fid: str, city: str, geo: dict | None, cat: str,
              timestamp_iso: str, ts: float, source: str, extra: dict) -> dict:
    """Build a flat row dict for the unified pikud_alerts table."""
    return {
        "id": fid,
        "source": source,
        "ts": ts,
        "timestamp": timestamp_iso,
        "lat": geo["lat"] if geo else None,
        "lng": geo["lng"] if geo else None,
        "city": city,
        "area": geo.get("area", "") if geo else "",
        "msg_type": "ALERT",
        "cat": cat,
        "cat_label": ALERT_CATEGORIES.get(cat, f"Category {cat}"),
        "color": ALERT_COLORS.get(cat, "#ff2222"),
        **extra,
    }


class PikudCollector(BaseCollector):
    signal = "pikud_alerts"
    poll_seconds = 5
    history_poll_minutes = 30

    def __init__(self):
        super().__init__()
        _load_lamas()

    def collect(self) -> list[dict]:
        """Poll the live endpoint. Returns [] when no active alert."""
        if not _lamas_loaded:
            _load_lamas()
            return []
        try:
            resp = requests.get(_LIVE_URL, headers=_OREF_HEADERS, timeout=8)
            if resp.status_code != 200:
                return []
            text = resp.text.strip()
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
            now = datetime.now(timezone.utc)
            now_iso = now.strftime("%Y-%m-%d %H:%M:%S")
            now_ts = now.timestamp()

            rows = []
            for city in cities:
                geo = _resolve_city(city)
                if geo is None:
                    continue
                fid = f"{alert_id}-{city}"
                rows.append(_make_row(
                    fid, city, geo, cat, now_iso, now_ts, "oref_live",
                    {"title": data.get("title", "")}
                ))
            return rows
        except Exception as e:
            logger.error(f"[pikud] live fetch error: {e}")
            return []

    def collect_history(self) -> list[dict]:
        """Fetch 24h history from Oref history endpoint."""
        if not _lamas_loaded:
            _load_lamas()
            return []
        try:
            resp = requests.get(_HISTORY_URL, headers=_OREF_HEADERS, timeout=15)
            if resp.status_code != 200:
                return []
            text = resp.text.strip()
            if not text:
                return []
            history = json.loads(text)
            if not isinstance(history, list):
                return []

            rows = []
            for entry in history:
                city = entry.get("data", "")
                alert_date = entry.get("alertDate", "")
                cat = str(entry.get("cat") or entry.get("category") or "1")
                if not city or not alert_date:
                    continue
                geo = _resolve_city(city)
                if geo is None:
                    continue
                try:
                    alert_ts = datetime.strptime(
                        alert_date[:19], "%Y-%m-%d %H:%M:%S"
                    ).replace(tzinfo=timezone.utc).timestamp()
                except (ValueError, TypeError):
                    continue
                fid = f"hist-{alert_date}-{city}"
                rows.append(_make_row(
                    fid, city, geo, cat, alert_date, alert_ts, "oref_history",
                    {"title": entry.get("title", ""),
                     "oref_rid": entry.get("rid"),
                     "oref_category_desc": entry.get("category_desc")}
                ))
            return rows
        except Exception as e:
            logger.error(f"[pikud] history fetch error: {e}")
            return []
