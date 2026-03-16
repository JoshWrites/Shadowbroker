"""Signal Archive — entry point.

Loads the conflict registry, starts all enabled collectors, and
serves the backfill API on port 7654.
"""
import logging
import importlib
import sys
import threading
from pathlib import Path

import uvicorn
import yaml

from api import app

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("main")

REGISTRY_PATH = Path(__file__).parent / "config" / "conflicts.yaml"


def load_registry() -> dict:
    with open(REGISTRY_PATH) as f:
        return yaml.safe_load(f)


def start_collectors(registry: dict) -> list:
    """Instantiate and start all enabled collectors. Returns collector list."""
    collectors = []
    for key, cfg in registry.get("conflicts", {}).items():
        if not cfg.get("enabled", False):
            logger.info(f"[{key}] disabled — skipping")
            continue
        collector_mod = cfg.get("collector")
        if not collector_mod:
            logger.warning(f"[{key}] no 'collector' key in config — skipping")
            continue
        try:
            mod = importlib.import_module(f"collectors.{collector_mod}")
        except ImportError as e:
            logger.error(f"[{key}] cannot import collectors.{collector_mod}: {e}")
            continue

        # Find the first BaseCollector subclass in the module
        from collectors.base import BaseCollector
        collector_cls = None
        for attr in dir(mod):
            obj = getattr(mod, attr)
            try:
                if isinstance(obj, type) and issubclass(obj, BaseCollector) and obj is not BaseCollector:
                    collector_cls = obj
                    break
            except TypeError:
                continue

        if collector_cls is None:
            logger.error(f"[{key}] no BaseCollector subclass found in collectors.{collector_mod}")
            continue

        try:
            c = collector_cls()
            c.start()
            collectors.append(c)
            logger.info(f"[{key}] started → signal={c.signal}, poll={c.poll_seconds}s")
        except Exception as e:
            logger.error(f"[{key}] failed to start: {e}")

    return collectors


if __name__ == "__main__":
    logger.info("Signal Archive starting up")

    registry = load_registry()
    enabled = sum(1 for v in registry.get("conflicts", {}).values() if v.get("enabled"))
    logger.info(f"Conflict registry loaded: {len(registry.get('conflicts', {}))} total, {enabled} enabled")

    collectors = start_collectors(registry)
    if not collectors:
        logger.warning("No collectors started — archive will serve cached data only")

    logger.info("API listening on :7654")
    uvicorn.run(app, host="0.0.0.0", port=7654, log_level="warning")
