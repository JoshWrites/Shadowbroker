"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plane, AlertTriangle, Activity, Satellite, Cctv, ChevronDown, ChevronUp, Ship, Eye, Anchor, Settings, Sun, Moon, BookOpen, Radio, Play, Pause, Globe, Flame, Wifi, Server, Shield, ToggleLeft, ToggleRight, Palette, Search, TrainFront } from "lucide-react";
import packageJson from "../../package.json";
import { useTheme } from "@/lib/ThemeContext";
import PikudDrilldownModal from "@/components/PikudDrilldownModal";

function relativeTime(iso: string | undefined): string {
    if (!iso) return "";
    const diff = Date.now() - new Date(iso + "Z").getTime();
    if (diff < 0) return "now";
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
}

// Map layer IDs to freshness keys from the backend source_timestamps dict
const FRESHNESS_MAP: Record<string, string> = {
    flights: "commercial_flights",
    private: "private_flights",
    jets: "private_jets",
    military: "military_flights",
    tracked: "military_flights",
    earthquakes: "earthquakes",
    satellites: "satellites",
    ships_military: "ships",
    ships_cargo: "ships",
    ships_civilian: "ships",
    ships_passenger: "ships",
    ships_tracked_yachts: "ships",
    ukraine_frontline: "frontlines",
    global_incidents: "gdelt",
    cctv: "cctv",
    gps_jamming: "commercial_flights",
    kiwisdr: "kiwisdr",
    firms: "firms_fires",
    internet_outages: "internet_outages",
    datacenters: "datacenters",
    pikud_alerts: "pikud_alerts",
    ukraine_alerts: "ukraine_alerts",
    bgp_anomalies: "bgp_anomalies",
    cf_anomalies: "cf_anomalies",
    active_ddos: "active_ddos",
    scanners: "scanners",
    power_plants: "power_plants",
    sigint_meshtastic: "sigint",
    sigint_aprs: "sigint",
    psk_reporter: "psk_reporter",
    satnogs: "satnogs_stations",
    tinygs: "tinygs_satellites",
    weather_alerts: "weather_alerts",
    air_quality: "air_quality",
    volcanoes: "volcanoes",
    fishing_activity: "fishing_activity",
    correlations: "correlations",
    viirs_nightlights: "viirs_change_nodes",
    uap_sightings: "uap_sightings",
    wastewater: "wastewater",
    crowdthreat: "crowdthreat",
    sar: "sar_anomalies",
};

// POTUS fleet ICAO hex codes for client-side filtering
const POTUS_ICAOS: Record<string, { label: string; type: string }> = {
    'ADFDF8': { label: 'Air Force One (82-8000)', type: 'AF1' },
    'ADFDF9': { label: 'Air Force One (92-9000)', type: 'AF1' },
    'ADFEB7': { label: 'Air Force Two (98-0001)', type: 'AF2' },
    'ADFEB8': { label: 'Air Force Two (98-0002)', type: 'AF2' },
    'ADFEB9': { label: 'Air Force Two (99-0003)', type: 'AF2' },
    'ADFEBA': { label: 'Air Force Two (99-0004)', type: 'AF2' },
    'AE4AE6': { label: 'Air Force Two (09-0015)', type: 'AF2' },
    'AE4AE8': { label: 'Air Force Two (09-0016)', type: 'AF2' },
    'AE4AEA': { label: 'Air Force Two (09-0017)', type: 'AF2' },
    'AE4AEC': { label: 'Air Force Two (19-0018)', type: 'AF2' },
    'AE0865': { label: 'Marine One (VH-3D)', type: 'M1' },
    'AE5E76': { label: 'Marine One (VH-92A)', type: 'M1' },
    'AE5E77': { label: 'Marine One (VH-92A)', type: 'M1' },
    'AE5E79': { label: 'Marine One (VH-92A)', type: 'M1' },
};
import type { DashboardData, ActiveLayers, SelectedEntity, KiwiSDR, BgpAnomaly, CfAnomaly, MilBaseBranch } from "@/types/dashboard";
import type { LayerErrorState } from "@/hooks/useDataPolling";
import { MIL_BASE_BRANCHES } from "@/types/dashboard";
import { BRANCH_COLORS } from "@/components/map/geoJSONBuilders";

// Derive owner → branches from live data, build default "all on" filter
function buildMilBaseFilterFromData(bases: any[]): Record<string, Set<MilBaseBranch>> {
    const result: Record<string, Set<MilBaseBranch>> = {};
    for (const b of bases) {
        const owner = b.owner || b.country || 'Unknown';
        if (!result[owner]) result[owner] = new Set();
        result[owner].add(b.branch as MilBaseBranch);
    }
    return result;
}

// Preferred display order for owner countries
const OWNER_ORDER = ['United States', 'China', 'Russia', 'North Korea', 'Taiwan', 'Philippines', 'Australia'];
import UkraineDrilldownModal from "@/components/UkraineDrilldownModal";

const WorldviewLeftPanel = React.memo(function WorldviewLeftPanel({ data, activeLayers, setActiveLayers, layerErrors, onSettingsClick, onLegendClick, gibsDate, setGibsDate, gibsOpacity, setGibsOpacity, onEntityClick, onFlyTo, trackedSdr, setTrackedSdr, pikudTimeOffset, setPikudTimeOffset, pikudDbRange, ukraineTimeOffset, setUkraineTimeOffset, ukraineDbRange, bgpTimeOffset, setBgpTimeOffset, bgpDbRange, cfTimeOffset, setCfTimeOffset, cfDbRange, milBaseFilter, setMilBaseFilter }: { data: DashboardData; activeLayers: ActiveLayers; setActiveLayers: React.Dispatch<React.SetStateAction<ActiveLayers>>; layerErrors?: Record<string, LayerErrorState>; onSettingsClick?: () => void; onLegendClick?: () => void; gibsDate?: string; setGibsDate?: (d: string) => void; gibsOpacity?: number; setGibsOpacity?: (o: number) => void; onEntityClick?: (entity: SelectedEntity) => void; onFlyTo?: (lat: number, lng: number) => void; trackedSdr?: KiwiSDR | null; setTrackedSdr?: (sdr: KiwiSDR | null) => void; pikudTimeOffset?: number | null; setPikudTimeOffset?: React.Dispatch<React.SetStateAction<number | null>>; pikudDbRange?: { earliest: number | null; latest: number | null }; ukraineTimeOffset?: number | null; setUkraineTimeOffset?: React.Dispatch<React.SetStateAction<number | null>>; ukraineDbRange?: { earliest: number | null; latest: number | null }; bgpTimeOffset?: number | null; setBgpTimeOffset?: React.Dispatch<React.SetStateAction<number | null>>; bgpDbRange?: { earliest: number | null; latest: number | null }; cfTimeOffset?: number | null; setCfTimeOffset?: React.Dispatch<React.SetStateAction<number | null>>; cfDbRange?: { earliest: number | null; latest: number | null }; milBaseFilter?: Record<string, Set<MilBaseBranch>>; setMilBaseFilter?: React.Dispatch<React.SetStateAction<Record<string, Set<MilBaseBranch>>>> }) {
    const [isMinimized, setIsMinimized] = useState(false);
    const { theme, toggleTheme, hudColor, cycleHudColor } = useTheme();
    const [gibsPlaying, setGibsPlaying] = useState(false);
    const [pikudPlaying, setPikudPlaying] = useState(false);
    const [pikudDrilldownOpen, setPikudDrilldownOpen] = useState(false);
    const [ukrainePlaying, setUkrainePlaying] = useState(false);
    const [ukraineDrilldownOpen, setUkraineDrilldownOpen] = useState(false);
    const [bgpPlaying, setBgpPlaying] = useState(false);
    const [cfPlaying, setCfPlaying] = useState(false);
    const [potusEnabled, setPotusEnabled] = useState(true);
    const gibsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pikudIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const ukraineIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const bgpIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const cfIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // GIBS time slider play/pause animation
    useEffect(() => {
        if (!gibsPlaying || !setGibsDate) {
            if (gibsIntervalRef.current) clearInterval(gibsIntervalRef.current);
            gibsIntervalRef.current = null;
            return;
        }
        gibsIntervalRef.current = setInterval(() => {
            if (!gibsDate) return;
            const d = new Date(gibsDate + 'T00:00:00');
            d.setDate(d.getDate() + 1);
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            if (d > yesterday) {
                const start = new Date();
                start.setDate(start.getDate() - 30);
                setGibsDate(start.toISOString().slice(0, 10));
            } else {
                setGibsDate(d.toISOString().slice(0, 10));
            }
        }, 1500);
        return () => { if (gibsIntervalRef.current) clearInterval(gibsIntervalRef.current); };
    }, [gibsPlaying, gibsDate, setGibsDate]);

    // Pikud HaOref 24h playback — steps forward 10 minutes per tick, loops back to start
    useEffect(() => {
        if (!pikudPlaying || !setPikudTimeOffset) {
            if (pikudIntervalRef.current) clearInterval(pikudIntervalRef.current);
            pikudIntervalRef.current = null;
            return;
        }
        // Start from 24h ago if currently live
        if (pikudTimeOffset === null || pikudTimeOffset === 0) {
            setPikudTimeOffset(-1440);
        }
        pikudIntervalRef.current = setInterval(() => {
            setPikudTimeOffset((prev: number | null) => {
                const current = prev ?? -1440;
                const next = current + 10; // advance 10 minutes per tick
                if (next >= 0) {
                    setPikudPlaying(false);
                    return null; // return to live
                }
                return next;
            });
        }, 800);
        return () => { if (pikudIntervalRef.current) clearInterval(pikudIntervalRef.current); };
    }, [pikudPlaying, setPikudTimeOffset]);

    // Ukraine 24h playback
    useEffect(() => {
        if (!ukrainePlaying || !setUkraineTimeOffset) {
            if (ukraineIntervalRef.current) clearInterval(ukraineIntervalRef.current);
            ukraineIntervalRef.current = null;
            return;
        }
        if (ukraineTimeOffset === null || ukraineTimeOffset === 0) {
            setUkraineTimeOffset(-1440);
        }
        ukraineIntervalRef.current = setInterval(() => {
            setUkraineTimeOffset((prev: number | null) => {
                const current = prev ?? -1440;
                const next = current + 10;
                if (next >= 0) { setUkrainePlaying(false); return null; }
                return next;
            });
        }, 800);
        return () => { if (ukraineIntervalRef.current) clearInterval(ukraineIntervalRef.current); };
    }, [ukrainePlaying, setUkraineTimeOffset]);

    // BGP anomalies 3d playback
    useEffect(() => {
        if (!bgpPlaying || !setBgpTimeOffset) {
            if (bgpIntervalRef.current) clearInterval(bgpIntervalRef.current);
            bgpIntervalRef.current = null;
            return;
        }
        if (bgpTimeOffset === null || bgpTimeOffset === 0) {
            setBgpTimeOffset(-4320); // 3 days
        }
        bgpIntervalRef.current = setInterval(() => {
            setBgpTimeOffset((prev: number | null) => {
                const current = prev ?? -4320;
                const next = current + 30;
                if (next >= 0) { setBgpPlaying(false); return null; }
                return next;
            });
        }, 800);
        return () => { if (bgpIntervalRef.current) clearInterval(bgpIntervalRef.current); };
    }, [bgpPlaying, setBgpTimeOffset]);

    // CF anomalies 7d playback
    useEffect(() => {
        if (!cfPlaying || !setCfTimeOffset) {
            if (cfIntervalRef.current) clearInterval(cfIntervalRef.current);
            cfIntervalRef.current = null;
            return;
        }
        if (cfTimeOffset === null || cfTimeOffset === 0) {
            setCfTimeOffset(-10080); // 7 days
        }
        cfIntervalRef.current = setInterval(() => {
            setCfTimeOffset((prev: number | null) => {
                const current = prev ?? -10080;
                const next = current + 60;
                if (next >= 0) { setCfPlaying(false); return null; }
                return next;
            });
        }, 800);
        return () => { if (cfIntervalRef.current) clearInterval(cfIntervalRef.current); };
    }, [cfPlaying, setCfTimeOffset]);

    // Compute ship category counts (memoized — ships array can be 1000+ items)
    const { militaryShipCount, cargoShipCount, passengerShipCount, civilianShipCount, trackedYachtCount } = useMemo(() => {
        const ships = data?.ships;
        if (!ships || !ships.length) return { militaryShipCount: 0, cargoShipCount: 0, passengerShipCount: 0, civilianShipCount: 0, trackedYachtCount: 0 };
        let military = 0, cargo = 0, passenger = 0, civilian = 0, trackedYacht = 0;
        for (const s of ships) {
            if (s.yacht_alert) { trackedYacht++; continue; }
            const t = s.type;
            if (t === 'carrier' || t === 'military_vessel') military++;
            else if (t === 'tanker' || t === 'cargo') cargo++;
            else if (t === 'passenger') passenger++;
            else civilian++;
        }
        return { militaryShipCount: military, cargoShipCount: cargo, passengerShipCount: passenger, civilianShipCount: civilian, trackedYachtCount: trackedYacht };
    }, [data?.ships]);

    // Find POTUS fleet planes currently airborne from tracked flights
    const potusFlights = useMemo(() => {
        const tracked = data?.tracked_flights;
        if (!tracked) return [];
        const results: { index: number; flight: any; meta: { label: string; type: string } }[] = [];
        for (let i = 0; i < tracked.length; i++) {
            const f = tracked[i];
            const icao = (f.icao24 || '').toUpperCase();
            if (POTUS_ICAOS[icao]) {
                results.push({ index: i, flight: f, meta: POTUS_ICAOS[icao] });
            }
        }
        return results;
    }, [data?.tracked_flights]);

    const layers = [
        { id: "flights", name: "Commercial Flights", source: "adsb.lol", count: data?.commercial_flights?.length || 0, icon: Plane },
        { id: "private", name: "Private Flights", source: "adsb.lol", count: data?.private_flights?.length || 0, icon: Plane },
        { id: "jets", name: "Private Jets", source: "adsb.lol", count: data?.private_jets?.length || 0, icon: Plane },
        { id: "military", name: "Military Flights", source: "adsb.lol", count: data?.military_flights?.length || 0, icon: AlertTriangle },
        { id: "tracked", name: "Tracked Aircraft", source: "Plane-Alert DB", count: data?.tracked_flights?.length || 0, icon: Eye },
        { id: "trains", name: "Trains (Live)", source: "Amtraker · Digitraffic · IL Rail", count: data?.trains?.length || 0, icon: TrainFront },
        { id: "railway_map", name: "Railway Map", source: "OpenRailwayMap", count: null, icon: TrainFront },
        { id: "earthquakes", name: "Earthquakes (24h)", source: "USGS", count: data?.earthquakes?.length || 0, icon: Activity },
        { id: "satellites", name: "Satellites", source: data?.satellite_source === "celestrak" ? "CelesTrak SGP4" : data?.satellite_source === "tle_api" ? "TLE API · SGP4" : data?.satellite_source === "disk_cache" ? "Cached · SGP4 (est.)" : "CelesTrak SGP4", count: data?.satellites?.length || 0, icon: Satellite },
        { id: "ships_military", name: "Military / Carriers", source: "AIS Stream", count: militaryShipCount, icon: Ship },
        { id: "ships_cargo", name: "Cargo / Tankers", source: "AIS Stream", count: cargoShipCount, icon: Ship },
        { id: "ships_civilian", name: "Civilian Vessels", source: "AIS Stream", count: civilianShipCount, icon: Anchor },
        { id: "ships_passenger", name: "Cruise / Passenger", source: "AIS Stream", count: passengerShipCount, icon: Anchor },
        { id: "ships_tracked_yachts", name: "Tracked Yachts", source: "Yacht-Alert DB", count: trackedYachtCount, icon: Eye },
        { id: "ukraine_frontline", name: "Ukraine Frontline", source: "DeepStateMap", count: data?.frontlines ? 1 : 0, icon: AlertTriangle },
        { id: "global_incidents", name: "Global Incidents", source: "GDELT", count: data?.gdelt?.length || 0, icon: Activity },
        { id: "cctv", name: "CCTV Mesh", source: "CCTV Mesh + Street View", count: data?.cctv?.length || 0, icon: Cctv },
        { id: "gps_jamming", name: "GPS Jamming", source: "ADS-B NACp", count: data?.gps_jamming?.length || 0, icon: Radio },
        { id: "gibs_imagery", name: "MODIS Terra (Daily)", source: "NASA GIBS", count: null, icon: Globe },
        { id: "highres_satellite", name: "High-Res Satellite", source: "Esri World Imagery", count: null, icon: Satellite },
        { id: "kiwisdr", name: "KiwiSDR Receivers", source: "KiwiSDR.com", count: data?.kiwisdr?.length || 0, icon: Radio },
        { id: "firms", name: "Fire Hotspots (24h)", source: "NASA FIRMS VIIRS", count: data?.firms_fires?.length || 0, icon: Flame },
        { id: "internet_outages", name: "Internet Outages", source: "IODA / Georgia Tech", count: data?.internet_outages?.length || 0, icon: Wifi },
        { id: "datacenters", name: "Data Centers", source: "DC Map (GitHub)", count: data?.datacenters?.length || 0, icon: Server },
        { id: "military_bases", name: "Military Bases", source: "NTAD + OSINT", count: data?.military_bases?.length || 0, icon: Shield },
        { id: "pikud_alerts", name: "Israel Red Alerts", source: "Pikud HaOref", count: data?.pikud_alerts?.length || 0, icon: AlertTriangle },
        { id: "ukraine_alerts", name: "Ukraine Air Alerts", source: "alerts.in.ua", count: data?.ukraine_alerts?.length || 0, icon: AlertTriangle },
        { id: "bgp_anomalies", name: "BGP Anomalies", source: "Cloudflare Radar", count: data?.bgp_anomalies?.length || 0, icon: Wifi },
        { id: "cf_anomalies", name: "CF Traffic Anomalies", source: "Cloudflare Radar", count: data?.cf_anomalies?.length || 0, icon: Activity },
        { id: "active_ddos", name: "Active DDoS Arcs", source: "Cloudflare Radar", count: data?.active_ddos?.length || 0, icon: Activity },
        { id: "day_night", name: "Day / Night Cycle", source: "Solar Calc", count: null, icon: Sun },
        { id: "weather_radar", name: "Weather Radar", source: "RainViewer", count: null, icon: Globe },
        { id: "weather_clouds", name: "Cloud Cover Map", source: "OpenWeatherMap", count: null, icon: Globe },
        { id: "weather_precipitation", name: "Precipitation Map", source: "OpenWeatherMap", count: null, icon: Globe },
        { id: "weather_pressure", name: "Pressure Map", source: "OpenWeatherMap", count: null, icon: Globe },
        { id: "weather_wind", name: "Wind Map", source: "OpenWeatherMap", count: null, icon: Globe },
        { id: "weather_temperature", name: "Temperature Map", source: "OpenWeatherMap", count: null, icon: Globe },
        // SIGINT
        { id: "sigint_meshtastic", name: "Meshtastic Mesh", source: "Meshtastic MQTT", count: data?.sigint?.filter?.((s: any) => s.protocol === 'meshtastic')?.length || 0, icon: Radio },
        { id: "sigint_aprs", name: "APRS / JS8Call", source: "APRS-IS", count: data?.sigint?.filter?.((s: any) => s.protocol !== 'meshtastic')?.length || 0, icon: Radio },
        { id: "scanners", name: "Police Scanners", source: "OpenMHz", count: data?.scanners?.length || 0, icon: Radio },
        { id: "psk_reporter", name: "PSK Reporter", source: "PSKReporter.info", count: data?.psk_reporter?.length || 0, icon: Radio },
        { id: "satnogs", name: "SatNOGS Stations", source: "SatNOGS Network", count: data?.satnogs_stations?.length || 0, icon: Satellite },
        { id: "tinygs", name: "TinyGS Satellites", source: "TinyGS LoRa", count: data?.tinygs_satellites?.length || 0, icon: Satellite },
        // Infrastructure
        { id: "power_plants", name: "Power Plants", source: "WRI Global Power Plant DB", count: data?.power_plants?.length || 0, icon: Activity },
        // Environmental
        { id: "weather_alerts", name: "Weather Alerts", source: "NWS / Meteoalarm", count: data?.weather_alerts?.length || 0, icon: AlertTriangle },
        { id: "air_quality", name: "Air Quality", source: "OpenAQ", count: data?.air_quality?.length || 0, icon: Activity },
        { id: "volcanoes", name: "Volcanoes", source: "Smithsonian GVP", count: data?.volcanoes?.length || 0, icon: Flame },
        { id: "fishing_activity", name: "Fishing Activity", source: "Global Fishing Watch", count: data?.fishing_activity?.length || 0, icon: Anchor },
        // Intelligence
        { id: "correlations", name: "Correlations", source: "Shadowbroker Engine", count: data?.correlations?.length || 0, icon: Activity },
        { id: "viirs_nightlights", name: "VIIRS Nightlights", source: "NASA VIIRS", count: data?.viirs_change_nodes?.length || 0, icon: Globe },
        { id: "sentinel_hub", name: "Sentinel Hub", source: "Copernicus CDSE", count: null, icon: Satellite },
        { id: "shodan_overlay", name: "Shodan Overlay", source: "Shodan.io", count: null, icon: Server },
        // Additional OSINT feeds
        { id: "wastewater", name: "Wastewater SCAN", source: "WastewaterSCAN", count: data?.wastewater?.length || 0, icon: Activity },
        { id: "crowdthreat", name: "CrowdThreat", source: "CrowdThreat", count: data?.crowdthreat?.length || 0, icon: Shield },
        { id: "uap_sightings", name: "UAP Sightings", source: "NUFORC", count: data?.uap_sightings?.length || 0, icon: Eye },
        { id: "sar", name: "SAR Anomalies", source: "SAR Constellations", count: data?.sar_anomalies?.length || 0, icon: Satellite },
    ];

    const shipIcon = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" /><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76" /><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6" /></svg>;

    return (
        <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 1 }}
            className="w-full flex-1 min-h-0 flex flex-col pointer-events-none"
        >
            {/* Header */}
            <div className="mb-6 pointer-events-auto">
                <div className="text-[10px] text-[var(--text-secondary)] font-mono tracking-widest mb-1">TOP SECRET // SI-TK // NOFORN</div>
                <div className="text-[10px] text-[var(--text-muted)] font-mono tracking-widest mb-4">KH11-4094 OPS-4168</div>
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold tracking-[0.2em] text-[var(--text-heading)]">FLIR</h1>
                    <button
                        onClick={toggleTheme}
                        className={`w-7 h-7 rounded-lg border border-[var(--border-primary)] hover:border-cyan-500/50 flex items-center justify-center ${theme === 'dark' ? 'text-cyan-400' : 'text-[var(--text-muted)]'} hover:text-cyan-300 transition-all hover:bg-[var(--hover-accent)]`}
                        title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                    >
                        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                    </button>
                    <button
                        onClick={cycleHudColor}
                        className={`w-7 h-7 rounded-lg border border-[var(--border-primary)] hover:border-cyan-500/50 flex items-center justify-center text-cyan-400 hover:text-cyan-300 transition-all hover:bg-[var(--hover-accent)]`}
                        title={hudColor === 'cyan' ? 'Switch to Matrix HUD' : 'Switch to Cyan HUD'}
                    >
                        <Palette size={14} />
                    </button>
                    {onSettingsClick && (
                        <button
                            onClick={onSettingsClick}
                            className={`w-7 h-7 rounded-lg border border-[var(--border-primary)] hover:border-cyan-500/50 flex items-center justify-center ${theme === 'dark' ? 'text-cyan-400' : 'text-[var(--text-muted)]'} hover:text-cyan-300 transition-all hover:bg-[var(--hover-accent)] group`}
                            title="System Settings"
                        >
                            <Settings size={14} className="group-hover:rotate-90 transition-transform duration-300" />
                        </button>
                    )}
                    {onLegendClick && (
                        <button
                            onClick={onLegendClick}
                            className={`h-7 px-2 rounded-lg border border-[var(--border-primary)] hover:border-cyan-500/50 flex items-center justify-center gap-1 ${theme === 'dark' ? 'text-cyan-400' : 'text-[var(--text-muted)]'} hover:text-cyan-300 transition-all hover:bg-[var(--hover-accent)]`}
                            title="Map Legend / Icon Key"
                        >
                            <BookOpen size={12} />
                            <span className="text-[8px] font-mono tracking-widest font-bold">KEY</span>
                        </button>
                    )}
                    <span className={`h-7 px-2 rounded-lg border border-[var(--border-primary)] flex items-center justify-center text-[8px] ${theme === 'dark' ? 'text-cyan-400' : 'text-[var(--text-muted)]'} font-mono tracking-widest select-none`}>
                        v{packageJson.version}
                    </span>
                </div>
            </div>

            {/* Data Layers Box */}
            <div className="bg-[var(--bg-primary)]/40 backdrop-blur-md border border-[var(--border-primary)] rounded-xl pointer-events-auto shadow-[0_4px_30px_rgba(0,0,0,0.2)] flex flex-col relative max-h-full overflow-hidden">

                {/* Header / Toggle */}
                <div
                    className="flex justify-between items-center p-4 cursor-pointer hover:bg-[var(--bg-secondary)]/50 transition-colors border-b border-[var(--border-primary)]/50"
                >
                    <span className="text-[10px] text-[var(--text-muted)] font-mono tracking-widest" onClick={() => setIsMinimized(!isMinimized)}>DATA LAYERS</span>
                    <div className="flex items-center gap-2">
                        <button
                            title={Object.entries(activeLayers).filter(([k]) => k !== 'gibs_imagery').every(([, v]) => v) ? "Disable all layers" : "Enable all layers"}
                            className={`${Object.entries(activeLayers).filter(([k]) => k !== 'gibs_imagery').every(([, v]) => v) ? 'text-cyan-400' : 'text-[var(--text-muted)]'} hover:text-cyan-400 transition-colors`}
                            onClick={(e) => {
                                e.stopPropagation();
                                const allOn = Object.entries(activeLayers).filter(([k]) => k !== 'gibs_imagery').every(([, v]) => v);
                                setActiveLayers((prev: any) => {
                                    const next: any = {};
                                    for (const k of Object.keys(prev)) {
                                        next[k] = k === 'gibs_imagery' ? false : !allOn;
                                    }
                                    return next;
                                });
                            }}
                        >
                            {Object.entries(activeLayers).filter(([k]) => k !== 'gibs_imagery').every(([, v]) => v) ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                        </button>
                        <button className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" onClick={() => setIsMinimized(!isMinimized)}>
                            {isMinimized ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                        </button>
                    </div>
                </div>

                <AnimatePresence>
                    {!isMinimized && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-y-auto styled-scrollbar min-h-0 flex-1"
                        >
                            <div className="flex flex-col gap-6 p-4 pt-2 pb-6">
                                {/* SDR TRACKER — pinned to TOP when active */}
                                {trackedSdr && (
                                    <div className="bg-amber-950/20 border border-amber-500/40 rounded-lg p-3 -mt-1 shadow-[0_0_15px_rgba(245,158,11,0.1)]">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <Radio size={14} className="text-amber-400" />
                                                <span className="text-[10px] text-amber-400 font-mono tracking-widest font-bold">SDR TRACKER</span>
                                                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-400 animate-pulse">
                                                    LIVE
                                                </span>
                                            </div>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setTrackedSdr?.(null); }}
                                                className="text-[8px] font-mono text-[var(--text-muted)] hover:text-red-400 border border-[var(--border-primary)] hover:border-red-400/40 rounded px-1.5 py-0.5 transition-colors"
                                                title="Release SDR and clear tracking"
                                            >
                                                RELEASE
                                            </button>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <div className="flex flex-col p-2 rounded-lg border border-amber-500/20 bg-amber-950/10">
                                                <span className="text-[10px] font-bold font-mono text-amber-300 truncate mb-1">
                                                    {(trackedSdr.name || 'REMOTE RECEIVER').toUpperCase()}
                                                </span>
                                                <div className="text-[8px] text-[var(--text-muted)] font-mono mb-2">
                                                    {trackedSdr.location && <span>{trackedSdr.location} · </span>}
                                                    {trackedSdr.antenna && <span>{trackedSdr.antenna.slice(0, 40)}</span>}
                                                </div>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <button
                                                        onClick={() => onFlyTo?.(trackedSdr.lat, trackedSdr.lon)}
                                                        className="flex-1 text-center px-2 py-1.5 rounded border border-[var(--border-primary)] hover:border-amber-400/50 hover:text-amber-400 text-[var(--text-muted)] text-[9px] font-mono tracking-widest transition-colors flex items-center justify-center gap-1.5"
                                                        title="Pan camera to SDR location"
                                                    >
                                                        <Globe size={10} /> RE-LOCK
                                                    </button>
                                                    {trackedSdr.url && (
                                                        <a
                                                            href={trackedSdr.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="flex-1 text-center px-2 py-1.5 rounded border border-amber-500/50 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 hover:border-amber-400 text-[9px] font-mono tracking-widest transition-colors flex items-center justify-center gap-1.5"
                                                        >
                                                            <Activity size={10} /> TUNER
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* POTUS Fleet — pinned to TOP when aircraft are active */}
                                {potusEnabled && potusFlights.length > 0 && (
                                    <div className="bg-[#ff1493]/5 border border-[#ff1493]/30 rounded-lg p-3 -mt-1">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <Shield size={14} className="text-[#ff1493]" />
                                                <span className="text-[10px] text-[#ff1493] font-mono tracking-widest font-bold">POTUS FLEET</span>
                                                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-[#ff1493]/20 border border-[#ff1493]/40 text-[#ff1493] animate-pulse">
                                                    {potusFlights.length} ACTIVE
                                                </span>
                                            </div>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setPotusEnabled(false); }}
                                                className="text-[8px] font-mono text-[var(--text-muted)] hover:text-[#ff1493] border border-[var(--border-primary)] hover:border-[#ff1493]/40 rounded px-1.5 py-0.5 transition-colors"
                                                title="Hide POTUS Fleet tracker"
                                            >
                                                HIDE
                                            </button>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            {potusFlights.map((pf) => {
                                                const color = pf.meta.type === 'AF1' ? '#ff1493' : pf.meta.type === 'M1' ? '#ff1493' : '#3b82f6';
                                                const alt = pf.flight.alt_baro || pf.flight.alt || 0;
                                                const speed = pf.flight.gs || pf.flight.speed || 0;
                                                return (
                                                    <div
                                                        key={pf.flight.icao24}
                                                        className="flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-all hover:bg-[var(--bg-secondary)]/60"
                                                        style={{ borderColor: `${color}40`, background: `${color}10` }}
                                                        onClick={() => {
                                                            if (onFlyTo && pf.flight.lat != null && pf.flight.lng != null) {
                                                                onFlyTo(pf.flight.lat, pf.flight.lng);
                                                            }
                                                            if (onEntityClick) {
                                                                onEntityClick({ type: 'tracked_flight', id: pf.flight.icao24 });
                                                            }
                                                        }}
                                                    >
                                                        <div className="flex flex-col">
                                                            <span className="text-[10px] font-bold font-mono" style={{ color }}>{pf.meta.label}</span>
                                                            <span className="text-[8px] text-[var(--text-muted)] font-mono mt-0.5">
                                                                {alt > 0 ? `${Math.round(alt).toLocaleString()} ft` : 'GND'} · {speed > 0 ? `${Math.round(speed)} kts` : 'STATIC'}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5">
                                                            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: color }} />
                                                            <span className="text-[8px] font-mono" style={{ color }}>TRACK</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {layers.map((layer, idx) => {
                                    const Icon = layer.icon;
                                    const active = activeLayers[layer.id as keyof typeof activeLayers] || false;
                                    const errorState = layerErrors?.[layer.id];

                                    return (
                                        <div key={idx} className="flex flex-col">
                                            <div
                                                className="flex items-start justify-between group cursor-pointer"
                                                onClick={() => setActiveLayers((prev: any) => ({ ...prev, [layer.id]: !active }))}
                                            >
                                                <div className="flex gap-3">
                                                    <div className={`mt-1 ${errorState ? 'text-red-400' : active ? 'text-cyan-400' : 'text-gray-600 group-hover:text-gray-400'} transition-colors`}>
                                                        {(layer.id.startsWith('ships_')) ? shipIcon : <Icon size={16} strokeWidth={1.5} />}
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className={`text-sm font-medium ${errorState ? 'text-red-300' : active ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'} tracking-wide`}>{layer.name}</span>
                                                        {errorState === 'failed' ? (
                                                            <span className="text-[9px] text-red-400/80 font-mono tracking-wider mt-0.5">ERROR: TOGGLE TO RETRY</span>
                                                        ) : errorState === 'retrying' ? (
                                                            <span className="text-[9px] text-amber-400/80 font-mono tracking-wider mt-0.5 flex items-center gap-1">
                                                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                                                {layer.source} · RETRYING
                                                            </span>
                                                        ) : (
                                                            <span className="text-[9px] text-[var(--text-muted)] font-mono tracking-wider mt-0.5">{layer.source} · {active ? (() => {
                                                                const fKey = FRESHNESS_MAP[layer.id];
                                                                const freshness = fKey && data?.freshness?.[fKey];
                                                                const rt = freshness ? relativeTime(freshness) : '';
                                                                return rt ? <span className="text-cyan-500/70">{rt}</span> : 'LIVE';
                                                            })() : 'OFF'}</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    {active && !errorState && (layer.count ?? 0) > 0 && (
                                                        <span className="text-[10px] text-gray-300 font-mono">{(layer.count ?? 0).toLocaleString()}</span>
                                                    )}
                                                    <div className={`text-[9px] font-mono tracking-wider px-2 py-0.5 rounded-full border ${
                                                        errorState === 'failed'
                                                            ? 'border-red-500/50 text-red-400 bg-red-950/30 shadow-[0_0_10px_rgba(239,68,68,0.2)]'
                                                        : errorState === 'retrying'
                                                            ? 'border-amber-500/50 text-amber-400 bg-amber-950/30'
                                                        : active
                                                            ? 'border-cyan-500/50 text-cyan-400 bg-cyan-950/30 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                                                            : 'border-[var(--border-primary)] text-[var(--text-muted)] bg-transparent'
                                                        }`}>
                                                        {errorState === 'failed' ? 'ERR' : errorState === 'retrying' ? 'RETRY' : active ? 'ON' : 'OFF'}
                                                    </div>
                                                </div>
                                            </div>
                                            {/* Military Bases filter: Country → Branch */}
                                            {active && layer.id === 'military_bases' && setMilBaseFilter && (() => {
                                                // Build default filter from data if empty
                                                const allFromData = buildMilBaseFilterFromData(data?.military_bases || []);
                                                const filter = milBaseFilter && Object.keys(milBaseFilter).length > 0
                                                    ? milBaseFilter : allFromData;
                                                // Auto-initialize filter on first render
                                                if ((!milBaseFilter || Object.keys(milBaseFilter).length === 0) && Object.keys(allFromData).length > 0) {
                                                    setTimeout(() => setMilBaseFilter(allFromData), 0);
                                                }
                                                const owners = OWNER_ORDER.filter(o => allFromData[o]);
                                                // Add any owners not in the preferred order
                                                for (const o of Object.keys(allFromData)) {
                                                    if (!owners.includes(o)) owners.push(o);
                                                }
                                                return (
                                                    <div className="ml-7 mt-2 flex flex-col gap-0.5 max-h-[260px] overflow-y-auto" onClick={e => e.stopPropagation()}>
                                                        <div className="flex items-center justify-between mb-1">
                                                            <span className="text-[8px] text-[var(--text-muted)] font-mono tracking-wider">FILTER</span>
                                                            <div className="flex gap-2">
                                                                <button onClick={() => setMilBaseFilter(allFromData)}
                                                                    className="text-[7px] font-mono text-cyan-400/70 hover:text-cyan-400">ALL</button>
                                                                <button onClick={() => setMilBaseFilter({})}
                                                                    className="text-[7px] font-mono text-cyan-400/70 hover:text-cyan-400">NONE</button>
                                                            </div>
                                                        </div>
                                                        {owners.map(owner => {
                                                            const ownerBranches = Array.from(allFromData[owner] || []);
                                                            const enabledSet = filter[owner];
                                                            const allOn = enabledSet && ownerBranches.every(b => enabledSet.has(b));
                                                            const someOn = enabledSet && enabledSet.size > 0;
                                                            return (
                                                                <div key={owner} className="mb-1">
                                                                    <button
                                                                        onClick={() => {
                                                                            setMilBaseFilter(prev => {
                                                                                const next = { ...prev };
                                                                                if (allOn) {
                                                                                    delete next[owner];
                                                                                } else {
                                                                                    next[owner] = new Set(ownerBranches as MilBaseBranch[]);
                                                                                }
                                                                                return next;
                                                                            });
                                                                        }}
                                                                        className={`flex items-center gap-1.5 w-full text-left text-[9px] font-mono font-bold tracking-wider transition-colors ${allOn ? 'text-cyan-400' : someOn ? 'text-cyan-400/60' : 'text-[var(--text-muted)]/40'}`}
                                                                    >
                                                                        <span className="text-[7px]">{allOn ? '▾' : '▸'}</span>
                                                                        {owner.toUpperCase()}
                                                                        <span className="text-[7px] text-[var(--text-muted)] font-normal ml-auto">{enabledSet ? enabledSet.size : 0}/{ownerBranches.length}</span>
                                                                    </button>
                                                                    {someOn && ownerBranches.map(branchKey => {
                                                                        const branchInfo = MIL_BASE_BRANCHES.find(b => b.key === branchKey);
                                                                        const label = branchInfo?.label || branchKey;
                                                                        const on = enabledSet?.has(branchKey as MilBaseBranch);
                                                                        const color = BRANCH_COLORS[branchKey] || '#9ca3af';
                                                                        return (
                                                                            <button
                                                                                key={branchKey}
                                                                                onClick={() => {
                                                                                    setMilBaseFilter(prev => {
                                                                                        const next = { ...prev };
                                                                                        const s = new Set(next[owner] || []);
                                                                                        if (s.has(branchKey as MilBaseBranch)) s.delete(branchKey as MilBaseBranch);
                                                                                        else s.add(branchKey as MilBaseBranch);
                                                                                        if (s.size === 0) delete next[owner];
                                                                                        else next[owner] = s;
                                                                                        return next;
                                                                                    });
                                                                                }}
                                                                                className={`flex items-center gap-2 pl-4 py-0.5 text-[8px] font-mono transition-colors ${on ? 'opacity-100' : 'opacity-30'}`}
                                                                            >
                                                                                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                                                                                <span style={{ color: on ? color : undefined }}>{label}</span>
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                );
                                            })()}
                                            {/* GIBS Imagery inline controls: time slider + play/pause + opacity */}
                                            {active && layer.id === 'pikud_alerts' && setPikudTimeOffset && (
                                                <div className="ml-7 mt-2 flex flex-col gap-1" onClick={e => e.stopPropagation()}>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => setPikudPlaying(p => !p)}
                                                            className="w-5 h-5 flex items-center justify-center rounded border border-red-500/30 text-red-400 hover:bg-red-950/30 transition-colors flex-shrink-0"
                                                        >
                                                            {pikudPlaying ? <Pause size={10} /> : <Play size={10} />}
                                                        </button>
                                                        <input
                                                            type="range"
                                                            min={-1440}
                                                            max={0}
                                                            step={5}
                                                            value={pikudTimeOffset ?? 0}
                                                            onChange={e => {
                                                                setPikudPlaying(false);
                                                                const v = parseInt(e.target.value);
                                                                setPikudTimeOffset(v === 0 ? null : v);
                                                            }}
                                                            className="flex-1 h-1 accent-red-500 cursor-pointer"
                                                        />
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[8px] text-red-400 font-mono">
                                                            {pikudTimeOffset === null || pikudTimeOffset === 0
                                                                ? "LIVE"
                                                                : (() => {
                                                                    const mins = Math.abs(pikudTimeOffset ?? 0);
                                                                    if (mins < 60) return `${mins}m ago`;
                                                                    const h = Math.floor(mins / 60);
                                                                    const m = mins % 60;
                                                                    return m ? `${h}h ${m}m ago` : `${h}h ago`;
                                                                })()}
                                                        </span>
                                                        <div className="flex items-center gap-2">
                                                            {pikudTimeOffset !== null && pikudTimeOffset !== 0 && (
                                                                <button
                                                                    onClick={() => { setPikudPlaying(false); setPikudTimeOffset(null); }}
                                                                    className="text-[8px] text-red-400 hover:text-red-300 font-mono underline"
                                                                >LIVE</button>
                                                            )}
                                                            <button
                                                                onClick={() => setPikudDrilldownOpen(true)}
                                                                title="Archive drill-down"
                                                                className="flex items-center gap-1 text-[8px] font-mono text-red-400/70 hover:text-red-400 transition-colors"
                                                            >
                                                                <Search size={9} /> ARCHIVE
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                            {pikudDrilldownOpen && setPikudTimeOffset && pikudDbRange && (
                                                <PikudDrilldownModal
                                                    onClose={() => setPikudDrilldownOpen(false)}
                                                    pikudDbRange={pikudDbRange}
                                                    setPikudTimeOffset={setPikudTimeOffset}
                                                    pikudTimeOffset={pikudTimeOffset ?? null}
                                                />
                                            )}
                                            {active && layer.id === 'ukraine_alerts' && setUkraineTimeOffset && (
                                                <div className="ml-7 mt-2 flex flex-col gap-1" onClick={e => e.stopPropagation()}>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => setUkrainePlaying(p => !p)}
                                                            className="w-5 h-5 flex items-center justify-center rounded border border-blue-500/30 text-blue-400 hover:bg-blue-950/30 transition-colors flex-shrink-0"
                                                        >
                                                            {ukrainePlaying ? <Pause size={10} /> : <Play size={10} />}
                                                        </button>
                                                        <input
                                                            type="range"
                                                            min={-1440}
                                                            max={0}
                                                            step={5}
                                                            value={ukraineTimeOffset ?? 0}
                                                            onChange={e => {
                                                                setUkrainePlaying(false);
                                                                const v = parseInt(e.target.value);
                                                                setUkraineTimeOffset(v === 0 ? null : v);
                                                            }}
                                                            className="flex-1 h-1 accent-blue-500 cursor-pointer"
                                                        />
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[8px] text-blue-400 font-mono">
                                                            {ukraineTimeOffset === null || ukraineTimeOffset === 0
                                                                ? "LIVE"
                                                                : (() => {
                                                                    const mins = Math.abs(ukraineTimeOffset ?? 0);
                                                                    if (mins < 60) return `${mins}m ago`;
                                                                    const h = Math.floor(mins / 60);
                                                                    const m = mins % 60;
                                                                    return m ? `${h}h ${m}m ago` : `${h}h ago`;
                                                                })()}
                                                        </span>
                                                        <div className="flex items-center gap-2">
                                                            {ukraineTimeOffset !== null && ukraineTimeOffset !== 0 && (
                                                                <button
                                                                    onClick={() => { setUkrainePlaying(false); setUkraineTimeOffset(null); }}
                                                                    className="text-[8px] text-blue-400 hover:text-blue-300 font-mono underline"
                                                                >LIVE</button>
                                                            )}
                                                            <button
                                                                onClick={() => setUkraineDrilldownOpen(true)}
                                                                title="Archive drill-down"
                                                                className="flex items-center gap-1 text-[8px] font-mono text-blue-400/70 hover:text-blue-400 transition-colors"
                                                            >
                                                                <Search size={9} /> ARCHIVE
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                            {ukraineDrilldownOpen && setUkraineTimeOffset && ukraineDbRange && (
                                                <UkraineDrilldownModal
                                                    onClose={() => setUkraineDrilldownOpen(false)}
                                                    ukraineDbRange={ukraineDbRange}
                                                    setUkraineTimeOffset={setUkraineTimeOffset}
                                                    ukraineTimeOffset={ukraineTimeOffset ?? null}
                                                />
                                            )}
                                            {active && layer.id === 'bgp_anomalies' && setBgpTimeOffset && (
                                                <div className="ml-7 mt-2 flex flex-col gap-1.5" onClick={e => e.stopPropagation()}>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => setBgpPlaying(p => !p)}
                                                            className="w-5 h-5 flex items-center justify-center rounded border border-cyan-500/30 text-cyan-400 hover:bg-cyan-950/30 transition-colors"
                                                        >
                                                            {bgpPlaying ? <Pause size={10} /> : <Play size={10} />}
                                                        </button>
                                                        <input
                                                            type="range"
                                                            min={-4320}
                                                            max={0}
                                                            step={30}
                                                            value={bgpTimeOffset ?? 0}
                                                            onChange={e => {
                                                                const v = parseInt(e.target.value);
                                                                setBgpTimeOffset(v === 0 ? null : v);
                                                            }}
                                                            className="flex-1 h-1 accent-cyan-500 cursor-pointer"
                                                        />
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[8px] font-mono text-cyan-400">
                                                            {bgpTimeOffset === null || bgpTimeOffset === 0
                                                                ? "LIVE"
                                                                : (() => {
                                                                    const mins = Math.abs(bgpTimeOffset ?? 0);
                                                                    if (mins >= 1440) return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h ago`;
                                                                    return `${Math.floor(mins / 60)}h ago`;
                                                                })()}
                                                        </span>
                                                        {bgpTimeOffset !== null && bgpTimeOffset !== 0 && (
                                                            <button
                                                                className="text-[8px] font-mono text-cyan-500/60 hover:text-cyan-400"
                                                                onClick={() => { setBgpPlaying(false); setBgpTimeOffset(null); }}
                                                            >LIVE</button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                            {active && layer.id === 'cf_anomalies' && setCfTimeOffset && (
                                                <div className="ml-7 mt-2 flex flex-col gap-1.5" onClick={e => e.stopPropagation()}>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => setCfPlaying(p => !p)}
                                                            className="w-5 h-5 flex items-center justify-center rounded border border-cyan-500/30 text-cyan-400 hover:bg-cyan-950/30 transition-colors"
                                                        >
                                                            {cfPlaying ? <Pause size={10} /> : <Play size={10} />}
                                                        </button>
                                                        <input
                                                            type="range"
                                                            min={-10080}
                                                            max={0}
                                                            step={60}
                                                            value={cfTimeOffset ?? 0}
                                                            onChange={e => {
                                                                const v = parseInt(e.target.value);
                                                                setCfTimeOffset(v === 0 ? null : v);
                                                            }}
                                                            className="flex-1 h-1 accent-cyan-500 cursor-pointer"
                                                        />
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[8px] font-mono text-cyan-400">
                                                            {cfTimeOffset === null || cfTimeOffset === 0
                                                                ? "LIVE"
                                                                : (() => {
                                                                    const mins = Math.abs(cfTimeOffset ?? 0);
                                                                    if (mins >= 1440) return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h ago`;
                                                                    return `${Math.floor(mins / 60)}h ago`;
                                                                })()}
                                                        </span>
                                                        {cfTimeOffset !== null && cfTimeOffset !== 0 && (
                                                            <button
                                                                className="text-[8px] font-mono text-cyan-500/60 hover:text-cyan-400"
                                                                onClick={() => { setCfPlaying(false); setCfTimeOffset(null); }}
                                                            >LIVE</button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                            {active && layer.id === 'gibs_imagery' && gibsDate && setGibsDate && setGibsOpacity && (
                                                <div className="ml-7 mt-2 flex flex-col gap-2" onClick={e => e.stopPropagation()}>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => setGibsPlaying(p => !p)}
                                                            className="w-5 h-5 flex items-center justify-center rounded border border-cyan-500/30 text-cyan-400 hover:bg-cyan-950/30 transition-colors"
                                                        >
                                                            {gibsPlaying ? <Pause size={10} /> : <Play size={10} />}
                                                        </button>
                                                        <input
                                                            type="range"
                                                            min={0}
                                                            max={29}
                                                            value={(() => {
                                                                const yesterday = new Date();
                                                                yesterday.setDate(yesterday.getDate() - 1);
                                                                const selected = new Date(gibsDate + 'T00:00:00');
                                                                const diff = Math.round((yesterday.getTime() - selected.getTime()) / 86400000);
                                                                return 29 - Math.max(0, Math.min(29, diff));
                                                            })()}
                                                            onChange={e => {
                                                                const daysAgo = 29 - parseInt(e.target.value);
                                                                const d = new Date();
                                                                d.setDate(d.getDate() - 1 - daysAgo);
                                                                setGibsDate(d.toISOString().slice(0, 10));
                                                            }}
                                                            className="flex-1 h-1 accent-cyan-500 cursor-pointer"
                                                        />
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[8px] text-cyan-400 font-mono">{gibsDate}</span>
                                                        <div className="flex items-center gap-1">
                                                            <span className="text-[8px] text-[var(--text-muted)] font-mono">OPC</span>
                                                            <input
                                                                type="range"
                                                                min={0}
                                                                max={100}
                                                                value={Math.round((gibsOpacity ?? 0.6) * 100)}
                                                                onChange={e => setGibsOpacity(parseInt(e.target.value) / 100)}
                                                                className="w-16 h-1 accent-cyan-500 cursor-pointer"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}

                                {/* POTUS Fleet — bottom section when inactive or hidden */}
                                {(potusFlights.length === 0 || !potusEnabled) && (
                                    <div className="border-t border-[var(--border-primary)]/50 pt-4 mt-2">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Shield size={14} className="text-[var(--text-muted)]" />
                                                <span className="text-[10px] text-[var(--text-muted)] font-mono tracking-widest">POTUS FLEET</span>
                                            </div>
                                            {!potusEnabled ? (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setPotusEnabled(true); }}
                                                    className="text-[8px] font-mono text-[var(--text-muted)] hover:text-[#ff1493] border border-[var(--border-primary)] hover:border-[#ff1493]/40 rounded px-1.5 py-0.5 transition-colors"
                                                >
                                                    SHOW
                                                </button>
                                            ) : (
                                                <span className="text-[8px] font-mono text-[var(--text-muted)]">NO ACTIVE AIRCRAFT</span>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    );
});

export default WorldviewLeftPanel;
