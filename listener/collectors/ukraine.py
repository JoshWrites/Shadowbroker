"""Ukraine air raid / artillery alert collector.

Polls alerts.in.ua every 30 seconds for oblast-level alerts.
Requires UKRAINE_ALERTS_TOKEN env var (register at devs.alerts.in.ua).

API docs: https://devs.alerts.in.ua
Active alerts endpoint: GET /v1/alerts/active.json
  → Returns list of active alert objects with regionId, regionType, type, etc.

Oblast centre coordinates are embedded here — the API returns region IDs,
not lat/lng, so we map them ourselves.
"""
import json
import logging
import os
import time
from datetime import datetime, timezone
from collectors.base import BaseCollector

try:
    import requests
except ImportError:
    import urllib.request as _urllib
    requests = None

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.alerts.in.ua/v1"
_ACTIVE_URL = f"{_BASE_URL}/alerts/active.json"

# Alert type → human label + color
ALERT_TYPES = {
    "AIR":        {"label": "Air Raid",          "color": "#ff2222"},
    "ARTILLERY":  {"label": "Artillery",          "color": "#ff8800"},
    "URBAN_FIGHTS": {"label": "Urban Combat",    "color": "#ff0055"},
    "CHEMICAL":   {"label": "Chemical Threat",   "color": "#aa44ff"},
    "NUCLEAR":    {"label": "Nuclear Threat",    "color": "#ff00aa"},
    "MISSILE":    {"label": "Missile Strike",    "color": "#ff4400"},
    "UNKNOWN":    {"label": "Alert",             "color": "#ffdd00"},
}

# Oblast region IDs → name + approximate centre lat/lng
# Source: ISO 3166-2:UA + standard oblast capitals
OBLAST_GEO = {
    1:  {"name": "Vinnytsia Oblast",     "lat": 49.2328, "lng": 28.4682},
    2:  {"name": "Volyn Oblast",         "lat": 50.7472, "lng": 25.3254},
    3:  {"name": "Dnipropetrovsk Oblast","lat": 48.4647, "lng": 35.0462},
    4:  {"name": "Donetsk Oblast",       "lat": 48.0159, "lng": 37.8028},
    5:  {"name": "Zhytomyr Oblast",      "lat": 50.2549, "lng": 28.6587},
    6:  {"name": "Zakarpattia Oblast",   "lat": 48.6208, "lng": 22.2879},
    7:  {"name": "Zaporizhzhia Oblast",  "lat": 47.8388, "lng": 35.1396},
    8:  {"name": "Ivano-Frankivsk Oblast","lat": 48.9226, "lng": 24.7111},
    9:  {"name": "Kyiv Oblast",          "lat": 50.5330, "lng": 30.6671},
    10: {"name": "Kirovohrad Oblast",    "lat": 48.5132, "lng": 32.2597},
    11: {"name": "Luhansk Oblast",       "lat": 48.5740, "lng": 39.3078},
    12: {"name": "Lviv Oblast",          "lat": 49.8397, "lng": 24.0297},
    13: {"name": "Mykolaiv Oblast",      "lat": 46.9750, "lng": 31.9946},
    14: {"name": "Odesa Oblast",         "lat": 46.4825, "lng": 30.7233},
    15: {"name": "Poltava Oblast",       "lat": 49.5883, "lng": 34.5514},
    16: {"name": "Rivne Oblast",         "lat": 50.6199, "lng": 26.2516},
    17: {"name": "Sumy Oblast",          "lat": 50.9077, "lng": 34.7981},
    18: {"name": "Ternopil Oblast",      "lat": 49.5535, "lng": 25.5948},
    19: {"name": "Kharkiv Oblast",       "lat": 49.9935, "lng": 36.2304},
    20: {"name": "Kherson Oblast",       "lat": 46.6354, "lng": 32.6169},
    21: {"name": "Khmelnytskyi Oblast",  "lat": 49.4220, "lng": 26.9987},
    22: {"name": "Cherkasy Oblast",      "lat": 49.4444, "lng": 32.0598},
    23: {"name": "Chernivtsi Oblast",    "lat": 48.2916, "lng": 25.9352},
    24: {"name": "Chernihiv Oblast",     "lat": 51.4982, "lng": 31.2893},
    25: {"name": "Kyiv City",            "lat": 50.4501, "lng": 30.5234},
}


def _get_token() -> str | None:
    return os.environ.get("UKRAINE_ALERTS_TOKEN", "").strip() or None


def _fetch_json(url: str, token: str) -> dict | list | None:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    if requests:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            return resp.json()
        logger.warning(f"[ukraine] HTTP {resp.status_code} from {url}")
        return None
    else:
        import urllib.request as ur
        req = ur.Request(url, headers=headers)
        with ur.urlopen(req, timeout=10) as r:
            if r.status == 200:
                return json.loads(r.read().decode())
        return None


def _parse_alerts(raw: list, now_ts: float, now_iso: str) -> list[dict]:
    events = []
    for alert in raw:
        region_id = alert.get("regionId") or alert.get("region_id")
        alert_type = (alert.get("type") or "UNKNOWN").upper()
        if not region_id:
            continue
        geo = OBLAST_GEO.get(int(region_id))
        if not geo:
            continue
        type_info = ALERT_TYPES.get(alert_type, ALERT_TYPES["UNKNOWN"])
        # Use alertedAt from API if available, else now
        alerted_at = alert.get("alertedAt") or alert.get("alerted_at") or now_iso
        try:
            alert_ts = datetime.strptime(alerted_at[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
        except (ValueError, TypeError):
            alert_ts = now_ts
        fid = f"ua-{region_id}-{alert_type}-{int(alert_ts)}"
        events.append({
            "id": fid,
            "ts": alert_ts,
            "lat": geo["lat"],
            "lng": geo["lng"],
            "payload": {
                "region": geo["name"],
                "region_id": int(region_id),
                "type": alert_type,
                "type_label": type_info["label"],
                "color": type_info["color"],
                "timestamp": alerted_at,
                "active": True,
            },
        })
    return events


class UkraineCollector(BaseCollector):
    signal = "ukraine_alerts"
    poll_seconds = 30
    history_poll_minutes = 0  # API has no history endpoint — live only

    def collect(self) -> list[dict]:
        token = _get_token()
        if not token:
            logger.warning("[ukraine] UKRAINE_ALERTS_TOKEN not set — skipping")
            return []
        try:
            raw = _fetch_json(_ACTIVE_URL, token)
            if raw is None:
                return []
            alerts = raw if isinstance(raw, list) else raw.get("alerts", [])
            now_ts = time.time()
            now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
            return _parse_alerts(alerts, now_ts, now_iso)
        except Exception as e:
            logger.error(f"[ukraine] collect error: {e}")
            return []
