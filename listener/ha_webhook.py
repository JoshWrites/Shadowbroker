"""Home Assistant webhook dispatcher.

Fires webhooks to Home Assistant when alerts match watched cities/areas.
Configured via environment variables:
  HA_WEBHOOK_URL    — e.g. http://10.100.102.113:8123/api/webhook/pikud-alert
  HA_WATCH_CITIES   — comma-separated Hebrew city names, e.g. "הוד השרון,רעננה"
  HA_WATCH_CITY_IDS — comma-separated Oref numeric city IDs, e.g. "810,1234"
  HA_WATCH_AREA_IDS — comma-separated Oref numeric area IDs, e.g. "27"

For ALERTs: matches by city name (HA_WATCH_CITIES).
For SYSTEM_MESSAGEs (early warnings): matches by citiesIds or areasIds.
If HA_WEBHOOK_URL is not set, the module is a silent no-op.
"""

import json
import logging
import os
import threading
from urllib.request import Request, urlopen
from urllib.error import URLError

logger = logging.getLogger(__name__)

_WEBHOOK_URL = os.environ.get("HA_WEBHOOK_URL", "")
_WATCH_CITIES = set(
    c.strip() for c in os.environ.get("HA_WATCH_CITIES", "").split(",") if c.strip()
)
_WATCH_CITY_IDS = set(
    int(x.strip()) for x in os.environ.get("HA_WATCH_CITY_IDS", "").split(",") if x.strip()
)
_WATCH_AREA_IDS = set(
    int(x.strip()) for x in os.environ.get("HA_WATCH_AREA_IDS", "").split(",") if x.strip()
)


def notify_alert(cities: list[str], threat: int, cat_label: str,
                 timestamp: str, is_drill: bool, notification_id: str | None):
    """Called after an ALERT is inserted. Fires webhook if any watched city matches."""
    if not _WEBHOOK_URL or not _WATCH_CITIES:
        return
    matched = [c for c in cities if c in _WATCH_CITIES]
    if not matched:
        return
    payload = {
        "type": "alert",
        "threat": threat,
        "cat_label": cat_label,
        "cities": matched,
        "all_cities": cities,
        "timestamp": timestamp,
        "is_drill": is_drill,
        "notification_id": notification_id,
    }
    _fire(payload)


def notify_system_message(label: str, title_en: str, body_en: str,
                          timestamp: str, cities_ids: list[int] | None,
                          areas_ids: list[int] | None):
    """Called after a SYSTEM_MESSAGE is inserted. Fires if watched area/city matches."""
    if not _WEBHOOK_URL:
        return

    # Check if this early warning covers our watched areas/cities
    matched_area = bool(_WATCH_AREA_IDS and areas_ids and _WATCH_AREA_IDS & set(areas_ids))
    matched_city = bool(_WATCH_CITY_IDS and cities_ids and _WATCH_CITY_IDS & set(cities_ids))

    if not matched_area and not matched_city:
        return

    payload = {
        "type": label.lower().replace(" ", "_"),  # "early_warning" or "all_clear" or "system"
        "title": title_en,
        "body": body_en,
        "timestamp": timestamp,
        "areas_ids": areas_ids or [],
        "cities_ids": cities_ids or [],
    }
    _fire(payload)


def _fire(payload: dict):
    """POST JSON to HA webhook in a background thread (non-blocking)."""
    def _post():
        try:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            req = Request(_WEBHOOK_URL, data=data, method="POST")
            req.add_header("Content-Type", "application/json")
            with urlopen(req, timeout=5) as resp:
                logger.info(f"[ha_webhook] sent {payload['type']} → {resp.status}")
        except URLError as e:
            logger.warning(f"[ha_webhook] failed to reach HA: {e}")
        except Exception as e:
            logger.error(f"[ha_webhook] unexpected error: {e}")

    threading.Thread(target=_post, name="ha-webhook", daemon=True).start()
