"""Pikud HaOref WebSocket collector — real-time Tzofar push feed.

Connects to wss://ws.tzevaadom.co.il/socket?platform=ANDROID and receives
ALERT and SYSTEM_MESSAGE events in real-time. Persists every event to the
unified pikud_alerts table for the Shadowbroker backfill API.

Runs alongside (not instead of) the poll-based PikudCollector: the poller
covers the Oref 24h history endpoint, while this collector catches every
live event with sub-second latency and richer data (threat type, drill
flag, multi-language titles, notification IDs).

Uses the unified pikud_alerts schema — flat rows, no JSON payload column.
Dedup keys differ by prefix: WS uses "tz-", poller uses "hist-" or
raw alert IDs — INSERT OR IGNORE prevents overlap.
"""
import asyncio
import json
import logging
import threading
import time
from datetime import datetime, timezone

from collectors.base import BaseCollector
from collectors.pikud import (
    ALERT_CATEGORIES,
    ALERT_COLORS,
    _load_lamas,
    _lamas_loaded,
    _resolve_city,
)
from db import insert_pikud_rows
from ha_webhook import notify_alert, notify_system_message

logger = logging.getLogger(__name__)

_TZOFAR_WS_URL = "wss://ws.tzevaadom.co.il/socket?platform=ANDROID"

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


def _safe_int(val, default: int = 0) -> int:
    if val is None:
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


def _safe_float(val) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


class PikudWSCollector(BaseCollector):
    signal = "pikud_alerts"
    poll_seconds = 9999        # collect() is a no-op; WS thread does the work
    history_poll_minutes = 0   # History backfill runs once at startup, not on a timer

    def __init__(self):
        super().__init__()
        _load_lamas()
        self._ws_stop = threading.Event()

    def collect(self) -> list[dict]:
        """No-op — the WebSocket thread persists directly via insert_pikud_rows."""
        return []

    def start(self):
        """Backfill any gap from when the listener was down, then go live on WS."""
        self._startup_backfill()

        t = threading.Thread(target=self._ws_thread, name="pikud-ws", daemon=True)
        t.start()
        logger.info(f"[{self.signal}] WebSocket collector started")

    def _startup_backfill(self):
        """Fetch Oref history once at startup to cover the gap while listener was down."""
        from collectors.pikud import PikudCollector
        try:
            poller = PikudCollector.__new__(PikudCollector)
            rows = poller.collect_history()
            if rows:
                n = insert_pikud_rows(rows)
                if n:
                    logger.info(f"[{self.signal}] startup backfill: +{n} events from Oref history")
                else:
                    logger.info(f"[{self.signal}] startup backfill: all {len(rows)} events already in DB")
            else:
                logger.info(f"[{self.signal}] startup backfill: no history available from Oref")
        except Exception as e:
            logger.error(f"[{self.signal}] startup backfill error: {e}")

    def stop(self):
        self._ws_stop.set()
        super().stop()

    # ------------------------------------------------------------------
    # WebSocket listener
    # ------------------------------------------------------------------

    def _ws_thread(self):
        """Run the async WS loop in a dedicated thread."""
        asyncio.run(self._ws_loop())

    async def _ws_loop(self):
        try:
            import websockets
        except ImportError:
            logger.error("[pikud] 'websockets' package not installed")
            return

        backoff = 1.0
        connect_count = 0

        while not self._ws_stop.is_set():
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
                    logger.info(f"[pikud] WebSocket connected (#{connect_count})")
                    async for raw in ws:
                        if self._ws_stop.is_set():
                            break
                        if isinstance(raw, bytes):
                            continue  # Binary keepalive
                        try:
                            msg = json.loads(raw)
                        except (ValueError, json.JSONDecodeError):
                            continue
                        if not isinstance(msg, dict):
                            continue

                        msg_type = str(msg.get("type", "")).upper()
                        data = msg.get("data", msg)

                        if msg_type == "ALERT":
                            self._handle_alert(data, msg)
                        elif msg_type in ("SYSTEM_MESSAGE", "SYSTEM"):
                            self._handle_system_message(data, msg)

            except Exception as e:
                if self._ws_stop.is_set():
                    break
                logger.warning(
                    f"[pikud] WebSocket disconnected (#{connect_count}): "
                    f"{type(e).__name__}: {e}"
                )

            if self._ws_stop.is_set():
                break
            logger.info(f"[pikud] WebSocket reconnecting in {backoff:.0f}s...")
            waited = 0.0
            while waited < backoff and not self._ws_stop.is_set():
                time.sleep(0.5)
                waited += 0.5
            backoff = min(backoff * 2, 30)

        logger.info("[pikud] WebSocket listener stopped")

    # ------------------------------------------------------------------
    # Message handlers — build flat rows for unified pikud_alerts table
    # ------------------------------------------------------------------

    def _handle_alert(self, data: dict, raw_msg: dict):
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
            alert_iso = datetime.fromtimestamp(alert_ts, tz=timezone.utc).strftime(
                "%Y-%m-%d %H:%M:%S"
            )
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
            fid = (
                f"tz-{notification_id}-{city}"
                if notification_id
                else f"tz-{alert_ts}-{city}"
            )
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

        if rows:
            n = insert_pikud_rows(rows)
            logger.info(
                f"[pikud] ALERT: threat={threat} ({cat_label}) "
                f"cities={[r['city'] for r in rows[:5]]}"
                + (f" +{len(rows)-5} more" if len(rows) > 5 else "")
                + (f" [DRILL]" if is_drill else "")
                + (f" ({n} new)" if n else " (all dupes)")
            )
            if n:  # Only notify on new alerts (not dupes)
                notify_alert(
                    cities=cities, threat=threat, cat_label=cat_label,
                    timestamp=alert_iso, is_drill=is_drill,
                    notification_id=notification_id or None,
                )

    def _handle_system_message(self, data: dict, raw_msg: dict):
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

        n = insert_pikud_rows([row])
        if n:
            body_en = data.get("bodyEn") or data.get("body") or ""
            title_en = data.get("titleEn") or ""
            logger.info(f"[pikud] {label}: {title_en} — {body_en}")
            notify_system_message(
                label=label, title_en=title_en, body_en=body_en,
                timestamp=ts_iso,
                cities_ids=data.get("citiesIds"),
                areas_ids=data.get("areasIds"),
            )
