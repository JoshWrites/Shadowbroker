import sqlite3
import os
import requests
import xml.etree.ElementTree as ET
from services.network_utils import fetch_with_curl
import logging
from abc import ABC, abstractmethod
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

DB_PATH = "cctv.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS cameras (
            id TEXT PRIMARY KEY,
            source_agency TEXT,
            lat REAL,
            lon REAL,
            direction_facing TEXT,
            media_url TEXT,
            refresh_rate_seconds INTEGER,
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()

class BaseCCTVIngestor(ABC):
    @abstractmethod
    def fetch_data(self) -> List[Dict[str, Any]]:
        pass

    def ingest(self):
        conn = sqlite3.connect(DB_PATH)
        try:
            cameras = self.fetch_data()
            cursor = conn.cursor()
            for cam in cameras:
                cursor.execute("""
                    INSERT INTO cameras
                    (id, source_agency, lat, lon, direction_facing, media_url, refresh_rate_seconds)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                    media_url=excluded.media_url,
                    last_updated=CURRENT_TIMESTAMP
                """, (
                    cam.get("id"),
                    cam.get("source_agency"),
                    cam.get("lat"),
                    cam.get("lon"),
                    cam.get("direction_facing", "Unknown"),
                    cam.get("media_url"),
                    cam.get("refresh_rate_seconds", 60)
                ))
            conn.commit()
            logger.info(f"Successfully ingested {len(cameras)} cameras from {self.__class__.__name__}")
        except Exception as e:
            try:
                conn.rollback()
            except Exception:
                pass
            logger.error(f"Failed to ingest cameras in {self.__class__.__name__}: {e}")
        finally:
            conn.close()

class TFLJamCamIngestor(BaseCCTVIngestor):
    def fetch_data(self) -> List[Dict[str, Any]]:
        # Transport for London Open Data API
        url = "https://api.tfl.gov.uk/Place/Type/JamCam"
        response = fetch_with_curl(url, timeout=15)
        response.raise_for_status()
        
        data = response.json()
        cameras = []
        for item in data:
            # TfL returns URLs without protocols sometimes or with a base path
            vid_url = None
            img_url = None
            
            for prop in item.get('additionalProperties', []):
                if prop.get('key') == 'videoUrl':
                    vid_url = prop.get('value')
                elif prop.get('key') == 'imageUrl':
                    img_url = prop.get('value')
            
            media = vid_url if vid_url else img_url
            if media:
                cameras.append({
                    "id": f"TFL-{item.get('id')}",
                    "source_agency": "TfL",
                    "lat": item.get('lat'),
                    "lon": item.get('lon'),
                    "direction_facing": item.get('commonName', 'Unknown'),
                    "media_url": media,
                    "refresh_rate_seconds": 15
                })
        return cameras

class LTASingaporeIngestor(BaseCCTVIngestor):
    def fetch_data(self) -> List[Dict[str, Any]]:
        # Singapore Land Transport Authority (LTA) Traffic Images API
        url = "https://api.data.gov.sg/v1/transport/traffic-images"
        response = fetch_with_curl(url, timeout=15)
        response.raise_for_status()
        
        data = response.json()
        cameras = []
        if "items" in data and len(data["items"]) > 0:
            for item in data["items"][0].get("cameras", []):
                loc = item.get("location", {})
                if "latitude" in loc and "longitude" in loc and "image" in item:
                    cameras.append({
                        "id": f"SGP-{item.get('camera_id', 'UNK')}",
                        "source_agency": "Singapore LTA",
                        "lat": loc.get("latitude"),
                        "lon": loc.get("longitude"),
                        "direction_facing": f"Camera {item.get('camera_id')}",
                        "media_url": item.get("image"),
                        "refresh_rate_seconds": 60
                    })
        return cameras



class AustinTXIngestor(BaseCCTVIngestor):
    def fetch_data(self) -> List[Dict[str, Any]]:
        # City of Austin Traffic Cameras Open Data
        url = "https://data.austintexas.gov/resource/b4k4-adkb.json?$limit=2000"
        response = fetch_with_curl(url, timeout=15)
        response.raise_for_status()
        
        data = response.json()
        cameras = []
        for item in data:
            cam_id = item.get("camera_id")
            if not cam_id: continue
            
            loc = item.get("location", {})
            coords = loc.get("coordinates", [])
            
            # coords is usually [lon, lat]
            if len(coords) == 2:
                cameras.append({
                    "id": f"ATX-{cam_id}",
                    "source_agency": "Austin TxDOT",
                    "lat": coords[1],
                    "lon": coords[0],
                    "direction_facing": item.get("location_name", "Austin TX Camera"),
                    "media_url": f"https://cctv.austinmobility.io/image/{cam_id}.jpg",
                    "refresh_rate_seconds": 60
                })
        return cameras

class NYCDOTIngestor(BaseCCTVIngestor):
    def fetch_data(self) -> List[Dict[str, Any]]:
        url = "https://webcams.nyctmc.org/api/cameras"
        response = fetch_with_curl(url, timeout=15)
        response.raise_for_status()
        
        data = response.json()
        cameras = []
        for item in data:
            cam_id = item.get("id")
            if not cam_id: continue
            
            lat = item.get("latitude")
            lon = item.get("longitude")
            if lat and lon:
                cameras.append({
                    "id": f"NYC-{cam_id}",
                    "source_agency": "NYC DOT",
                    "lat": lat,
                    "lon": lon,
                    "direction_facing": item.get("name", "NYC Camera"),
                    "media_url": f"https://webcams.nyctmc.org/api/cameras/{cam_id}/image",
                    "refresh_rate_seconds": 30
                })
        return cameras

class GlobalOSMCrawlingIngestor(BaseCCTVIngestor):
    """Global OSM surveillance camera ingestor — queries by continent bounding box
    to stay within Overpass API limits while covering 219k+ nodes worldwide."""

    # Continent-scale bounding boxes (south, west, north, east)
    CONTINENT_BOXES = [
        ("-35.0,-20.0,37.5,52.0", "Africa"),
        ("5.0,60.0,55.0,150.0", "Asia East"),
        ("-10.0,95.0,10.0,141.0", "Southeast Asia"),
        ("25.0,25.0,45.0,65.0", "Middle East"),
        ("35.0,-10.0,72.0,40.0", "Europe"),
        ("10.0,-170.0,72.0,-50.0", "North America"),
        ("-60.0,-85.0,15.0,-33.0", "South America"),
        ("-50.0,110.0,0.0,180.0", "Oceania"),
        ("45.0,40.0,75.0,180.0", "Russia/Central Asia"),
        ("5.0,65.0,40.0,100.0", "South Asia"),
    ]

    def fetch_data(self) -> List[Dict[str, Any]]:
        cameras = []
        mapbox_key = os.environ.get("MAPBOX_TOKEN", "YOUR_MAPBOX_TOKEN_HERE")

        for bbox, region_name in self.CONTINENT_BOXES:
            query = (
                f'[out:json][timeout:300];'
                f'node["man_made"="surveillance"]["surveillance:type"="camera"]({bbox});'
                f'out body;'
            )
            url = "https://overpass-api.de/api/interpreter"
            try:
                response = requests.post(url, data={"data": query}, timeout=320)
                response.raise_for_status()
                data = response.json()

                for item in data.get('elements', []):
                    lat = item.get("lat")
                    lon = item.get("lon")
                    cam_id = item.get("id")
                    if not (lat and lon):
                        continue

                    direction_str = item.get("tags", {}).get("camera:direction", "0")
                    try:
                        bearing = int(float(direction_str))
                    except (ValueError, TypeError):
                        bearing = 0

                    mapbox_url = (
                        f"https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/"
                        f"{lon},{lat},18,{bearing},60/600x400?access_token={mapbox_key}"
                    )

                    cameras.append({
                        "id": f"OSM-{cam_id}",
                        "source_agency": f"OSM OSINT: {region_name}",
                        "lat": lat,
                        "lon": lon,
                        "direction_facing": item.get("tags", {}).get("surveillance:type", "Street Level Camera"),
                        "media_url": mapbox_url,
                        "refresh_rate_seconds": 3600,
                    })
                logger.info(f"OSM region {region_name}: fetched {len(data.get('elements', []))} cameras")
            except Exception as e:
                logger.warning(f"OSM region {region_name} failed: {e}")
                continue

        return cameras


# ─── Tier 1: No-auth APIs ─────────────────────────────────────────────────────

class AutobahnIngestor(BaseCCTVIngestor):
    """German Autobahn webcams — ~200 cameras across all federal motorways."""

    def fetch_data(self) -> List[Dict[str, Any]]:
        cameras = []
        try:
            roads_resp = fetch_with_curl("https://verkehr.autobahn.de/o/autobahn/", timeout=15)
            roads_resp.raise_for_status()
            roads = roads_resp.json().get("roads", [])
        except Exception as e:
            logger.warning(f"Autobahn road list failed: {e}")
            return []

        for road in roads:
            try:
                url = f"https://verkehr.autobahn.de/o/autobahn/{road}/services/webcam"
                resp = fetch_with_curl(url, timeout=15)
                resp.raise_for_status()
                for cam in resp.json().get("webcam", []):
                    coord = cam.get("coordinate", {})
                    lat = coord.get("lat")
                    lon = coord.get("long")
                    if not (lat and lon):
                        continue
                    img = cam.get("imageurl") or cam.get("linkurl", "")
                    cameras.append({
                        "id": f"BAB-{cam.get('identifier', cam.get('title', '').replace(' ', '_'))}",
                        "source_agency": "Autobahn DE",
                        "lat": float(lat),
                        "lon": float(lon),
                        "direction_facing": cam.get("title", "Autobahn Camera"),
                        "media_url": img,
                        "refresh_rate_seconds": 300,
                    })
            except Exception as e:
                logger.debug(f"Autobahn {road} webcam fetch failed: {e}")
                continue
        return cameras


class CaltransCCTVIngestor(BaseCCTVIngestor):
    """Caltrans CCTV cameras across 12 California districts — ~950 cameras."""

    def fetch_data(self) -> List[Dict[str, Any]]:
        cameras = []
        for district in range(1, 13):
            dn = f"{district:02d}"
            url = f"https://cwwp2.dot.ca.gov/data/d{dn}/cctv/cctvStatusD{dn}.json"
            try:
                resp = fetch_with_curl(url, timeout=15)
                resp.raise_for_status()
                data = resp.json()
                for cam in data.get("data", data) if isinstance(data, dict) else data:
                    if isinstance(cam, dict):
                        loc = cam.get("location", {})
                        lat = loc.get("latitude") or cam.get("latitude")
                        lon = loc.get("longitude") or cam.get("longitude")
                        if not (lat and lon):
                            continue
                        img_url = cam.get("imageUrl") or cam.get("currentImageURL", "")
                        cam_id = cam.get("index") or cam.get("cctv_id", "")
                        cameras.append({
                            "id": f"CAL-D{dn}-{cam_id}",
                            "source_agency": "Caltrans",
                            "lat": float(lat),
                            "lon": float(lon),
                            "direction_facing": cam.get("location", {}).get("locationName", f"D{dn} Camera") if isinstance(cam.get("location"), dict) else f"D{dn} Camera",
                            "media_url": img_url,
                            "refresh_rate_seconds": 300,
                        })
            except Exception as e:
                logger.debug(f"Caltrans D{dn} failed: {e}")
                continue
        return cameras


class DigitalTrafficFIIngestor(BaseCCTVIngestor):
    """Finland Digitraffic weathercam stations — ~470 cameras, no auth."""

    def fetch_data(self) -> List[Dict[str, Any]]:
        cameras = []
        try:
            resp = fetch_with_curl("https://tie.digitraffic.fi/api/weathercam/v1/stations", timeout=15)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.warning(f"Digitraffic FI stations failed: {e}")
            return []

        for station in data.get("features", []):
            props = station.get("properties", {})
            geom = station.get("geometry", {})
            coords = geom.get("coordinates", [])
            if len(coords) < 2:
                continue
            lon, lat = coords[0], coords[1]
            for preset in props.get("presets", []):
                preset_id = preset.get("id", "")
                img_url = f"https://weathercam.digitraffic.fi/{preset_id}.jpg"
                cameras.append({
                    "id": f"FIN-{preset_id}",
                    "source_agency": "Digitraffic FI",
                    "lat": lat,
                    "lon": lon,
                    "direction_facing": preset.get("presentationName", props.get("name", "FI Camera")),
                    "media_url": img_url,
                    "refresh_rate_seconds": 600,
                })
        return cameras


class HongKongTDIngestor(BaseCCTVIngestor):
    """Hong Kong Transport Dept traffic cameras — ~987 cameras, 2-min refresh."""

    CAMERA_LIST_URL = "https://resource.data.one.gov.hk/td/traffic-detectors/rawSpeedVol-all.xml"

    def fetch_data(self) -> List[Dict[str, Any]]:
        cameras = []
        # HK publishes a known set of camera IDs with a predictable image URL pattern
        # Metadata with coordinates from data.gov.hk GeoJSON
        try:
            resp = fetch_with_curl(
                "https://geodata.gov.hk/gs/api/v1.0.0/geoDataQuery?q=%7B%22type%22%3A%22esriQueryByName%22%2C%22name%22%3A%22TD_CCTV%22%7D&outputFormat=GeoJSON",
                timeout=20
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.warning(f"HK TD metadata failed: {e}")
            return []

        for feature in data.get("features", []):
            props = feature.get("properties", {})
            geom = feature.get("geometry", {})
            coords = geom.get("coordinates", [])
            if len(coords) < 2:
                continue
            lon, lat = coords[0], coords[1]
            cam_key = props.get("CAMERA_ID") or props.get("key") or props.get("OBJECTID", "")
            if not cam_key:
                continue
            cameras.append({
                "id": f"HKG-{cam_key}",
                "source_agency": "HK Transport Dept",
                "lat": lat,
                "lon": lon,
                "direction_facing": props.get("DESCRIPTION_EN", props.get("description", "HK Camera")),
                "media_url": f"https://tdcctv.data.one.gov.hk/{cam_key}.JPG",
                "refresh_rate_seconds": 120,
            })
        return cameras


class QuebecMTQIngestor(BaseCCTVIngestor):
    """Quebec Ministry of Transport cameras — ~500 cameras via WFS GeoJSON."""

    def fetch_data(self) -> List[Dict[str, Any]]:
        cameras = []
        url = (
            "https://ws.mapserver.transports.gouv.qc.ca/swtq?"
            "service=wfs&version=2.0.0&request=getfeature"
            "&typename=ms:infos_cameras&outputformat=geojson&srsname=EPSG:4326"
        )
        try:
            resp = fetch_with_curl(url, timeout=20)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.warning(f"Quebec MTQ failed: {e}")
            return []

        for feature in data.get("features", []):
            props = feature.get("properties", {})
            geom = feature.get("geometry", {})
            coords = geom.get("coordinates", [])
            if len(coords) < 2:
                continue
            lon, lat = coords[0], coords[1]
            cam_id = props.get("id") or props.get("no_seq_equipement", "")
            img_url = props.get("url_image_en_cours") or props.get("url") or ""
            cameras.append({
                "id": f"QBC-{cam_id}",
                "source_agency": "Quebec MTQ",
                "lat": lat,
                "lon": lon,
                "direction_facing": props.get("nom_emplacement", props.get("description", "QC Camera")),
                "media_url": img_url,
                "refresh_rate_seconds": 300,
            })
        return cameras


class DGTSpainIngestor(BaseCCTVIngestor):
    """Spain DGT traffic cameras via DATEX2 v3 XML — ~500 cameras."""

    def fetch_data(self) -> List[Dict[str, Any]]:
        cameras = []
        url = "https://nap.dgt.es/datex2/v3/dgt/DevicePublication/camaras_datex2_v36.xml"
        try:
            resp = fetch_with_curl(url, timeout=30)
            resp.raise_for_status()
            root = ET.fromstring(resp.text if hasattr(resp, 'text') else resp.content)
        except Exception as e:
            logger.warning(f"DGT Spain XML failed: {e}")
            return []

        # DATEX2 uses namespaces — strip them for simpler parsing
        ns = ''
        for elem in root.iter():
            if elem.tag.startswith('{'):
                ns = elem.tag.split('}')[0] + '}'
                break

        for device in root.iter(f'{ns}cctv' if ns else 'cctv'):
            try:
                loc_el = device.find(f'.//{ns}pointByCoordinates' if ns else './/pointByCoordinates')
                if loc_el is None:
                    loc_el = device.find(f'.//{ns}locationForDisplay' if ns else './/locationForDisplay')
                if loc_el is None:
                    continue
                lat_el = loc_el.find(f'.//{ns}latitude' if ns else './/latitude')
                lon_el = loc_el.find(f'.//{ns}longitude' if ns else './/longitude')
                if lat_el is None or lon_el is None:
                    continue
                lat = float(lat_el.text)
                lon = float(lon_el.text)
                cam_id = device.attrib.get('id', '') or device.attrib.get('version', '')
                img_el = device.find(f'.//{ns}urlLinkAddress' if ns else './/urlLinkAddress')
                img_url = img_el.text if img_el is not None else ""
                name_el = device.find(f'.//{ns}cctvCameraIdentification' if ns else './/cctvCameraIdentification')
                name = name_el.text if name_el is not None else "Spain Camera"
                cameras.append({
                    "id": f"ESP-{cam_id}",
                    "source_agency": "DGT Spain",
                    "lat": lat,
                    "lon": lon,
                    "direction_facing": name,
                    "media_url": img_url,
                    "refresh_rate_seconds": 300,
                })
            except Exception:
                continue
        return cameras


class MainRoadsWAIngestor(BaseCCTVIngestor):
    """Western Australia Main Roads traffic cameras via ArcGIS — ~200 cameras."""

    def fetch_data(self) -> List[Dict[str, Any]]:
        cameras = []
        url = (
            "https://services-ap1.arcgis.com/nQ0fmTm4OC1nsMdP/arcgis/rest/services/"
            "Traffic_Cameras/FeatureServer/0/query"
            "?where=1%3D1&outFields=*&f=geojson&resultRecordCount=2000"
        )
        try:
            resp = fetch_with_curl(url, timeout=20)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.warning(f"Main Roads WA failed: {e}")
            return []

        for feature in data.get("features", []):
            props = feature.get("properties", {})
            geom = feature.get("geometry", {})
            coords = geom.get("coordinates", [])
            if len(coords) < 2:
                continue
            lon, lat = coords[0], coords[1]
            cam_id = props.get("OBJECTID") or props.get("CameraID", "")
            img_url = props.get("URL") or props.get("ImageURL", "")
            cameras.append({
                "id": f"MRW-{cam_id}",
                "source_agency": "Main Roads WA",
                "lat": lat,
                "lon": lon,
                "direction_facing": props.get("Description", props.get("Location", "WA Camera")),
                "media_url": img_url,
                "refresh_rate_seconds": 300,
            })
        return cameras


# ─── Tier 2: API-key-required sources ─────────────────────────────────────────

class WindyWebcamsIngestor(BaseCCTVIngestor):
    """Windy.com global webcams — up to ~10k cameras (free tier)."""

    API_BASE = "https://api.windy.com/webcams/api/v3/webcams"

    # Continent bounding boxes for pagination beyond offset cap
    REGIONS = [
        ("35,-10,72,40", "Europe"),
        ("10,-170,72,-50", "North America"),
        ("-60,-85,15,-33", "South America"),
        ("-35,-20,37,52", "Africa"),
        ("5,60,55,150", "Asia"),
        ("-50,110,0,180", "Oceania"),
    ]

    def fetch_data(self) -> List[Dict[str, Any]]:
        api_key = os.environ.get("WINDY_API_KEY", "")
        if not api_key:
            logger.debug("WINDY_API_KEY not set, skipping WindyWebcamsIngestor")
            return []

        cameras = []
        headers = {"x-windy-api-key": api_key}
        seen_ids = set()

        for bbox, region in self.REGIONS:
            offset = 0
            while offset < 10000:
                url = f"{self.API_BASE}?limit=50&offset={offset}&nearby={bbox}"
                try:
                    resp = fetch_with_curl(url, timeout=15, headers=headers)
                    resp.raise_for_status()
                    data = resp.json()
                    webcams = data.get("webcams", [])
                    if not webcams:
                        break
                    for wc in webcams:
                        wc_id = wc.get("webcamId") or wc.get("id", "")
                        if wc_id in seen_ids:
                            continue
                        seen_ids.add(wc_id)
                        loc = wc.get("location", {})
                        lat = loc.get("latitude")
                        lon = loc.get("longitude")
                        if not (lat and lon):
                            continue
                        img = wc.get("images", {}).get("current", {}).get("preview", "")
                        if not img:
                            img = wc.get("images", {}).get("daylight", {}).get("preview", "")
                        cameras.append({
                            "id": f"WDY-{wc_id}",
                            "source_agency": "Windy Webcams",
                            "lat": lat,
                            "lon": lon,
                            "direction_facing": wc.get("title", "Windy Webcam"),
                            "media_url": img,
                            "refresh_rate_seconds": 900,
                        })
                    offset += 50
                except Exception as e:
                    logger.debug(f"Windy {region} offset {offset} failed: {e}")
                    break
        return cameras


class _Generic511Ingestor(BaseCCTVIngestor):
    """Base class for 511-style camera APIs (Alberta, Manitoba, Georgia, Saskatchewan)."""

    API_URL = ""
    ID_PREFIX = ""
    SOURCE_AGENCY = ""
    API_KEY_ENV = ""

    def fetch_data(self) -> List[Dict[str, Any]]:
        if self.API_KEY_ENV:
            key = os.environ.get(self.API_KEY_ENV, "")
            if not key:
                logger.debug(f"{self.API_KEY_ENV} not set, skipping {self.__class__.__name__}")
                return []

        cameras = []
        try:
            resp = fetch_with_curl(self.API_URL, timeout=20)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.warning(f"{self.__class__.__name__} failed: {e}")
            return []

        items = data if isinstance(data, list) else data.get("cameras", data.get("data", []))
        for cam in items:
            if not isinstance(cam, dict):
                continue
            lat = cam.get("latitude") or cam.get("lat")
            lon = cam.get("longitude") or cam.get("lon") or cam.get("lng")
            if not (lat and lon):
                continue
            cam_id = cam.get("id") or cam.get("camera_id") or cam.get("ID", "")
            img = cam.get("imageUrl") or cam.get("image_url") or cam.get("url", "")
            cameras.append({
                "id": f"{self.ID_PREFIX}-{cam_id}",
                "source_agency": self.SOURCE_AGENCY,
                "lat": float(lat),
                "lon": float(lon),
                "direction_facing": cam.get("name") or cam.get("title") or cam.get("description", "Camera"),
                "media_url": img,
                "refresh_rate_seconds": 300,
            })
        return cameras


class Alberta511Ingestor(_Generic511Ingestor):
    API_URL = "https://511.alberta.ca/api/v2/get/cameras"
    ID_PREFIX = "ABT"
    SOURCE_AGENCY = "511 Alberta"
    API_KEY_ENV = "ALBERTA_511_KEY"


class Manitoba511Ingestor(_Generic511Ingestor):
    API_URL = "https://www.manitoba511.ca/api/v2/get/cameras"
    ID_PREFIX = "MBT"
    SOURCE_AGENCY = "511 Manitoba"
    API_KEY_ENV = "MANITOBA_511_KEY"


class Georgia511Ingestor(_Generic511Ingestor):
    API_URL = "https://511ga.org/api/v2/get/cameras"
    ID_PREFIX = "GGA"
    SOURCE_AGENCY = "511 Georgia"
    API_KEY_ENV = "GA511_KEY"


class Saskatchewan511Ingestor(_Generic511Ingestor):
    API_URL = "http://hotline.gov.sk.ca/api/v2/get/cameras"
    ID_PREFIX = "SKT"
    SOURCE_AGENCY = "SK Highway Hotline"
    API_KEY_ENV = ""  # No key required


class QLDTrafficIngestor(BaseCCTVIngestor):
    """Queensland traffic webcams — ~300 cameras."""

    def fetch_data(self) -> List[Dict[str, Any]]:
        api_key = os.environ.get("QLD_TRAFFIC_KEY", "")
        if not api_key:
            logger.debug("QLD_TRAFFIC_KEY not set, skipping QLDTrafficIngestor")
            return []

        cameras = []
        url = f"https://api.qldtraffic.qld.gov.au/v1/webcams?apikey={api_key}"
        try:
            resp = fetch_with_curl(url, timeout=20)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.warning(f"QLD Traffic failed: {e}")
            return []

        for feature in data.get("features", []):
            props = feature.get("properties", {})
            geom = feature.get("geometry", {})
            coords = geom.get("coordinates", [])
            if len(coords) < 2:
                continue
            lon, lat = coords[0], coords[1]
            cam_id = props.get("id") or props.get("webcam_id", "")
            img = props.get("image_url") or props.get("url", "")
            cameras.append({
                "id": f"QLD-{cam_id}",
                "source_agency": "QLD Traffic",
                "lat": lat,
                "lon": lon,
                "direction_facing": props.get("description", "QLD Camera"),
                "media_url": img,
                "refresh_rate_seconds": 300,
            })
        return cameras


class ITrafficSAIngestor(BaseCCTVIngestor):
    """South Africa i-TRAFFIC cameras — ~1200 cameras."""

    def fetch_data(self) -> List[Dict[str, Any]]:
        api_key = os.environ.get("ITRAFFIC_SA_KEY", "")
        if not api_key:
            logger.debug("ITRAFFIC_SA_KEY not set, skipping ITrafficSAIngestor")
            return []

        cameras = []
        url = f"https://www.i-traffic.co.za/api/GetCameras?key={api_key}&format=json"
        try:
            resp = fetch_with_curl(url, timeout=20)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.warning(f"i-TRAFFIC SA failed: {e}")
            return []

        items = data if isinstance(data, list) else data.get("cameras", [])
        for cam in items:
            lat = cam.get("latitude") or cam.get("lat")
            lon = cam.get("longitude") or cam.get("lon")
            if not (lat and lon):
                continue
            cam_id = cam.get("id") or cam.get("camera_id", "")
            img = cam.get("imageUrl") or cam.get("image_url") or cam.get("url", "")
            cameras.append({
                "id": f"ZAF-{cam_id}",
                "source_agency": "i-TRAFFIC SA",
                "lat": float(lat),
                "lon": float(lon),
                "direction_facing": cam.get("name") or cam.get("description", "SA Camera"),
                "media_url": img,
                "refresh_rate_seconds": 300,
            })
        return cameras


class OHGOIngestor(BaseCCTVIngestor):
    """Ohio OHGO traffic cameras — ~900 cameras."""

    def fetch_data(self) -> List[Dict[str, Any]]:
        api_key = os.environ.get("OHGO_KEY", "")
        if not api_key:
            logger.debug("OHGO_KEY not set, skipping OHGOIngestor")
            return []

        cameras = []
        url = "https://publicapi.ohgo.com/api/v1/cameras"
        headers = {"Authorization": f"APIKEY {api_key}"}
        try:
            resp = fetch_with_curl(url, timeout=20, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.warning(f"OHGO failed: {e}")
            return []

        items = data.get("results", data) if isinstance(data, dict) else data
        if not isinstance(items, list):
            items = []
        for cam in items:
            lat = cam.get("latitude")
            lon = cam.get("longitude")
            if not (lat and lon):
                continue
            cam_id = cam.get("id") or cam.get("cameraId", "")
            # OHGO provides smallImageUrl / largeImageUrl
            img = cam.get("largeImageUrl") or cam.get("smallImageUrl") or cam.get("imageUrl", "")
            cameras.append({
                "id": f"OHO-{cam_id}",
                "source_agency": "OHGO Ohio",
                "lat": float(lat),
                "lon": float(lon),
                "direction_facing": cam.get("description") or cam.get("name", "Ohio Camera"),
                "media_url": img,
                "refresh_rate_seconds": 300,
            })
        return cameras


def _detect_media_type(url: str) -> str:
    """Detect the media type from a camera URL for proper frontend rendering."""
    if not url:
        return "image"
    url_lower = url.lower()
    if any(ext in url_lower for ext in ['.mp4', '.webm', '.ogg']):
        return "video"
    if any(kw in url_lower for kw in ['.mjpg', '.mjpeg', 'mjpg', 'axis-cgi/mjpg', 'mode=motion']):
        return "mjpeg"
    if '.m3u8' in url_lower or 'hls' in url_lower:
        return "hls"
    if any(kw in url_lower for kw in ['embed', 'maps/embed', 'iframe']):
        return "embed"
    if 'mapbox.com' in url_lower or 'satellite' in url_lower:
        return "satellite"
    return "image"

def get_all_cameras() -> List[Dict[str, Any]]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM cameras")
    rows = cursor.fetchall()
    conn.close()
    cameras = []
    for row in rows:
        cam = dict(row)
        cam['media_type'] = _detect_media_type(cam.get('media_url', ''))
        cameras.append(cam)
    return cameras

