"""Train tracking fetchers — Amtrak (US) via Amtraker API + Israel Railways schedule data."""
import logging
from services.network_utils import fetch_with_curl
from services.fetchers._store import latest_data, _data_lock, _mark_fresh
from services.fetchers.retry import with_retry

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Amtrak — live train positions via Amtraker v3 community API
# ---------------------------------------------------------------------------
AMTRAKER_URL = "https://api-v3.amtraker.com/v3/trains"

# Heading abbreviation → degrees (for map rotation)
_HEADING_DEG = {
    "N": 0, "NE": 45, "NNE": 22, "ENE": 67,
    "E": 90, "SE": 135, "ESE": 112, "SSE": 157,
    "S": 180, "SW": 225, "SSW": 202, "WSW": 247,
    "W": 270, "NW": 315, "WNW": 292, "NNW": 337,
}


def _parse_stations(raw_stations: list) -> list[dict]:
    """Parse Amtraker station list into compact dicts."""
    stations = []
    for s in raw_stations:
        stations.append({
            "name": s.get("name", ""),
            "code": s.get("code", ""),
            "status": s.get("status", ""),
            "sch_arr": s.get("schArr", ""),
            "sch_dep": s.get("schDep", ""),
            "arr": s.get("arr", ""),
            "dep": s.get("dep", ""),
            "arr_cmnt": s.get("arrCmnt", ""),
            "dep_cmnt": s.get("depCmnt", ""),
            "bus": s.get("bus", False),
        })
    return stations


def _find_next_stop(stations: list[dict]) -> str:
    """Find the next station the train hasn't arrived at yet."""
    for s in stations:
        st = s.get("status", "")
        if st in ("Enroute", "Next", ""):
            return s.get("name", "")
    return ""


def _find_last_departed(stations: list[dict]) -> str:
    """Find the last station the train departed from."""
    last = ""
    for s in stations:
        st = s.get("status", "")
        if st == "Departed":
            last = s.get("name", "")
    return last


def _parse_amtrak(raw: dict) -> list[dict]:
    """Parse Amtraker v3 response into normalised train dicts."""
    trains = []
    for _train_num, train_list in raw.items():
        if not isinstance(train_list, list):
            continue
        for t in train_list:
            lat = t.get("lat")
            lon = t.get("lon")
            if lat is None or lon is None:
                continue
            try:
                lat, lon = float(lat), float(lon)
            except (ValueError, TypeError):
                continue
            heading_str = t.get("heading", "")
            heading = _HEADING_DEG.get(heading_str, 0)
            velocity = t.get("velocity") or 0
            try:
                velocity = float(velocity)
            except (ValueError, TypeError):
                velocity = 0

            # Parse full station list
            raw_stations = t.get("stations", [])
            stations = _parse_stations(raw_stations) if raw_stations else []
            next_stop = _find_next_stop(stations)
            last_departed = _find_last_departed(stations)

            # Status & timing
            status = t.get("trainTimely", "")
            train_state = t.get("trainState", "")  # "Active", "Predeparture", etc.
            status_msg = t.get("statusMsg", "")

            trains.append({
                "id": f"amtrak-{t.get('trainNum', '')}-{t.get('trainID', '')}",
                "name": t.get("routeName", f"Train {t.get('trainNum', '?')}"),
                "train_num": str(t.get("trainNum", "")),
                "operator": "Amtrak",
                "country": "US",
                "lat": lat,
                "lng": lon,
                "heading": heading,
                "speed_mph": velocity,
                "status": status,
                "train_state": train_state,
                "status_msg": status_msg,
                "origin": t.get("origName", ""),
                "destination": t.get("destName", ""),
                "origin_code": t.get("origCode", ""),
                "dest_code": t.get("destCode", ""),
                "last_station": last_departed or t.get("eventName", ""),
                "next_station": next_stop or t.get("eventName", ""),
                "service_type": "intercity",
                "route_name": t.get("routeName", ""),
                "stations": stations,
                "updated_at": t.get("updatedAt", ""),
            })
    return trains


@with_retry(max_retries=1, base_delay=2)
def fetch_amtrak() -> list[dict]:
    """Fetch all live Amtrak train positions."""
    resp = fetch_with_curl(AMTRAKER_URL, timeout=15, headers={
        "User-Agent": "ShadowBroker-OSINT/1.0",
    })
    if resp.status_code != 200:
        logger.warning("Amtraker API returned %d", resp.status_code)
        return []
    data = resp.json()
    if not isinstance(data, dict):
        return []
    return _parse_amtrak(data)


# ---------------------------------------------------------------------------
# Israel Railways — schedule-based positions via public timetable API
# ---------------------------------------------------------------------------
ISRAEL_RAIL_URL = "https://israelrail.azurefd.net/rjpa-prod/api/v1/timetable/searchTrain"


@with_retry(max_retries=1, base_delay=2)
def fetch_israel_trains() -> list[dict]:
    """Fetch Israel Railways active train data.

    The Israel Railways API is schedule-based (not GPS).  We query for
    currently-running trains and place them at their last-reported station.
    If the API is unavailable or changes, we gracefully return [].
    """
    from datetime import datetime, timezone, timedelta
    trains = []
    try:
        # Israel is UTC+2 / UTC+3
        now_utc = datetime.now(timezone.utc)
        now_israel = now_utc + timedelta(hours=3)
        date_str = now_israel.strftime("%Y-%m-%d")
        hour_str = now_israel.strftime("%H:%M")

        # Query the "all trains" endpoint
        url = f"https://www.rail.co.il/apiinfo/api/Plan/GetRoutesForDateTime?OId=0&TId=0&Date={date_str}&Hour={hour_str}"
        resp = fetch_with_curl(url, timeout=12, headers={
            "User-Agent": "ShadowBroker-OSINT/1.0",
            "Accept": "application/json",
        })
        if resp.status_code != 200:
            logger.debug("Israel Rail API returned %d — skipping", resp.status_code)
            return []

        data = resp.json()
        routes = data if isinstance(data, list) else data.get("Data", data.get("data", []))
        if not isinstance(routes, list):
            return []

        # Well-known Israel Railways station coordinates
        _STATION_COORDS = {
            "תל אביב - סבידור מרכז": (32.0564, 34.7724),
            "תל אביב - ההגנה": (32.0457, 34.7644),
            "תל אביב - השלום": (32.0716, 34.7919),
            "ירושלים - יצחק נבון": (31.7882, 35.2034),
            "חיפה - חוף הכרמל": (32.7972, 34.9548),
            "חיפה מרכז - השמונה": (32.7928, 34.9951),
            "באר שבע מרכז": (31.2434, 34.7980),
            "באר שבע צפון": (31.2647, 34.8019),
            "נתב\"ג": (32.0055, 34.8713),
            "הרצליה": (32.1623, 34.7944),
            "נתניה": (32.3258, 34.8564),
            "חדרה מערב": (32.4379, 34.8896),
            "אשדוד עד הלום": (31.8012, 34.6507),
            "אשקלון": (31.6654, 34.5716),
            "רחובות": (31.8896, 34.8091),
            "לוד": (31.9509, 34.8752),
            "רמלה": (31.9302, 34.8699),
            "עכו": (32.9273, 35.0867),
            "נהריה": (33.0108, 35.0965),
            "כרמיאל": (32.9192, 35.3039),
            "עפולה": (32.6039, 35.2917),
            "בית שאן": (32.5004, 35.4970),
            "קיסריה פרדס חנה": (32.4724, 34.9182),
            "בנימינה": (32.5184, 34.9466),
            "עתלית": (32.6919, 34.9379),
            "כפר סבא - נורדאו": (32.1833, 34.9017),
            "ראש העין צפון": (32.1042, 34.9558),
            "הוד השרון - סוקולוב": (32.1528, 34.8917),
            "שדרות": (31.5244, 34.5963),
            "אופקים": (31.3156, 34.6218),
            "דימונה": (31.0697, 35.0331),
            "ירוחם": (30.9877, 34.9283),
            "מודיעין מרכז": (31.8934, 35.0106),
            "פאתי מודיעין": (31.8781, 34.9797),
            "ראשון לציון - הראשונים": (31.9638, 34.7741),
            "ראשון לציון - משה דיין": (31.9830, 34.7505),
            "יבנה מערב": (31.8699, 34.7140),
            "יבנה מזרח": (31.8805, 34.7483),
            "קריית גת": (31.6080, 34.7723),
            "קריית מלאכי - יואב": (31.7210, 34.7420),
            "לב המפרץ": (32.7767, 35.0333),
        }

        for route in routes[:100]:  # cap to avoid huge lists
            train_num = route.get("TrainNumber") or route.get("trainNumber") or ""
            stops = route.get("StopStations") or route.get("Train", {}).get("StopStations", [])
            if not stops:
                continue
            # Find the last departed station
            last_station = stops[0]
            station_name = last_station.get("StationName", "")
            coords = _STATION_COORDS.get(station_name)
            if not coords:
                continue
            # (dest computed in station list below)
            # Build station list from stops
            il_stations = []
            for s in stops:
                il_stations.append({
                    "name": s.get("StationName", ""),
                    "code": str(s.get("StationId", "")),
                    "status": "",
                    "sch_arr": s.get("ArrivalTime", ""),
                    "sch_dep": s.get("DepartureTime", ""),
                    "arr": "", "dep": "",
                    "arr_cmnt": "", "dep_cmnt": "",
                    "bus": False,
                })
            origin_name = stops[0].get("StationName", "") if stops else ""
            dest_name_il = stops[-1].get("StationName", "") if len(stops) > 1 else origin_name
            trains.append({
                "id": f"israil-{train_num}",
                "name": f"Israel Rail {train_num}",
                "train_num": str(train_num),
                "operator": "Israel Railways",
                "country": "IL",
                "lat": coords[0],
                "lng": coords[1],
                "heading": 0,
                "speed_mph": 0,
                "status": "Scheduled",
                "train_state": "Active",
                "status_msg": "",
                "origin": origin_name,
                "destination": dest_name_il,
                "origin_code": "",
                "dest_code": "",
                "last_station": station_name,
                "next_station": "",
                "service_type": "commuter",
                "route_name": f"{origin_name} → {dest_name_il}",
                "stations": il_stations,
                "updated_at": "",
            })
    except Exception as exc:
        logger.warning("Israel Rail fetch failed: %s", exc)
    return trains


# ---------------------------------------------------------------------------
# Finland — real GPS positions via Digitraffic (Fintraffic) open API
# No auth required, updates every ~10 seconds, CC BY 4.0
# ---------------------------------------------------------------------------
DIGITRAFFIC_LOCATIONS_URL = "https://rata.digitraffic.fi/api/v1/train-locations/latest"
DIGITRAFFIC_TRAINS_URL = "https://rata.digitraffic.fi/api/v1/trains/latest"
DIGITRAFFIC_STATIONS_URL = "https://rata.digitraffic.fi/api/v1/metadata/stations"

# Station code → (name, lat, lng) cache — populated on first fetch
_fi_stations: dict[str, tuple[str, float, float]] = {}


def _load_fi_stations():
    """Load Finnish station metadata (cached for lifetime of process)."""
    if _fi_stations:
        return
    try:
        resp = fetch_with_curl(DIGITRAFFIC_STATIONS_URL, timeout=10, headers={
            "User-Agent": "ShadowBroker-OSINT/1.0",
            "Accept-Encoding": "gzip",
            "Digitraffic-User": "ShadowBroker-OSINT/1.0",
        })
        if resp.status_code != 200:
            return
        for s in resp.json():
            code = s.get("stationShortCode", "")
            name = s.get("stationName", "")
            lat = s.get("latitude")
            lng = s.get("longitude")
            if code and lat and lng:
                _fi_stations[code] = (name, lat, lng)
        logger.info("Finland stations loaded: %d", len(_fi_stations))
    except Exception as exc:
        logger.warning("Failed to load Finland stations: %s", exc)


def _fi_train_type_to_service(train_type: str, train_category: str) -> str:
    """Map Finnish train type/category to our service_type."""
    cat = train_category.lower()
    if "commuter" in cat:
        return "commuter"
    tt = train_type.upper()
    if tt in ("IC", "S", "AE"):  # InterCity, Pendolino, Allegro
        return "intercity"
    if tt in ("HDM", "HV", "MV", "T", "SAA", "PAI"):  # freight/shunting
        return "freight"
    return "intercity"


@with_retry(max_retries=1, base_delay=2)
def fetch_finland_trains() -> list[dict]:
    """Fetch live GPS positions of all running Finnish trains."""
    _load_fi_stations()

    # 1. Get live GPS positions
    resp = fetch_with_curl(DIGITRAFFIC_LOCATIONS_URL, timeout=12, headers={
        "User-Agent": "ShadowBroker-OSINT/1.0",
        "Accept-Encoding": "gzip",
        "Digitraffic-User": "ShadowBroker-OSINT/1.0",
    })
    if resp.status_code != 200:
        logger.warning("Digitraffic locations returned %d", resp.status_code)
        return []
    locations = resp.json()
    if not isinstance(locations, list):
        return []

    # Build trainNumber → GPS lookup
    gps_by_num: dict[int, dict] = {}
    for loc in locations:
        tn = loc.get("trainNumber")
        if tn is not None:
            coords = loc.get("location", {}).get("coordinates", [])
            if len(coords) >= 2:
                gps_by_num[tn] = {
                    "lng": coords[0],
                    "lat": coords[1],
                    "speed_kmh": loc.get("speed", 0),
                    "timestamp": loc.get("timestamp", ""),
                }

    if not gps_by_num:
        return []

    # 2. Get train metadata (type, category, stations) for running trains
    from datetime import date
    today = date.today().isoformat()
    meta_url = f"https://rata.digitraffic.fi/api/v1/trains/{today}"
    resp2 = fetch_with_curl(meta_url, timeout=15, headers={
        "User-Agent": "ShadowBroker-OSINT/1.0",
        "Accept-Encoding": "gzip",
        "Digitraffic-User": "ShadowBroker-OSINT/1.0",
    })
    meta_by_num: dict[int, dict] = {}
    if resp2.status_code == 200:
        for t in resp2.json():
            tn = t.get("trainNumber")
            if tn is not None and tn in gps_by_num:
                meta_by_num[tn] = t

    trains = []
    for tn, gps in gps_by_num.items():
        meta = meta_by_num.get(tn, {})
        train_type = meta.get("trainType", "")
        train_category = meta.get("trainCategory", "")
        service_type = _fi_train_type_to_service(train_type, train_category)
        commuter_line = meta.get("commuterLineID", "")

        # Parse station stops from timetable rows
        rows = meta.get("timeTableRows", [])
        stations = []
        origin_name = ""
        dest_name = ""
        next_station = ""
        last_station = ""
        found_next = False
        for r in rows:
            if r.get("type") != "DEPARTURE" and r.get("type") != "ARRIVAL":
                continue
            if not r.get("commercialStop", False):
                continue
            if r.get("type") != "ARRIVAL":
                continue  # Only count arrivals as station stops
            code = r.get("stationShortCode", "")
            sinfo = _fi_stations.get(code, (code, 0, 0))
            actual = r.get("actualTime", "")
            scheduled = r.get("scheduledTime", "")
            diff_min = ""
            if actual and scheduled:
                try:
                    from datetime import datetime as _dt
                    a = _dt.fromisoformat(actual.replace("Z", "+00:00"))
                    s = _dt.fromisoformat(scheduled.replace("Z", "+00:00"))
                    dm = int((a - s).total_seconds() / 60)
                    if dm > 0:
                        diff_min = f"+{dm} min"
                    elif dm < 0:
                        diff_min = f"{dm} min"
                except Exception:
                    pass
            departed = actual != ""
            if departed:
                last_station = sinfo[0]
            elif not found_next:
                next_station = sinfo[0]
                found_next = True
            stations.append({
                "name": sinfo[0],
                "code": code,
                "status": "Departed" if departed else "",
                "sch_arr": scheduled,
                "sch_dep": "",
                "arr": actual,
                "dep": "",
                "arr_cmnt": diff_min,
                "dep_cmnt": "",
                "bus": False,
            })

        if stations:
            origin_name = stations[0]["name"]
            dest_name = stations[-1]["name"]

        speed_kmh = gps.get("speed_kmh", 0)
        speed_mph = round(speed_kmh * 0.621371, 1)
        display_name = commuter_line if commuter_line else f"{train_type} {tn}"

        trains.append({
            "id": f"fi-{tn}",
            "name": display_name,
            "train_num": str(tn),
            "operator": "VR (Finland)",
            "country": "FI",
            "lat": gps["lat"],
            "lng": gps["lng"],
            "heading": 0,
            "speed_mph": speed_mph,
            "speed_kmh": speed_kmh,
            "status": "On Time" if meta.get("runningCurrently") else "Scheduled",
            "train_state": "Active" if meta.get("runningCurrently") else "Predeparture",
            "status_msg": f"{train_type} — {train_category}" if train_category else "",
            "origin": origin_name,
            "destination": dest_name,
            "origin_code": "",
            "dest_code": "",
            "last_station": last_station,
            "next_station": next_station,
            "service_type": service_type,
            "route_name": f"{origin_name} → {dest_name}" if origin_name and dest_name else "",
            "stations": stations,
            "updated_at": gps.get("timestamp", ""),
        })

    return trains


# ---------------------------------------------------------------------------
# Aggregate fetcher — called by the scheduler
# ---------------------------------------------------------------------------
def fetch_trains():
    """Fetch train positions from all sources and merge into latest_data."""
    all_trains = []

    # Amtrak (US)
    try:
        amtrak = fetch_amtrak()
        all_trains.extend(amtrak)
        logger.info("Trains: %d Amtrak", len(amtrak))
    except Exception as exc:
        logger.warning("Amtrak fetch failed: %s", exc)

    # Israel Railways
    try:
        israel = fetch_israel_trains()
        all_trains.extend(israel)
        logger.info("Trains: %d Israel Rail", len(israel))
    except Exception as exc:
        logger.warning("Israel Rail fetch failed: %s", exc)

    # Finland (real GPS via Digitraffic)
    try:
        finland = fetch_finland_trains()
        all_trains.extend(finland)
        logger.info("Trains: %d Finland (Digitraffic GPS)", len(finland))
    except Exception as exc:
        logger.warning("Finland train fetch failed: %s", exc)

    with _data_lock:
        latest_data["trains"] = all_trains
    _mark_fresh("trains")
