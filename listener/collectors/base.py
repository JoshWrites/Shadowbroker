"""Base class for all signal collectors.

Each collector subclass implements:
  - collect() → list[dict]   — fetch latest events from source
  - collect_history() → list[dict]  — fetch recent history (optional)

The base class handles the poll loop, persistence, dedup, and logging.
"""
import logging
import time
import threading
from db import init_db, insert_events

logger = logging.getLogger(__name__)


class BaseCollector:
    signal: str = ""          # DB/API identifier, e.g. "pikud_alerts"
    poll_seconds: int = 60    # How often to call collect()
    history_poll_minutes: int = 0  # 0 = no history polling

    def __init__(self):
        assert self.signal, "Collector must define signal"
        init_db(self.signal)
        self._stop = threading.Event()
        self._history_thread: threading.Thread | None = None

    def collect(self) -> list[dict]:
        """Fetch current events. Return list of dicts with at minimum:
            id (str), ts (float), lat (float|None), lng (float|None),
            payload (dict of signal-specific fields)
        """
        raise NotImplementedError

    def collect_history(self) -> list[dict]:
        """Fetch recent history. Optional — return [] if not supported."""
        return []

    def _run_live(self):
        logger.info(f"[{self.signal}] Live collector started (every {self.poll_seconds}s)")
        while not self._stop.is_set():
            try:
                events = self.collect()
                if events:
                    n = insert_events(self.signal, events)
                    if n:
                        logger.info(f"[{self.signal}] +{n} new events ({len(events)} fetched)")
            except Exception as e:
                logger.error(f"[{self.signal}] collect() error: {e}")
            self._stop.wait(self.poll_seconds)

    def _run_history(self):
        interval = self.history_poll_minutes * 60
        logger.info(f"[{self.signal}] History collector started (every {self.history_poll_minutes}min)")
        while not self._stop.is_set():
            try:
                events = self.collect_history()
                if events:
                    n = insert_events(self.signal, events)
                    if n:
                        logger.info(f"[{self.signal}] history +{n} new events")
            except Exception as e:
                logger.error(f"[{self.signal}] collect_history() error: {e}")
            self._stop.wait(interval)

    def start(self):
        """Start live (and optionally history) polling threads."""
        t = threading.Thread(target=self._run_live, name=f"{self.signal}-live", daemon=True)
        t.start()
        if self.history_poll_minutes > 0:
            self._history_thread = threading.Thread(
                target=self._run_history, name=f"{self.signal}-history", daemon=True
            )
            self._history_thread.start()

    def stop(self):
        self._stop.set()
