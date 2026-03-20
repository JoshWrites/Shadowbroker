// ─── ShadowBroker Dashboard Data Types ─────────────────────────────────────
// Canonical type definitions for all data flowing from backend → frontend.
// Every `any` in the codebase should eventually be replaced with these types.

// ─── FLIGHTS ────────────────────────────────────────────────────────────────

export interface FlightBase {
  callsign: string;
  country: string;
  lat: number;
  lng: number;
  alt: number;
  heading: number;
  speed_knots: number | null;
  registration: string;
  model: string;
  icao24: string;
  squawk?: string;
  aircraft_category?: string;
  nac_p?: number;
  _seen_at?: number;
  origin_loc?: [number, number] | null;
  dest_loc?: [number, number] | null;
  origin_name?: string;
  dest_name?: string;
  trail?: Array<{ lat: number; lng: number; alt?: number; ts?: number }>;
  holding?: boolean;
}

export interface CommercialFlight extends FlightBase {
  type: "commercial_flight";
  airline_code?: string;
  supplemental_source?: string;
}

export interface PrivateFlight extends FlightBase {
  type: "private_ga" | "private_flight";
}

export interface PrivateJet extends FlightBase {
  type: "private_jet";
}

export interface MilitaryFlight extends FlightBase {
  type: "military_flight";
  military_type?: "heli" | "fighter" | "bomber" | "tanker" | "cargo" | "recon" | "default";
  force?: string;
}

export interface TrackedFlight extends FlightBase {
  type: "tracked_flight";
  alert_category?: string;
  alert_operator?: string;
  alert_special?: string;
  alert_flag?: string;
  alert_color?: string;
  alert_wiki?: string;
  alert_type?: string;
  alert_tags?: string[];
  alert_link?: string;
  tracked_name?: string;
  operator?: string;
  owner?: string;
  name?: string;
}

export interface UAV extends FlightBase {
  type: "uav";
  uav_type?: string;
  aircraft_model?: string;
  wiki?: string;
  force?: string;
}

export type Flight = CommercialFlight | PrivateFlight | PrivateJet | MilitaryFlight | TrackedFlight | UAV;

// ─── SHIPS / MARITIME ───────────────────────────────────────────────────────

export interface Ship {
  mmsi: number;
  name: string;
  type: "carrier" | "military_vessel" | "tanker" | "cargo" | "passenger" | "yacht" | "other" | "unknown";
  lat: number;
  lng: number;
  heading: number;
  sog: number;
  cog: number;
  callsign?: string;
  destination?: string;
  imo?: number;
  country: string;
  ais_type_code?: number;
  _updated?: number;
  estimated?: boolean;
  source?: string;
  source_url?: string;
  last_osint_update?: string;
  desc?: string;
  // Tracked yacht enrichment
  yacht_alert?: boolean;
  yacht_owner?: string;
  yacht_name?: string;
  yacht_category?: string;
  yacht_color?: string;
  yacht_builder?: string;
  yacht_length?: number;
  yacht_year?: number;
  yacht_link?: string;
  // PLAN/CCG vessel enrichment
  plan_name?: string;
  plan_class?: string;
  plan_force?: string;
  plan_hull?: string;
  plan_wiki?: string;
  // Carrier enrichment
  wiki?: string;
  homeport?: string;
  homeport_lat?: number;
  homeport_lng?: number;
  fallback_lat?: number;
  fallback_lng?: number;
  fallback_heading?: number;
  fallback_desc?: string;
}

// ─── SATELLITES ─────────────────────────────────────────────────────────────

export type SatelliteMission =
  | "military_recon" | "military_sar" | "military_ew"
  | "sar" | "commercial_imaging" | "navigation"
  | "early_warning" | "space_station" | "sigint" | "general";

export interface Satellite {
  id: number;
  name: string;
  mission: SatelliteMission;
  sat_type: string;
  country: string;
  wiki?: string;
  lat: number;
  lng: number;
  alt_km: number;
  speed_knots: number;
  heading: number;
}

// ─── EARTHQUAKES ────────────────────────────────────────────────────────────

export interface Earthquake {
  id: string;
  mag: number;
  lat: number;
  lng: number;
  place: string;
  title?: string;
}

// ─── GPS JAMMING ────────────────────────────────────────────────────────────

export interface GPSJammingZone {
  lat: number;
  lng: number;
  severity: "high" | "medium" | "low";
  ratio: number;
  degraded: number;
  total: number;
}

// ─── FIRE HOTSPOTS (NASA FIRMS) ─────────────────────────────────────────────

export interface FireHotspot {
  lat: number;
  lng: number;
  frp: number;
  brightness: number;
  confidence: string;
  daynight: string;
  acq_date: string;
  acq_time: string;
}

// ─── CCTV CAMERAS ───────────────────────────────────────────────────────────

export interface CCTVCamera {
  id: string | number;
  lat: number;
  lon: number;
  direction_facing?: string;
  source_agency?: string;
  media_url?: string;
  media_type?: "image" | "hls" | "mjpeg";
}

// ─── KIWISDR RECEIVERS ─────────────────────────────────────────────────────

export interface KiwiSDR {
  lat: number;
  lon: number;
  name: string;
  url?: string;
  users?: number;
  users_max?: number;
  bands?: string;
  antenna?: string;
  location?: string;
}

// ─── INTERNET OUTAGES (IODA) ────────────────────────────────────────────────

export interface InternetOutage {
  region_code: string;
  region_name: string;
  country_code: string;
  country_name: string;
  level: string;
  datasource: string;
  severity: number;
  lat: number;
  lng: number;
}

// ─── DATA CENTERS ───────────────────────────────────────────────────────────

export interface DataCenter {
  name: string;
  company: string;
  street?: string;
  city?: string;
  country?: string;
  zip?: string;
  lat: number;
  lng: number;
}

export interface MilitaryBase {
  name: string;
  country: string;
  state?: string;
  operator: string;
  branch: string;
  owner?: string;
  status?: string;
  joint?: boolean;
  lat: number;
  lng: number;
  diameter_m?: number;
}

export type MilBaseBranch =
  | 'air_force' | 'air_force_reserve' | 'air_national_guard'
  | 'army' | 'army_reserve' | 'army_national_guard'
  | 'navy' | 'navy_reserve'
  | 'marines' | 'marines_reserve'
  | 'joint' | 'missile' | 'nuclear' | 'other';

export const MIL_BASE_BRANCHES: { key: MilBaseBranch; label: string }[] = [
  { key: 'air_force', label: 'Air Force' },
  { key: 'air_force_reserve', label: 'AF Reserve' },
  { key: 'air_national_guard', label: 'Air Nat\'l Guard' },
  { key: 'army', label: 'Army' },
  { key: 'army_reserve', label: 'Army Reserve' },
  { key: 'army_national_guard', label: 'Army Nat\'l Guard' },
  { key: 'navy', label: 'Navy' },
  { key: 'navy_reserve', label: 'Navy Reserve' },
  { key: 'marines', label: 'Marines' },
  { key: 'marines_reserve', label: 'Marines Reserve' },
  { key: 'joint', label: 'Joint' },
  { key: 'missile', label: 'Missile Forces' },
  { key: 'nuclear', label: 'Nuclear Facility' },
  { key: 'other', label: 'Other' },
];

// ─── NEWS / GLOBAL INCIDENTS ────────────────────────────────────────────────

export interface NewsArticle {
  id: number | string;
  title: string;
  summary: string;
  source: string;
  link: string;
  pub_date: string;
  risk_score: number;
  lat: number;
  lng: number;
  region?: string;
  coords?: [number, number];
  machine_assessment?: string;
}

// ─── UKRAINE FRONTLINE ──────────────────────────────────────────────────────

export interface FrontlineGeoJSON {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: {
      type: "Polygon";
      coordinates: [number, number][][];
    };
    properties: {
      name: string;
      zone_id: number;
    };
  }>;
}

// ─── GDELT INCIDENTS ────────────────────────────────────────────────────────

export interface GDELTIncident {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: {
    name: string;
    count: number;
    _urls_list: string[];
    _headlines_list: string[];
  };
}

// ─── PIKUD HAOREF (ISRAEL RED ALERTS) ───────────────────────────────────────

export interface PikudAlert {
  id: string;
  city: string;
  area?: string;
  lat: number;
  lng: number;
  /** Oref-compatible category string ("1", "2", "5", etc.) */
  cat: string;
  /** Human-readable label ("Rockets / Missiles", "Hostile Aircraft Intrusion (UAV)", etc.) */
  cat_label: string;
  /** Hex color for this category */
  color: string;
  title?: string;
  timestamp: string;
  /** Unix epoch seconds */
  ts: number;
  /** Raw Tzofar threat ID (0=rockets, 5=UAV, etc.) */
  threat?: number;
  /** 1 if drill, 0 if real */
  is_drill?: number;
  /** Tzofar notification UUID — groups cities in the same salvo */
  notification_id?: string;
  /** "ALERT" or "SYSTEM_MESSAGE" */
  msg_type?: string;
  /** True when currently sounding (live ring only) */
  active?: boolean;
  /** Data source: "tzofar_ws", "oref_history", "oref_live" */
  source?: string;
  /** 1 = early warning flag */
  instruction?: number;
  /** 0 = early warning, 1 = incident ended */
  instruction_type?: number;
  // Legacy compat — some frontend code reads .category
  category?: string;
}

// ─── UKRAINE ALERTS ─────────────────────────────────────────────────────────

export interface UkraineAlert {
  id: string;
  region: string;
  region_id: number;
  lat: number;
  lng: number;
  type: string;
  type_label: string;
  color: string;
  timestamp: string;
  ts: number;
  active?: boolean;
}

// ─── CLOUDFLARE RADAR ───────────────────────────────────────────────────────

export interface BgpAnomaly {
  id: string;
  type: "hijack" | "leak";
  ts: number;
  hijacker_asn: number;
  hijacker_country: string;
  hijacker_org: string;
  hijacker_lat: number;
  hijacker_lng: number;
  victim_asn: number;
  victim_country: string;
  victim_org: string;
  victim_lat: number;
  victim_lng: number;
  affected_prefixes: string; // JSON-encoded array
  confidence_score: number;
  peer_count: number;
  timestamp: string;
}

export interface CfAnomaly {
  id: string;
  ts: number;
  location: string;
  location_name: string;
  lat: number;
  lng: number;
  status: string;
  description: string;
  timestamp: string;
}

export interface DdosAttack {
  id: string;
  ts: number;
  origin_country: string;
  origin_country_name: string;
  origin_lat: number;
  origin_lng: number;
  target_country: string;
  target_country_name: string;
  target_lat: number;
  target_lng: number;
  requests_percent: number;
  layer: string;
}

export interface InternetQuality {
  bandwidth_p50?: number;
  latency_p50?: number;
  dns_p50?: number;
}

// ─── LIVEUAMAP ──────────────────────────────────────────────────────────────

export interface LiveUAmapIncident {
  id: string | number;
  lat: number;
  lng: number;
  title: string;
  description?: string;
  date: string;
  timestamp?: number;
  link?: string;
  category?: string;
  region?: string;
}

// ─── STOCKS & COMMODITIES ───────────────────────────────────────────────────

export interface StockTicker {
  price: number;
  change_percent: number;
  up: boolean;
}

export type StocksData = Record<string, StockTicker>;
export type OilData = Record<string, StockTicker>;

// ─── SPACE WEATHER ──────────────────────────────────────────────────────────

export interface SpaceWeatherEvent {
  type: string;
  begin: string;
  end: string;
  classtype: string;
}

export interface SpaceWeather {
  kp_index: number | null;
  kp_text: string;
  events: SpaceWeatherEvent[];
}

// ─── WEATHER (RAINVIEWER) ───────────────────────────────────────────────────

export interface Weather {
  time: number;
  host: string;
}

// ─── AIRPORTS ───────────────────────────────────────────────────────────────

export interface Airport {
  id: string;
  name: string;
  iata: string;
  lat: number;
  lng: number;
  type: "airport";
}

// ─── RADIO FEEDS ────────────────────────────────────────────────────────────

export interface RadioFeed {
  id: string;
  name: string;
  location: string;
  category: string;
  listeners: number;
  stream_url?: string;
}

// ─── ROUTE ──────────────────────────────────────────────────────────────────

export interface FlightRoute {
  orig_loc: [number, number];
  dest_loc: [number, number];
  origin_name: string;
  dest_name: string;
}

// ─── REGION DOSSIER ─────────────────────────────────────────────────────────

export interface OpenMeteoCurrentWeather {
  temperature_2m: number;
  relative_humidity_2m: number;
  apparent_temperature: number;
  weather_code: number;
  cloud_cover: number;
  pressure_msl: number;
  wind_speed_10m: number;
  wind_direction_10m: number;
  wind_gusts_10m: number;
  precipitation: number;
  uv_index: number;
  is_day: number;
}

export interface OpenMeteoHourly {
  time: string[];
  temperature_2m: number[];
  relative_humidity_2m: number[];
  dew_point_2m: number[];
  apparent_temperature: number[];
  precipitation: number[];
  rain: number[];
  showers: number[];
  snowfall: number[];
  snow_depth: number[];
  weather_code: number[];
  cloud_cover: number[];
  pressure_msl: number[];
  wind_speed_10m: number[];
  wind_direction_10m: number[];
  wind_gusts_10m: number[];
  visibility: number[];
  uv_index: number[];
}

export interface OpenMeteoDailyData {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_sum: number[];
  wind_speed_10m_max: number[];
  weather_code: number[];
  sunrise: string[];
  sunset: string[];
}

export interface OpenMeteoWeather {
  current: OpenMeteoCurrentWeather;
  hourly: OpenMeteoHourly;
  daily: OpenMeteoDailyData;
  timezone: string;
  utc_offset_seconds: number;
}

export interface RegionDossier {
  lat: number;
  lng: number;
  admin_regions?: string[];
  populated_places?: string[];
  // Dynamic properties from backend (sentinel2, weather, etc.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

// ─── FRESHNESS METADATA ─────────────────────────────────────────────────────

export type FreshnessMap = Record<string, string>;

// ─── ROOT DATA OBJECT ───────────────────────────────────────────────────────

export interface DashboardData {
  // Metadata
  last_updated?: string | null;
  freshness?: FreshnessMap;
  satellite_source?: string;

  // Fast tier
  commercial_flights?: CommercialFlight[];
  private_flights?: PrivateFlight[];
  private_jets?: PrivateJet[];
  military_flights?: MilitaryFlight[];
  tracked_flights?: TrackedFlight[];
  uavs?: UAV[];
  ships?: Ship[];
  cctv?: CCTVCamera[];
  liveuamap?: LiveUAmapIncident[];
  gps_jamming?: GPSJammingZone[];
  satellites?: Satellite[];

  // Slow tier
  news?: NewsArticle[];
  stocks?: StocksData;
  oil?: OilData;
  weather?: Weather | null;
  earthquakes?: Earthquake[];
  frontlines?: FrontlineGeoJSON | null;
  gdelt?: GDELTIncident[];
  airports?: Airport[];
  kiwisdr?: KiwiSDR[];
  space_weather?: SpaceWeather | null;
  internet_outages?: InternetOutage[];
  firms_fires?: FireHotspot[];
  datacenters?: DataCenter[];
  military_bases?: MilitaryBase[];

  // Fast tier (live ring buffer, updated every 5s on backend)
  pikud_alerts?: PikudAlert[];
  ukraine_alerts?: UkraineAlert[];

  // Cloudflare Radar (slow tier)
  bgp_anomalies?: BgpAnomaly[];
  cf_anomalies?: CfAnomaly[];
  active_ddos?: DdosAttack[];
  internet_quality?: InternetQuality;
}

// ─── COMPONENT PROPS ────────────────────────────────────────────────────────

export interface ActiveLayers {
  flights: boolean;
  private: boolean;
  jets: boolean;
  military: boolean;
  tracked: boolean;
  satellites: boolean;
  ships_military: boolean;
  ships_cargo: boolean;
  ships_civilian: boolean;
  ships_passenger: boolean;
  ships_tracked_yachts: boolean;
  earthquakes: boolean;
  cctv: boolean;
  ukraine_frontline: boolean;
  global_incidents: boolean;
  day_night: boolean;
  gps_jamming: boolean;
  gibs_imagery: boolean;
  highres_satellite: boolean;
  kiwisdr: boolean;
  firms: boolean;
  internet_outages: boolean;
  datacenters: boolean;
  military_bases: boolean;
  pikud_alerts: boolean;
  ukraine_alerts: boolean;
  bgp_anomalies: boolean;
  cf_anomalies: boolean;
  active_ddos: boolean;
  weather_radar: boolean;
  weather_clouds: boolean;
  weather_precipitation: boolean;
  weather_pressure: boolean;
  weather_wind: boolean;
  weather_temperature: boolean;
}

export interface SelectedEntity {
  id: string | number;
  type: string;
  name?: string;
  media_url?: string;
  // Dynamic bag — varies by entity type (flight, ship, cctv, region_dossier, etc.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extra?: Record<string, any>;
}

export interface MeasurePoint {
  lat: number;
  lng: number;
}

export interface MapEffects {
  bloom: boolean;
  style?: string;
}

export interface MaplibreViewerProps {
  data: DashboardData;
  activeLayers: ActiveLayers;
  activeFilters?: Record<string, string[]>;
  effects?: MapEffects;
  onEntityClick: (entity: SelectedEntity | null) => void;
  flyToLocation: { lat: number; lng: number; zoom?: number; ts?: number } | null;
  selectedEntity: SelectedEntity | null;
  onMouseCoords: (coords: { lat: number; lng: number }) => void;
  onRightClick: (coords: { lat: number; lng: number }) => void;
  regionDossier: RegionDossier | null;
  regionDossierLoading: boolean;
  onViewStateChange?: (vs: { zoom: number; latitude: number }) => void;
  measureMode: boolean;
  onMeasureClick: (coords: { lat: number; lng: number }) => void;
  measurePoints: MeasurePoint[];
  gibsDate: string;
  gibsOpacity: number;
  isEavesdropping?: boolean;
  onEavesdropClick?: (coords: { lat: number; lng: number }) => void;
  onCameraMove?: (coords: { lat: number; lng: number }) => void;
  viewBoundsRef?: React.RefObject<{ south: number; west: number; north: number; east: number } | null>;
  trackedSdr?: KiwiSDR | null;
  setTrackedSdr?: (sdr: KiwiSDR | null) => void;
  // Pikud HaOref time scrubber (null = live mode)
  pikudTimeOffset?: number | null;
  pikudHistoryData?: PikudAlert[];
  // Ukraine time scrubber (null = live mode)
  ukraineTimeOffset?: number | null;
  ukraineHistoryData?: UkraineAlert[];
  // BGP anomalies time scrubber (null = live mode)
  bgpTimeOffset?: number | null;
  bgpHistoryData?: BgpAnomaly[];
  // CF anomalies time scrubber (null = live mode)
  cfTimeOffset?: number | null;
  cfHistoryData?: CfAnomaly[];
  // Military base filter: owner country → enabled branches
  milBaseFilter?: Record<string, Set<MilBaseBranch>>;
}
