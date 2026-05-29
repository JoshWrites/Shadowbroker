#!/usr/bin/env python3
"""One-time import of copy-pasted Oref web history into the unified pikud_alerts table.

Expected input format (from stdin or file argument):
    Each block is separated by blank lines and consists of:
      Line 1: Area names (comma-separated, Hebrew)
      Line 2: Timestamp line: לפני X שעות | DD/MM/YY (HH:MM) or (HH:MM - HH:MM)
      Line 3: City list (comma-separated, Hebrew)
      Line 4: Threat code: 0 (rockets), 5 (UAV), 50 or 05 (mixed salvo)

Usage:
    cat oref_history.txt | python3 import_oref_history.py
    python3 import_oref_history.py oref_history.txt
"""
import json
import logging
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Import the DB layer (we're in the listener directory)
sys.path.insert(0, str(Path(__file__).parent))
from db import init_pikud_db, insert_pikud_rows  # noqa: E402

# Try to load LAMAS for geo resolution
from collectors.pikud import _load_lamas, _resolve_city, ALERT_CATEGORIES, ALERT_COLORS  # noqa: E402

_IL_TZ = ZoneInfo("Asia/Jerusalem")

# Regex for timestamp parsing: DD/MM/YY (HH:MM) or DD/MM/YY (HH:MM - HH:MM)
_TS_PATTERN = re.compile(
    r'(\d{1,2})/(\d{1,2})/(\d{2})\s*'
    r'\((\d{1,2}):(\d{2})'
    r'(?:\s*-\s*\d{1,2}:\d{2})?'  # optional end time — ignored, use start
    r'\)'
)

# Tzofar threat → cat mapping
_THREAT_TO_CAT = {
    0: "1",   # Rockets
    5: "5",   # UAV
}


def parse_timestamp(line: str) -> float | None:
    """Parse a timestamp line like 'לפני 3 שעות | 19/03/26 (07:46)' → Unix epoch."""
    m = _TS_PATTERN.search(line)
    if not m:
        return None
    day, month, year_2d, hour, minute = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5))
    year = 2000 + year_2d
    try:
        dt = datetime(year, month, day, hour, minute, tzinfo=_IL_TZ)
        return dt.timestamp()
    except (ValueError, OverflowError):
        return None


def parse_blocks(text: str) -> list[dict]:
    """Parse the pasted text into structured blocks.

    The input format has blank lines between every field:
        areas line
        (blank)
        timestamp line
        (blank)
        cities line
        (blank)
        threat code
        next areas line ...

    We strip blank lines and group every 4 non-empty lines as one block.
    """
    blocks = []
    # Strip blank lines, group every 4 non-empty lines
    non_empty = [l.strip() for l in text.strip().splitlines() if l.strip()]

    for i in range(0, len(non_empty) - 3, 4):
        areas = non_empty[i]
        ts_line = non_empty[i + 1]
        cities_str = non_empty[i + 2]
        threat_str = non_empty[i + 3].strip()

        ts = parse_timestamp(ts_line)
        if ts is None:
            logger.warning(f"Could not parse timestamp: {ts_line}")
            continue

        cities = [c.strip() for c in cities_str.split(",") if c.strip()]
        if not cities:
            logger.warning(f"No cities found in block: {cities_str[:80]}")
            continue

        # Handle mixed salvos: "50" or "05" → two events (threat 0 + threat 5)
        threats = []
        if threat_str in ("50", "05"):
            threats = [0, 5]
        else:
            try:
                threats = [int(threat_str)]
            except ValueError:
                logger.warning(f"Unknown threat code: {threat_str}")
                continue

        blocks.append({
            "areas": areas,
            "ts": ts,
            "cities": cities,
            "threats": threats,
        })

    return blocks


def build_rows(blocks: list[dict]) -> list[dict]:
    """Convert parsed blocks into flat pikud_alerts rows."""
    rows = []
    for block in blocks:
        ts = block["ts"]
        dt = datetime.fromtimestamp(ts, tz=_IL_TZ)
        ts_tag = dt.strftime("%y%m%d-%H%M")
        iso_str = datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")

        for threat in block["threats"]:
            cat = _THREAT_TO_CAT.get(threat, str(threat))
            cat_label = ALERT_CATEGORIES.get(cat, f"Category {cat}")
            color = ALERT_COLORS.get(cat, "#ff2222")

            for city in block["cities"]:
                geo = _resolve_city(city)
                fid = f"owh-{ts_tag}-{city}"
                if len(block["threats"]) > 1:
                    fid = f"owh-{ts_tag}-t{threat}-{city}"

                rows.append({
                    "id": fid,
                    "source": "oref_web_history",
                    "ts": ts,
                    "timestamp": iso_str,
                    "lat": geo["lat"] if geo else None,
                    "lng": geo["lng"] if geo else None,
                    "city": city,
                    "area": geo.get("area", "") if geo else block["areas"].split(",")[0].strip(),
                    "msg_type": "ALERT",
                    "cat": cat,
                    "cat_label": cat_label,
                    "threat": threat,
                    "color": color,
                    "title": cat_label,
                    "raw_json": json.dumps({
                        "_import": "oref_web_history",
                        "areas_text": block["areas"],
                    }, ensure_ascii=False),
                })

    return rows


def main():
    # Read input
    if len(sys.argv) > 1:
        input_path = Path(sys.argv[1])
        if not input_path.exists():
            logger.error(f"File not found: {input_path}")
            sys.exit(1)
        text = input_path.read_text(encoding="utf-8")
    else:
        text = sys.stdin.read()

    if not text.strip():
        logger.error("No input provided")
        sys.exit(1)

    # Initialize
    init_pikud_db()
    _load_lamas()

    # Parse
    blocks = parse_blocks(text)
    logger.info(f"Parsed {len(blocks)} alert blocks")

    if not blocks:
        logger.info("Nothing to import")
        return

    # Build rows
    rows = build_rows(blocks)
    logger.info(f"Built {len(rows)} rows from {len(blocks)} blocks")

    # Insert
    inserted = insert_pikud_rows(rows)
    logger.info(f"Inserted {inserted} new rows ({len(rows) - inserted} duplicates skipped)")


if __name__ == "__main__":
    main()
