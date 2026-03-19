"""Cloudflare Radar integration — BGP anomalies, traffic anomalies, DDoS arcs, IQI.

All four features are gated on CLOUDFLARE_RADAR_TOKEN. If the token is absent,
every fetch function is a no-op and the UI layers show empty data gracefully.

Features:
  1. BGP Anomalies (hijacks + leaks) — persisted to SQLite, 15-min poll
  2. CF Traffic Anomalies — persisted to SQLite, 5-min poll
  3. Active DDoS Arcs (L7 top attacks) — ring buffer only, 5-min poll
  4. Internet Quality Index (IQI) — in-memory summary, 30-min poll (slow tier)

API base: https://api.cloudflare.com/client/v4/radar
Auth: Bearer token (Account > Radar > Read)
"""
import json
import logging
import os
import sqlite3
import threading
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from services.fetchers._store import latest_data, _data_lock, _mark_fresh
from services.network_utils import fetch_with_curl

logger = logging.getLogger(__name__)

_CF_BASE = "https://api.cloudflare.com/client/v4/radar"
_BGP_DB_PATH = Path("/app/data/bgp_anomalies.db")
_CF_ANOMALIES_DB_PATH = Path("/app/data/cf_anomalies.db")

# ---------------------------------------------------------------------------
# Country centroids — loaded once from backend/data/country_centroids.json
# ---------------------------------------------------------------------------

_CENTROIDS: dict = {}
_centroids_loaded = False
_centroids_lock = threading.Lock()


def _load_centroids():
    global _CENTROIDS, _centroids_loaded
    with _centroids_lock:
        if _centroids_loaded:
            return
        try:
            data_path = Path(__file__).parent.parent.parent / "data" / "country_centroids.json"
            with open(data_path) as f:
                _CENTROIDS = json.load(f)
            _centroids_loaded = True
            logger.info(f"Cloudflare Radar: loaded {len(_CENTROIDS)} country centroids")
        except Exception as e:
            logger.error(f"Cloudflare Radar: failed to load country centroids: {e}")


def _centroid(country_code: str) -> tuple[float | None, float | None]:
    """Return (lat, lng) for a country ISO code, or (None, None) if unknown."""
    if not _centroids_loaded:
        _load_centroids()
    c = _CENTROIDS.get((country_code or "").upper())
    if c:
        return c["lat"], c["lng"]
    return None, None


# ---------------------------------------------------------------------------
# Shared CF request headers
# ---------------------------------------------------------------------------

def _cf_headers() -> dict:
    token = os.environ.get("CLOUDFLARE_RADAR_TOKEN", "").strip()
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }


def _has_token() -> bool:
    return bool(os.environ.get("CLOUDFLARE_RADAR_TOKEN", "").strip())


# ---------------------------------------------------------------------------
# BGP Anomalies — SQLite persistence
# ---------------------------------------------------------------------------

_bgp_db_lock = threading.Lock()


def init_bgp_db():
    """Create BGP anomalies table. Safe to call multiple times."""
    try:
        _BGP_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _bgp_db_lock:
            conn = sqlite3.connect(_BGP_DB_PATH)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS events (
                    id                TEXT PRIMARY KEY,
                    type              TEXT NOT NULL,
                    ts                REAL,
                    hijacker_asn      INTEGER,
                    hijacker_country  TEXT,
                    hijacker_org      TEXT,
                    hijacker_lat      REAL,
                    hijacker_lng      REAL,
                    victim_asn        INTEGER,
                    victim_country    TEXT,
                    victim_org        TEXT,
                    victim_lat        REAL,
                    victim_lng        REAL,
                    affected_prefixes TEXT,
                    confidence_score  INTEGER,
                    peer_count        INTEGER,
                    timestamp         TEXT NOT NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_ts ON events (ts)")
            conn.commit()
            conn.close()
        logger.info(f"Cloudflare Radar: BGP DB ready at {_BGP_DB_PATH}")
    except Exception as e:
        logger.error(f"Cloudflare Radar: BGP DB init error: {e}")


def _persist_bgp_events(records: list[dict]):
    if not records:
        return
    try:
        with _bgp_db_lock:
            conn = sqlite3.connect(_BGP_DB_PATH)
            conn.executemany(
                """INSERT OR IGNORE INTO events
                   (id, type, ts, hijacker_asn, hijacker_country, hijacker_org,
                    hijacker_lat, hijacker_lng, victim_asn, victim_country, victim_org,
                    victim_lat, victim_lng, affected_prefixes, confidence_score, peer_count, timestamp)
                   VALUES (:id, :type, :ts, :hijacker_asn, :hijacker_country, :hijacker_org,
                    :hijacker_lat, :hijacker_lng, :victim_asn, :victim_country, :victim_org,
                    :victim_lat, :victim_lng, :affected_prefixes, :confidence_score, :peer_count, :timestamp)""",
                records,
            )
            conn.commit()
            conn.close()
    except Exception as e:
        logger.error(f"Cloudflare Radar: BGP persist error: {e}")


def query_bgp_anomalies(from_ts: float, until_ts: float) -> list[dict]:
    try:
        with _bgp_db_lock:
            conn = sqlite3.connect(_BGP_DB_PATH)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM events WHERE ts >= ? AND ts <= ? ORDER BY ts DESC",
                (from_ts, until_ts),
            ).fetchall()
            conn.close()
        return [dict(r) for r in rows]
    except Exception as e:
        logger.error(f"Cloudflare Radar: BGP query error: {e}")
        return []


def get_bgp_db_range() -> dict:
    try:
        with _bgp_db_lock:
            conn = sqlite3.connect(_BGP_DB_PATH)
            row = conn.execute(
                "SELECT MIN(ts), MAX(ts), COUNT(*) FROM events WHERE ts IS NOT NULL"
            ).fetchone()
            conn.close()
        if row and row[2]:
            return {"earliest": row[0], "latest": row[1], "count": row[2]}
    except Exception as e:
        logger.error(f"Cloudflare Radar: BGP range error: {e}")
    return {"earliest": None, "latest": None, "count": 0}


# ---------------------------------------------------------------------------
# CF Traffic Anomalies — SQLite persistence
# ---------------------------------------------------------------------------

_cf_db_lock = threading.Lock()


def init_cf_anomalies_db():
    """Create CF traffic anomalies table. Safe to call multiple times."""
    try:
        _CF_ANOMALIES_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _cf_db_lock:
            conn = sqlite3.connect(_CF_ANOMALIES_DB_PATH)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS anomalies (
                    id            TEXT PRIMARY KEY,
                    ts            REAL,
                    location      TEXT,
                    location_name TEXT,
                    lat           REAL,
                    lng           REAL,
                    status        TEXT,
                    description   TEXT,
                    timestamp     TEXT NOT NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_ts ON anomalies (ts)")
            conn.commit()
            conn.close()
        logger.info(f"Cloudflare Radar: CF anomalies DB ready at {_CF_ANOMALIES_DB_PATH}")
    except Exception as e:
        logger.error(f"Cloudflare Radar: CF anomalies DB init error: {e}")


def _persist_cf_anomalies(records: list[dict]):
    if not records:
        return
    try:
        with _cf_db_lock:
            conn = sqlite3.connect(_CF_ANOMALIES_DB_PATH)
            conn.executemany(
                """INSERT OR IGNORE INTO anomalies
                   (id, ts, location, location_name, lat, lng, status, description, timestamp)
                   VALUES (:id, :ts, :location, :location_name, :lat, :lng, :status, :description, :timestamp)""",
                records,
            )
            conn.commit()
            conn.close()
    except Exception as e:
        logger.error(f"Cloudflare Radar: CF anomalies persist error: {e}")


def query_cf_anomalies(from_ts: float, until_ts: float) -> list[dict]:
    try:
        with _cf_db_lock:
            conn = sqlite3.connect(_CF_ANOMALIES_DB_PATH)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM anomalies WHERE ts >= ? AND ts <= ? ORDER BY ts DESC",
                (from_ts, until_ts),
            ).fetchall()
            conn.close()
        return [dict(r) for r in rows]
    except Exception as e:
        logger.error(f"Cloudflare Radar: CF anomalies query error: {e}")
        return []


def get_cf_anomalies_db_range() -> dict:
    try:
        with _cf_db_lock:
            conn = sqlite3.connect(_CF_ANOMALIES_DB_PATH)
            row = conn.execute(
                "SELECT MIN(ts), MAX(ts), COUNT(*) FROM anomalies WHERE ts IS NOT NULL"
            ).fetchone()
            conn.close()
        if row and row[2]:
            return {"earliest": row[0], "latest": row[1], "count": row[2]}
    except Exception as e:
        logger.error(f"Cloudflare Radar: CF anomalies range error: {e}")
    return {"earliest": None, "latest": None, "count": 0}


# ---------------------------------------------------------------------------
# Ring buffers
# ---------------------------------------------------------------------------

_bgp_ring: deque = deque(maxlen=500)
_bgp_ring_lock = threading.Lock()
_bgp_seen_ids: set = set()

_cf_ring: deque = deque(maxlen=200)
_cf_ring_lock = threading.Lock()
_cf_seen_ids: set = set()

_ddos_ring: deque = deque(maxlen=100)
_ddos_ring_lock = threading.Lock()


def _add_to_bgp_ring(records: list[dict]):
    with _bgp_ring_lock:
        for r in records:
            rid = r.get("id", "")
            if rid and rid not in _bgp_seen_ids:
                _bgp_seen_ids.add(rid)
                _bgp_ring.appendleft(dict(r))
        if len(_bgp_seen_ids) > 20000:
            _bgp_seen_ids.clear()


def _add_to_cf_ring(records: list[dict]):
    with _cf_ring_lock:
        for r in records:
            rid = r.get("id", "")
            if rid and rid not in _cf_seen_ids:
                _cf_seen_ids.add(rid)
                _cf_ring.appendleft(dict(r))
        if len(_cf_seen_ids) > 5000:
            _cf_seen_ids.clear()


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def _parse_ts(s: str | None, fallback: float) -> float:
    """Parse a CF API timestamp string (UTC) to Unix epoch."""
    if not s:
        return fallback
    try:
        return datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
    except (ValueError, TypeError):
        return fallback


def _build_asn_lookup(asn_info: list) -> dict:
    """Build {asn_int: {org_name, country_code}} from CF asn_info array."""
    lookup = {}
    for entry in (asn_info or []):
        asn = entry.get("asn")
        if asn is not None:
            lookup[int(asn)] = {
                "org_name": entry.get("org_name", ""),
                "country_code": entry.get("country_code", ""),
            }
    return lookup


# ---------------------------------------------------------------------------
# Feature 1: BGP Anomalies
# ---------------------------------------------------------------------------

def fetch_bgp_anomalies():
    """Poll BGP hijack and leak events from Cloudflare Radar. Called every 15 minutes."""
    if not _has_token():
        with _data_lock:
            latest_data["bgp_anomalies"] = list(_bgp_ring)
        _mark_fresh("bgp_anomalies")
        return

    if not _centroids_loaded:
        _load_centroids()

    now_ts = datetime.now(timezone.utc).timestamp()
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    headers = _cf_headers()
    new_records = []

    # --- Hijacks ---
    try:
        resp = fetch_with_curl(
            f"{_CF_BASE}/bgp/hijacks/events?date_range=3d&per_page=100&sort_by=TIME&sort_order=DESC",
            timeout=15,
            headers=headers,
        )
        if resp.status_code == 200:
            data = resp.json()
            result = data.get("result", {})
            asn_lookup = _build_asn_lookup(result.get("asn_info", []))
            for ev in result.get("events", []):
                hijacker_asn = ev.get("hijacker_asn") or 0
                victim_asns = ev.get("victim_asns") or []
                victim_countries = ev.get("victim_countries") or []
                victim_asn = victim_asns[0] if victim_asns else 0
                victim_country = (victim_countries[0] if victim_countries else "").upper()
                hijacker_country = (ev.get("hijacker_country") or "").upper()

                # Skip self-arcs and unknown endpoints
                if not hijacker_country or not victim_country or hijacker_country == victim_country:
                    continue

                h_lat, h_lng = _centroid(hijacker_country)
                v_lat, v_lng = _centroid(victim_country)
                if h_lat is None or v_lat is None:
                    continue

                hijacker_info = asn_lookup.get(int(hijacker_asn), {})
                victim_info = asn_lookup.get(int(victim_asn), {})

                ts = _parse_ts(ev.get("min_hijack_ts"), now_ts)
                record = {
                    "id": f"hijack-{ev.get('id', '')}",
                    "type": "hijack",
                    "ts": ts,
                    "hijacker_asn": int(hijacker_asn),
                    "hijacker_country": hijacker_country,
                    "hijacker_org": hijacker_info.get("org_name", ""),
                    "hijacker_lat": h_lat,
                    "hijacker_lng": h_lng,
                    "victim_asn": int(victim_asn),
                    "victim_country": victim_country,
                    "victim_org": victim_info.get("org_name", ""),
                    "victim_lat": v_lat,
                    "victim_lng": v_lng,
                    "affected_prefixes": json.dumps(ev.get("prefixes") or []),
                    "confidence_score": int(ev.get("confidence_score") or 0),
                    "peer_count": int(ev.get("peer_ip_count") or 0),
                    "timestamp": ev.get("min_hijack_ts") or now_iso,
                }
                new_records.append(record)
        elif resp.status_code == 403:
            logger.warning("Cloudflare Radar: BGP hijacks — 403 Forbidden (check token permissions)")
        else:
            logger.warning(f"Cloudflare Radar: BGP hijacks returned HTTP {resp.status_code}")
    except Exception as e:
        logger.error(f"Cloudflare Radar: BGP hijacks fetch error: {e}")

    # --- Leaks ---
    try:
        resp = fetch_with_curl(
            f"{_CF_BASE}/bgp/leaks/events?date_range=3d&per_page=100&sort_by=TIME&sort_order=DESC",
            timeout=15,
            headers=headers,
        )
        if resp.status_code == 200:
            data = resp.json()
            result = data.get("result", {})
            asn_lookup = _build_asn_lookup(result.get("asn_info", []))
            for ev in result.get("events", []):
                leak_asn = ev.get("leak_asn") or 0
                countries = ev.get("countries") or []
                if len(countries) < 2:
                    continue
                # Use first country as leaker origin, second as victim
                leaker_country = countries[0].upper()
                victim_country = countries[1].upper()
                if leaker_country == victim_country:
                    continue

                h_lat, h_lng = _centroid(leaker_country)
                v_lat, v_lng = _centroid(victim_country)
                if h_lat is None or v_lat is None:
                    continue

                leaker_info = asn_lookup.get(int(leak_asn), {})
                ts = _parse_ts(ev.get("detected_ts") or ev.get("min_ts"), now_ts)
                record = {
                    "id": f"leak-{ev.get('id', '')}",
                    "type": "leak",
                    "ts": ts,
                    "hijacker_asn": int(leak_asn),
                    "hijacker_country": leaker_country,
                    "hijacker_org": leaker_info.get("org_name", ""),
                    "hijacker_lat": h_lat,
                    "hijacker_lng": h_lng,
                    "victim_asn": 0,
                    "victim_country": victim_country,
                    "victim_org": "",
                    "victim_lat": v_lat,
                    "victim_lng": v_lng,
                    "affected_prefixes": json.dumps([]),
                    "confidence_score": 0,
                    "peer_count": int(ev.get("peer_count") or 0),
                    "timestamp": ev.get("detected_ts") or ev.get("min_ts") or now_iso,
                }
                new_records.append(record)
        elif resp.status_code != 403:
            logger.warning(f"Cloudflare Radar: BGP leaks returned HTTP {resp.status_code}")
    except Exception as e:
        logger.error(f"Cloudflare Radar: BGP leaks fetch error: {e}")

    if new_records:
        _add_to_bgp_ring(new_records)
        _persist_bgp_events(new_records)
        logger.info(f"Cloudflare Radar: {len(new_records)} BGP events (hijacks+leaks)")

    with _bgp_ring_lock:
        ring_list = list(_bgp_ring)

    with _data_lock:
        latest_data["bgp_anomalies"] = ring_list

    _mark_fresh("bgp_anomalies")


# ---------------------------------------------------------------------------
# Feature 2: CF Traffic Anomalies
# ---------------------------------------------------------------------------

def fetch_cf_anomalies():
    """Poll Cloudflare traffic anomalies. Called every 5 minutes."""
    if not _has_token():
        with _data_lock:
            latest_data["cf_anomalies"] = list(_cf_ring)
        _mark_fresh("cf_anomalies")
        return

    if not _centroids_loaded:
        _load_centroids()

    now_ts = datetime.now(timezone.utc).timestamp()
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    headers = _cf_headers()
    new_records = []

    try:
        resp = fetch_with_curl(
            f"{_CF_BASE}/traffic_anomalies?date_range=7d&limit=100",
            timeout=15,
            headers=headers,
        )
        if resp.status_code == 200:
            data = resp.json()
            anomalies = data.get("result", {}).get("traffic_anomalies", [])
            for a in anomalies:
                loc_details = a.get("location_details") or {}
                asn_details = a.get("asn_details") or {}
                # Prefer location_details, fall back to asn_details.locations
                loc_code = (loc_details.get("code") or
                            (asn_details.get("locations") or {}).get("code") or "").upper()
                loc_name = (loc_details.get("name") or
                            (asn_details.get("locations") or {}).get("name") or loc_code)

                if not loc_code:
                    continue

                lat, lng = _centroid(loc_code)
                if lat is None:
                    continue

                ts = _parse_ts(a.get("start_date"), now_ts)
                uid = f"cf-{a.get('uuid', f'{loc_code}-{int(ts)}')}"
                status = (a.get("status") or "UNVERIFIED").upper()
                record = {
                    "id": uid,
                    "ts": ts,
                    "location": loc_code,
                    "location_name": loc_name,
                    "lat": lat,
                    "lng": lng,
                    "status": status,
                    "description": str(a.get("description") or ""),
                    "timestamp": a.get("start_date") or now_iso,
                }
                new_records.append(record)
        elif resp.status_code == 403:
            logger.warning("Cloudflare Radar: traffic anomalies — 403 Forbidden (check token permissions)")
        else:
            logger.warning(f"Cloudflare Radar: traffic anomalies returned HTTP {resp.status_code}")
    except Exception as e:
        logger.error(f"Cloudflare Radar: CF anomalies fetch error: {e}")

    if new_records:
        _add_to_cf_ring(new_records)
        _persist_cf_anomalies(new_records)
        logger.info(f"Cloudflare Radar: {len(new_records)} traffic anomalies")

    with _cf_ring_lock:
        ring_list = list(_cf_ring)

    with _data_lock:
        latest_data["cf_anomalies"] = ring_list

    _mark_fresh("cf_anomalies")


# ---------------------------------------------------------------------------
# Feature 3: Active DDoS Arcs (ring buffer only)
# ---------------------------------------------------------------------------

def fetch_active_ddos():
    """Poll L7 top attack pairs from Cloudflare Radar. Called every 5 minutes.
    Ring buffer only — no SQLite persistence, no history endpoint.
    """
    if not _has_token():
        with _data_lock:
            latest_data["active_ddos"] = []
        _mark_fresh("active_ddos")
        return

    if not _centroids_loaded:
        _load_centroids()

    now_ts = datetime.now(timezone.utc).timestamp()
    headers = _cf_headers()
    records = []

    try:
        resp = fetch_with_curl(
            f"{_CF_BASE}/attacks/layer7/top/attacks?date_range=1d&limit=20&normalization=PERCENTAGE",
            timeout=15,
            headers=headers,
        )
        if resp.status_code == 200:
            data = resp.json()
            attacks = data.get("result", {}).get("top_0", [])
            for a in attacks:
                origin = (a.get("origin_country_alpha2") or "").upper()
                target = (a.get("target_country_alpha2") or "").upper()
                if not origin or not target or origin == target:
                    continue

                o_lat, o_lng = _centroid(origin)
                t_lat, t_lng = _centroid(target)
                if o_lat is None or t_lat is None:
                    continue

                try:
                    pct = float(a.get("value") or 0)
                except (ValueError, TypeError):
                    pct = 0.0

                ts_int = int(now_ts)
                records.append({
                    "id": f"ddos-{origin}-{target}-{ts_int}",
                    "ts": now_ts,
                    "origin_country": origin,
                    "origin_country_name": a.get("origin_country_name") or origin,
                    "origin_lat": o_lat,
                    "origin_lng": o_lng,
                    "target_country": target,
                    "target_country_name": a.get("target_country_name") or target,
                    "target_lat": t_lat,
                    "target_lng": t_lng,
                    "requests_percent": pct,
                    "layer": "L7",
                })
        elif resp.status_code == 403:
            logger.warning("Cloudflare Radar: DDoS top attacks — 403 Forbidden (check token permissions)")
        else:
            logger.warning(f"Cloudflare Radar: DDoS top attacks returned HTTP {resp.status_code}")
    except Exception as e:
        logger.error(f"Cloudflare Radar: DDoS fetch error: {e}")

    if records:
        logger.info(f"Cloudflare Radar: {len(records)} active DDoS attack pairs")

    with _data_lock:
        latest_data["active_ddos"] = records

    _mark_fresh("active_ddos")


# ---------------------------------------------------------------------------
# Feature 4: Internet Quality Index (IQI) — slow tier, no persistence
# ---------------------------------------------------------------------------

def fetch_internet_quality():
    """Fetch IQI summary metrics (bandwidth, latency, DNS). Called every 30 minutes."""
    if not _has_token():
        return

    headers = _cf_headers()
    result = {}

    for metric, key in [("BANDWIDTH", "bandwidth_p50"), ("LATENCY", "latency_p50"), ("DNS", "dns_p50")]:
        try:
            resp = fetch_with_curl(
                f"{_CF_BASE}/quality/iqi/summary?metric={metric}",
                timeout=15,
                headers=headers,
            )
            if resp.status_code == 200:
                data = resp.json()
                summary = data.get("result", {}).get("summary_0", {})
                p50 = summary.get("p50")
                if p50 is not None:
                    try:
                        result[key] = float(p50)
                    except (ValueError, TypeError):
                        pass
            elif resp.status_code == 403:
                logger.warning(f"Cloudflare Radar: IQI {metric} — 403 Forbidden")
                break
        except Exception as e:
            logger.error(f"Cloudflare Radar: IQI {metric} fetch error: {e}")

    if result:
        with _data_lock:
            latest_data["internet_quality"] = result
        logger.info(f"Cloudflare Radar: IQI updated — {result}")
