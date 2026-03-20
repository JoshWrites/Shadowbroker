"""Comprehensive tests for every data layer — store defaults, API inclusion, and data shape."""
import pytest
from services.fetchers._store import latest_data, source_timestamps, _mark_fresh, _data_lock


# ---------------------------------------------------------------------------
# Mock data fixtures
# ---------------------------------------------------------------------------

MOCK_FLIGHT = {
    "callsign": "TEST001", "country": "United States", "lat": 40.0,
    "lng": -74.0, "alt": 35000, "heading": 90, "speed_knots": 450,
    "registration": "N12345", "model": "B738", "icao24": "ABCDEF",
    "type": "commercial_flight",
}

MOCK_MILITARY_FLIGHT = {
    "callsign": "RCH001", "country": "United States", "lat": 38.0,
    "lng": -77.0, "alt": 30000, "heading": 270, "speed_knots": 400,
    "registration": "00-0001", "model": "C17", "icao24": "AE0001",
    "type": "military",
}

MOCK_PRIVATE_FLIGHT = {
    "callsign": "N555GA", "country": "United States", "lat": 33.0,
    "lng": -84.0, "alt": 8000, "heading": 180, "speed_knots": 120,
    "registration": "N555GA", "model": "C172", "icao24": "A00001",
    "type": "private_flight",
}

MOCK_PRIVATE_JET = {
    "callsign": "EJA001", "country": "United States", "lat": 41.0,
    "lng": -73.0, "alt": 40000, "heading": 45, "speed_knots": 480,
    "registration": "N1NJ", "model": "G650", "icao24": "A99999",
    "type": "private_jet",
}

MOCK_TRACKED_FLIGHT = {
    "callsign": "TRACK1", "country": "Israel", "lat": 32.0,
    "lng": 34.8, "alt": 25000, "heading": 0, "speed_knots": 300,
    "registration": "4X-ABC", "model": "B738", "icao24": "738001",
}

MOCK_SHIP = {
    "mmsi": 123456789, "name": "Test Ship", "type": "cargo", "lat": 25.0,
    "lng": -80.0, "heading": 180, "sog": 12.0, "cog": 180, "country": "Panama",
}

MOCK_TRAIN = {
    "id": "train-1", "name": "Silver Star", "train_num": "91",
    "operator": "Amtrak", "country": "US", "lat": 38.9, "lng": -77.0,
    "heading": 180, "speed_mph": 79, "status": "Active",
    "origin": "New York", "destination": "Miami",
}

MOCK_CCTV = {
    "id": "cam-1", "lat": 51.5, "lon": -0.1, "name": "London Cam",
    "url": "http://tfl.gov.uk/cam1", "source": "TFL",
}

MOCK_UAV = {
    "id": "uav-1", "lat": 50.0, "lng": 36.0, "heading": 90,
    "alt": 5000, "type": "drone",
}

MOCK_LIVEUAMAP = {
    "id": "lua-1", "lat": 48.5, "lng": 37.0, "title": "Event",
    "link": "http://liveuamap.com/1", "time": "2025-01-01",
}

MOCK_PIKUD_ALERT = {
    "id": "pk-1", "city": "Tel Aviv", "area": "Dan", "lat": 32.08,
    "lng": 34.78, "cat": "1", "cat_label": "Rockets / Missiles",
    "color": "#ff0000", "title": "Red Alert",
    "timestamp": "2025-01-01T00:00:00", "ts": 1735689600,
}

MOCK_UKRAINE_ALERT = {
    "id": "ua-1", "region": "Kharkiv", "region_id": 1, "lat": 49.99,
    "lng": 36.23, "type": "air_raid", "type_label": "Air Raid",
    "color": "#ff0000", "timestamp": "2025-01-01T00:00:00",
    "ts": 1735689600, "active": True,
}

MOCK_NEWS = {
    "title": "Test News", "link": "http://example.com", "source": "TestFeed",
    "published": "2025-01-01", "summary": "Test summary", "risk_score": 0.5,
}

MOCK_EARTHQUAKE = {
    "id": "eq-1", "mag": 5.2, "lat": 35.0, "lng": 139.0,
    "place": "Japan", "title": "M5.2 - Near Japan",
}

MOCK_BGP_ANOMALY = {
    "id": "bgp-1", "type": "hijack", "ts": 1735689600,
    "hijacker_asn": 12345, "hijacker_country": "RU",
    "hijacker_org": "Evil ISP", "hijacker_lat": 55.75, "hijacker_lng": 37.61,
    "victim_asn": 67890, "victim_country": "US", "victim_org": "Good ISP",
    "victim_lat": 40.71, "victim_lng": -74.0,
    "affected_prefixes": "[]", "confidence_score": 85,
}

MOCK_CF_ANOMALY = {
    "id": "cf-1", "ts": 1735689600, "location": "US",
    "location_name": "United States", "lat": 38.0, "lng": -97.0,
    "status": "verified", "description": "Traffic anomaly detected",
    "timestamp": "2025-01-01T00:00:00",
}

MOCK_DDOS = {
    "id": "ddos-1", "ts": 1735689600, "origin_country": "CN",
    "origin_country_name": "China", "origin_lat": 35.86, "origin_lng": 104.19,
    "target_country": "US", "target_country_name": "United States",
    "target_lat": 38.0, "target_lng": -97.0,
    "requests_percent": 15.0, "layer": "L7",
}

MOCK_MILITARY_BASE = {
    "name": "Test Air Base", "country": "United States",
    "operator": "USAF", "branch": "air_force", "lat": 35.0, "lng": -118.0,
}

MOCK_FIRE = {
    "lat": 34.0, "lng": -118.0, "frp": 50.0, "brightness": 350.0,
    "confidence": "high", "daynight": "D",
    "acq_date": "2025-01-01", "acq_time": "1200",
}

MOCK_INTERNET_OUTAGE = {
    "region_code": "TX", "region_name": "Texas", "country_code": "US",
    "country_name": "United States", "lat": 31.0, "lng": -100.0,
    "severity": 45, "level": "region", "datasource": "bgp",
}

MOCK_DATACENTER = {
    "lat": 40.0, "lng": -74.0, "name": "NYC-DC1", "company": "Equinix",
    "street": "123 Main", "city": "New York", "country": "US", "zip": "10001",
}

MOCK_KIWISDR = {
    "lat": 52.0, "lon": 13.0, "name": "Berlin SDR", "url": "http://test.com",
    "users": 3, "users_max": 8, "bands": "HF",
    "antenna": "Long Wire", "location": "Berlin",
}

MOCK_INTERNET_QUALITY = {"US": {"bandwidth": 95.2, "latency": 12.3, "jitter": 2.1}}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _inject(key, value):
    """Write a value into latest_data under the lock."""
    with _data_lock:
        latest_data[key] = value


def _restore(key, default):
    """Restore a store key to its default value."""
    with _data_lock:
        latest_data[key] = default


# ---------------------------------------------------------------------------
# Store key existence & default type
# ---------------------------------------------------------------------------

class TestStoreDefaults:
    """Every store key exists and has the correct default type."""

    @pytest.mark.parametrize("key", [
        "news", "flights", "ships", "military_flights", "tracked_flights",
        "cctv", "earthquakes", "uavs", "gdelt", "liveuamap", "kiwisdr",
        "internet_outages", "firms_fires", "datacenters", "military_bases",
        "pikud_alerts", "ukraine_alerts", "bgp_anomalies", "cf_anomalies",
        "active_ddos", "trains",
    ])
    def test_list_key_defaults_to_list(self, key):
        assert key in latest_data
        assert isinstance(latest_data[key], list), f"{key} should be a list"

    @pytest.mark.parametrize("key", ["stocks", "oil", "internet_quality"])
    def test_dict_key_defaults_to_dict(self, key):
        assert key in latest_data
        assert isinstance(latest_data[key], dict), f"{key} should be a dict"

    def test_weather_defaults_to_none(self):
        assert "weather" in latest_data
        assert latest_data["weather"] is None

    def test_frontlines_defaults_to_none(self):
        assert "frontlines" in latest_data
        assert latest_data["frontlines"] is None

    def test_space_weather_defaults_to_none(self):
        assert "space_weather" in latest_data
        assert latest_data["space_weather"] is None

    def test_last_updated_defaults_to_none(self):
        assert "last_updated" in latest_data
        assert latest_data["last_updated"] is None


# ---------------------------------------------------------------------------
# Fast tier — API inclusion & data shape
# ---------------------------------------------------------------------------

class TestFastTierCommercialFlights:
    def test_key_in_response(self, client):
        _inject("commercial_flights", [MOCK_FLIGHT])
        try:
            r = client.get("/api/live-data/fast")
            assert r.status_code == 200
            assert "commercial_flights" in r.json()
        finally:
            _restore("commercial_flights", [])

    def test_data_shape(self, client):
        _inject("commercial_flights", [MOCK_FLIGHT])
        try:
            data = client.get("/api/live-data/fast").json()
            flight = data["commercial_flights"][0]
            for field in ("callsign", "lat", "lng", "alt", "heading", "icao24"):
                assert field in flight, f"Missing field: {field}"
        finally:
            _restore("commercial_flights", [])


class TestFastTierMilitaryFlights:
    def test_key_in_response(self, client):
        _inject("military_flights", [MOCK_MILITARY_FLIGHT])
        try:
            data = client.get("/api/live-data/fast").json()
            assert "military_flights" in data
            assert len(data["military_flights"]) == 1
        finally:
            _restore("military_flights", [])

    def test_data_shape(self, client):
        _inject("military_flights", [MOCK_MILITARY_FLIGHT])
        try:
            flight = client.get("/api/live-data/fast").json()["military_flights"][0]
            assert flight["callsign"] == "RCH001"
            assert flight["type"] == "military"
        finally:
            _restore("military_flights", [])


class TestFastTierPrivateFlights:
    def test_key_in_response(self, client):
        _inject("private_flights", [MOCK_PRIVATE_FLIGHT])
        try:
            data = client.get("/api/live-data/fast").json()
            assert "private_flights" in data
            assert len(data["private_flights"]) == 1
        finally:
            _restore("private_flights", [])


class TestFastTierPrivateJets:
    def test_key_in_response(self, client):
        _inject("private_jets", [MOCK_PRIVATE_JET])
        try:
            data = client.get("/api/live-data/fast").json()
            assert "private_jets" in data
            assert len(data["private_jets"]) == 1
        finally:
            _restore("private_jets", [])


class TestFastTierTrackedFlights:
    def test_key_in_response(self, client):
        _inject("tracked_flights", [MOCK_TRACKED_FLIGHT])
        try:
            data = client.get("/api/live-data/fast").json()
            assert "tracked_flights" in data
            assert len(data["tracked_flights"]) == 1
        finally:
            _restore("tracked_flights", [])


class TestFastTierShips:
    def test_key_in_response(self, client):
        _inject("ships", [MOCK_SHIP])
        try:
            data = client.get("/api/live-data/fast").json()
            assert "ships" in data
            assert len(data["ships"]) == 1
        finally:
            _restore("ships", [])

    def test_data_shape(self, client):
        _inject("ships", [MOCK_SHIP])
        try:
            ship = client.get("/api/live-data/fast").json()["ships"][0]
            for field in ("mmsi", "name", "lat", "lng", "heading", "sog"):
                assert field in ship, f"Missing field: {field}"
            assert ship["mmsi"] == 123456789
        finally:
            _restore("ships", [])


class TestFastTierCCTV:
    def test_key_in_response(self, client):
        _inject("cctv", [MOCK_CCTV])
        try:
            data = client.get("/api/live-data/fast").json()
            assert "cctv" in data
            assert len(data["cctv"]) == 1
        finally:
            _restore("cctv", [])

    def test_data_shape(self, client):
        _inject("cctv", [MOCK_CCTV])
        try:
            cam = client.get("/api/live-data/fast").json()["cctv"][0]
            assert cam["name"] == "London Cam"
            # CCTV uses lon not lng
            assert "lon" in cam
        finally:
            _restore("cctv", [])


class TestFastTierUAVs:
    def test_key_in_response(self, client):
        _inject("uavs", [MOCK_UAV])
        try:
            data = client.get("/api/live-data/fast").json()
            assert "uavs" in data
            assert len(data["uavs"]) == 1
        finally:
            _restore("uavs", [])


class TestFastTierLiveuamap:
    def test_key_in_response(self, client):
        _inject("liveuamap", [MOCK_LIVEUAMAP])
        try:
            data = client.get("/api/live-data/fast").json()
            assert "liveuamap" in data
            assert len(data["liveuamap"]) == 1
        finally:
            _restore("liveuamap", [])

    def test_data_shape(self, client):
        _inject("liveuamap", [MOCK_LIVEUAMAP])
        try:
            evt = client.get("/api/live-data/fast").json()["liveuamap"][0]
            assert evt["title"] == "Event"
            assert "lat" in evt and "lng" in evt
        finally:
            _restore("liveuamap", [])


class TestFastTierGPSJamming:
    def test_key_in_response(self, client):
        _inject("gps_jamming", [{"lat": 32.0, "lng": 35.0, "severity": 0.8}])
        try:
            data = client.get("/api/live-data/fast").json()
            assert "gps_jamming" in data
        finally:
            _restore("gps_jamming", [])


class TestFastTierSatellites:
    def test_key_in_response(self, client):
        _inject("satellites", [{"name": "ISS", "lat": 0.0, "lng": 0.0, "alt": 420}])
        try:
            data = client.get("/api/live-data/fast").json()
            assert "satellites" in data
            assert len(data["satellites"]) == 1
        finally:
            _restore("satellites", [])


class TestFastTierTrains:
    def test_key_in_response(self, client):
        _inject("trains", [MOCK_TRAIN])
        try:
            data = client.get("/api/live-data/fast").json()
            assert "trains" in data
            assert len(data["trains"]) == 1
        finally:
            _restore("trains", [])

    def test_data_shape(self, client):
        _inject("trains", [MOCK_TRAIN])
        try:
            train = client.get("/api/live-data/fast").json()["trains"][0]
            for field in ("id", "name", "train_num", "operator", "lat", "lng", "speed_mph"):
                assert field in train, f"Missing field: {field}"
            assert train["operator"] == "Amtrak"
        finally:
            _restore("trains", [])


class TestFastTierPikudAlerts:
    def test_key_in_response(self, client):
        _inject("pikud_alerts", [MOCK_PIKUD_ALERT])
        try:
            data = client.get("/api/live-data/fast").json()
            assert "pikud_alerts" in data
            assert len(data["pikud_alerts"]) == 1
        finally:
            _restore("pikud_alerts", [])

    def test_data_shape(self, client):
        _inject("pikud_alerts", [MOCK_PIKUD_ALERT])
        try:
            alert = client.get("/api/live-data/fast").json()["pikud_alerts"][0]
            assert alert["city"] == "Tel Aviv"
            assert alert["cat_label"] == "Rockets / Missiles"
        finally:
            _restore("pikud_alerts", [])


class TestFastTierUkraineAlerts:
    def test_key_in_response(self, client):
        _inject("ukraine_alerts", [MOCK_UKRAINE_ALERT])
        try:
            data = client.get("/api/live-data/fast").json()
            assert "ukraine_alerts" in data
            assert len(data["ukraine_alerts"]) == 1
        finally:
            _restore("ukraine_alerts", [])

    def test_data_shape(self, client):
        _inject("ukraine_alerts", [MOCK_UKRAINE_ALERT])
        try:
            alert = client.get("/api/live-data/fast").json()["ukraine_alerts"][0]
            assert alert["region"] == "Kharkiv"
            assert alert["active"] is True
        finally:
            _restore("ukraine_alerts", [])


# ---------------------------------------------------------------------------
# Slow tier — API inclusion & data shape
# ---------------------------------------------------------------------------

class TestSlowTierNews:
    def test_key_in_response(self, client):
        _inject("news", [MOCK_NEWS])
        try:
            data = client.get("/api/live-data/slow").json()
            assert "news" in data
            assert len(data["news"]) == 1
        finally:
            _restore("news", [])

    def test_data_shape(self, client):
        _inject("news", [MOCK_NEWS])
        try:
            article = client.get("/api/live-data/slow").json()["news"][0]
            for field in ("title", "link", "source", "published"):
                assert field in article
            assert article["title"] == "Test News"
        finally:
            _restore("news", [])


class TestSlowTierStocks:
    def test_key_in_response(self, client):
        _inject("stocks", {"SPY": {"price": 450.0, "change": 1.2}})
        try:
            data = client.get("/api/live-data/slow").json()
            assert "stocks" in data
            assert "SPY" in data["stocks"]
        finally:
            _restore("stocks", {})


class TestSlowTierOil:
    def test_key_in_response(self, client):
        _inject("oil", {"brent": 85.0, "wti": 80.0})
        try:
            data = client.get("/api/live-data/slow").json()
            assert "oil" in data
            assert data["oil"]["brent"] == 85.0
        finally:
            _restore("oil", {})


class TestSlowTierWeather:
    def test_key_in_response(self, client):
        mock_weather = {"temperature": 22, "wind": 15}
        _inject("weather", mock_weather)
        try:
            data = client.get("/api/live-data/slow").json()
            assert "weather" in data
            assert data["weather"]["temperature"] == 22
        finally:
            _restore("weather", None)


class TestSlowTierEarthquakes:
    def test_key_in_response(self, client):
        _inject("earthquakes", [MOCK_EARTHQUAKE])
        try:
            data = client.get("/api/live-data/slow").json()
            assert "earthquakes" in data
            assert len(data["earthquakes"]) == 1
        finally:
            _restore("earthquakes", [])

    def test_data_shape(self, client):
        _inject("earthquakes", [MOCK_EARTHQUAKE])
        try:
            eq = client.get("/api/live-data/slow").json()["earthquakes"][0]
            assert eq["mag"] == 5.2
            assert eq["place"] == "Japan"
        finally:
            _restore("earthquakes", [])


class TestSlowTierFrontlines:
    def test_key_in_response(self, client):
        mock_geojson = {"type": "FeatureCollection", "features": []}
        _inject("frontlines", mock_geojson)
        try:
            data = client.get("/api/live-data/slow").json()
            assert "frontlines" in data
            assert data["frontlines"]["type"] == "FeatureCollection"
        finally:
            _restore("frontlines", None)


class TestSlowTierGDELT:
    def test_key_in_response(self, client):
        _inject("gdelt", [{"type": "Feature", "geometry": {}, "properties": {}}])
        try:
            data = client.get("/api/live-data/slow").json()
            assert "gdelt" in data
            assert len(data["gdelt"]) == 1
        finally:
            _restore("gdelt", [])


class TestSlowTierAirports:
    def test_key_in_response(self, client):
        _inject("airports", [{"icao": "KJFK", "name": "JFK", "lat": 40.6, "lng": -73.8}])
        try:
            data = client.get("/api/live-data/slow").json()
            assert "airports" in data
        finally:
            _restore("airports", [])


class TestSlowTierKiwiSDR:
    def test_key_in_response(self, client):
        _inject("kiwisdr", [MOCK_KIWISDR])
        try:
            data = client.get("/api/live-data/slow").json()
            assert "kiwisdr" in data
            assert len(data["kiwisdr"]) == 1
        finally:
            _restore("kiwisdr", [])

    def test_data_shape(self, client):
        _inject("kiwisdr", [MOCK_KIWISDR])
        try:
            sdr = client.get("/api/live-data/slow").json()["kiwisdr"][0]
            assert sdr["name"] == "Berlin SDR"
            # KiwiSDR uses lon not lng
            assert "lon" in sdr
        finally:
            _restore("kiwisdr", [])


class TestSlowTierSpaceWeather:
    def test_key_in_response(self, client):
        mock_sw = {"kp_index": 3, "solar_wind_speed": 400}
        _inject("space_weather", mock_sw)
        try:
            data = client.get("/api/live-data/slow").json()
            assert "space_weather" in data
            assert data["space_weather"]["kp_index"] == 3
        finally:
            _restore("space_weather", None)


class TestSlowTierInternetOutages:
    def test_key_in_response(self, client):
        _inject("internet_outages", [MOCK_INTERNET_OUTAGE])
        try:
            data = client.get("/api/live-data/slow").json()
            assert "internet_outages" in data
            assert len(data["internet_outages"]) == 1
        finally:
            _restore("internet_outages", [])

    def test_data_shape(self, client):
        _inject("internet_outages", [MOCK_INTERNET_OUTAGE])
        try:
            outage = client.get("/api/live-data/slow").json()["internet_outages"][0]
            assert outage["region_name"] == "Texas"
            assert outage["severity"] == 45
        finally:
            _restore("internet_outages", [])


class TestSlowTierFIRMSFires:
    def test_key_in_response(self, client):
        _inject("firms_fires", [MOCK_FIRE])
        try:
            data = client.get("/api/live-data/slow").json()
            assert "firms_fires" in data
            assert len(data["firms_fires"]) == 1
        finally:
            _restore("firms_fires", [])

    def test_data_shape(self, client):
        _inject("firms_fires", [MOCK_FIRE])
        try:
            fire = client.get("/api/live-data/slow").json()["firms_fires"][0]
            assert fire["frp"] == 50.0
            assert fire["confidence"] == "high"
        finally:
            _restore("firms_fires", [])


class TestSlowTierDatacenters:
    def test_key_in_response(self, client):
        _inject("datacenters", [MOCK_DATACENTER])
        try:
            data = client.get("/api/live-data/slow").json()
            assert "datacenters" in data
            assert len(data["datacenters"]) == 1
        finally:
            _restore("datacenters", [])

    def test_data_shape(self, client):
        _inject("datacenters", [MOCK_DATACENTER])
        try:
            dc = client.get("/api/live-data/slow").json()["datacenters"][0]
            assert dc["company"] == "Equinix"
            assert dc["city"] == "New York"
        finally:
            _restore("datacenters", [])


class TestSlowTierMilitaryBases:
    def test_key_in_response(self, client):
        _inject("military_bases", [MOCK_MILITARY_BASE])
        try:
            data = client.get("/api/live-data/slow").json()
            assert "military_bases" in data
            assert len(data["military_bases"]) == 1
        finally:
            _restore("military_bases", [])

    def test_data_shape(self, client):
        _inject("military_bases", [MOCK_MILITARY_BASE])
        try:
            base = client.get("/api/live-data/slow").json()["military_bases"][0]
            assert base["name"] == "Test Air Base"
            assert base["branch"] == "air_force"
        finally:
            _restore("military_bases", [])


class TestSlowTierBGPAnomalies:
    def test_key_in_response(self, client):
        _inject("bgp_anomalies", [MOCK_BGP_ANOMALY])
        try:
            data = client.get("/api/live-data/slow").json()
            assert "bgp_anomalies" in data
            assert len(data["bgp_anomalies"]) == 1
        finally:
            _restore("bgp_anomalies", [])

    def test_data_shape(self, client):
        _inject("bgp_anomalies", [MOCK_BGP_ANOMALY])
        try:
            anomaly = client.get("/api/live-data/slow").json()["bgp_anomalies"][0]
            assert anomaly["type"] == "hijack"
            assert anomaly["confidence_score"] == 85
        finally:
            _restore("bgp_anomalies", [])


class TestSlowTierCFAnomalies:
    def test_key_in_response(self, client):
        _inject("cf_anomalies", [MOCK_CF_ANOMALY])
        try:
            data = client.get("/api/live-data/slow").json()
            assert "cf_anomalies" in data
            assert len(data["cf_anomalies"]) == 1
        finally:
            _restore("cf_anomalies", [])

    def test_data_shape(self, client):
        _inject("cf_anomalies", [MOCK_CF_ANOMALY])
        try:
            anomaly = client.get("/api/live-data/slow").json()["cf_anomalies"][0]
            assert anomaly["status"] == "verified"
            assert anomaly["location"] == "US"
        finally:
            _restore("cf_anomalies", [])


class TestSlowTierActiveDDoS:
    def test_key_in_response(self, client):
        _inject("active_ddos", [MOCK_DDOS])
        try:
            data = client.get("/api/live-data/slow").json()
            assert "active_ddos" in data
            assert len(data["active_ddos"]) == 1
        finally:
            _restore("active_ddos", [])

    def test_data_shape(self, client):
        _inject("active_ddos", [MOCK_DDOS])
        try:
            ddos = client.get("/api/live-data/slow").json()["active_ddos"][0]
            assert ddos["origin_country"] == "CN"
            assert ddos["target_country"] == "US"
            assert ddos["layer"] == "L7"
        finally:
            _restore("active_ddos", [])


class TestSlowTierInternetQuality:
    def test_key_in_response(self, client):
        _inject("internet_quality", MOCK_INTERNET_QUALITY)
        try:
            data = client.get("/api/live-data/slow").json()
            assert "internet_quality" in data
            assert "US" in data["internet_quality"]
        finally:
            _restore("internet_quality", {})

    def test_data_shape(self, client):
        _inject("internet_quality", MOCK_INTERNET_QUALITY)
        try:
            iq = client.get("/api/live-data/slow").json()["internet_quality"]
            assert iq["US"]["bandwidth"] == 95.2
            assert iq["US"]["latency"] == 12.3
        finally:
            _restore("internet_quality", {})


# ---------------------------------------------------------------------------
# Freshness
# ---------------------------------------------------------------------------

class TestFreshness:
    def test_fast_includes_freshness(self, client):
        data = client.get("/api/live-data/fast").json()
        assert "freshness" in data

    def test_slow_includes_freshness(self, client):
        data = client.get("/api/live-data/slow").json()
        assert "freshness" in data

    def test_mark_fresh_appears_in_fast(self, client):
        _mark_fresh("test_layer_fast")
        try:
            data = client.get("/api/live-data/fast").json()
            assert "test_layer_fast" in data["freshness"]
        finally:
            source_timestamps.pop("test_layer_fast", None)

    def test_mark_fresh_appears_in_slow(self, client):
        _mark_fresh("test_layer_slow")
        try:
            data = client.get("/api/live-data/slow").json()
            assert "test_layer_slow" in data["freshness"]
        finally:
            source_timestamps.pop("test_layer_slow", None)


# ---------------------------------------------------------------------------
# History endpoints
# ---------------------------------------------------------------------------

class TestPikudAlertsHistory:
    def test_history_returns_200(self, client):
        r = client.get("/api/pikud-alerts/history")
        assert r.status_code == 200
        data = r.json()
        assert "alerts" in data
        assert isinstance(data["alerts"], list)

    def test_range_returns_200(self, client):
        r = client.get("/api/pikud-alerts/range")
        assert r.status_code == 200
        data = r.json()
        assert "from" in data or "to" in data or isinstance(data, dict)


class TestUkraineAlertsHistory:
    def test_history_returns_200(self, client):
        r = client.get("/api/ukraine-alerts/history")
        assert r.status_code == 200
        data = r.json()
        assert "alerts" in data
        assert isinstance(data["alerts"], list)

    def test_range_returns_200(self, client):
        r = client.get("/api/ukraine-alerts/range")
        assert r.status_code == 200
        assert isinstance(r.json(), dict)


class TestBGPAnomaliesHistory:
    def test_history_returns_200(self, client):
        r = client.get("/api/bgp-anomalies/history")
        assert r.status_code == 200
        data = r.json()
        assert "events" in data
        assert isinstance(data["events"], list)

    def test_range_returns_200(self, client):
        r = client.get("/api/bgp-anomalies/range")
        assert r.status_code == 200
        assert isinstance(r.json(), dict)


class TestCFAnomaliesHistory:
    def test_history_returns_200(self, client):
        r = client.get("/api/cf-anomalies/history")
        assert r.status_code == 200
        data = r.json()
        assert "events" in data
        assert isinstance(data["events"], list)

    def test_range_returns_200(self, client):
        r = client.get("/api/cf-anomalies/range")
        assert r.status_code == 200
        assert isinstance(r.json(), dict)


# ---------------------------------------------------------------------------
# Military bases geometry endpoint (POST — client only supports GET/PUT)
# ---------------------------------------------------------------------------

class TestMilitaryBasesGeometries:
    def test_get_returns_405(self, client):
        """POST-only endpoint should reject GET with 405 Method Not Allowed."""
        r = client.get("/api/military-bases/geometries")
        assert r.status_code == 405
