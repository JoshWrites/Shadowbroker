"use client";

import { API_BASE } from "@/lib/api";
import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import Map, { Source, Layer, MapRef, ViewState, Popup, Marker } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { computeNightPolygon } from "@/utils/solarTerminator";
import { interpolatePosition } from "@/utils/positioning";
import { darkStyle, lightStyle } from "@/components/map/styles/mapStyles";
import ScaleBar from "@/components/ScaleBar";
import maplibregl from "maplibre-gl";
// Enable RTL text rendering for Hebrew/Arabic city names on map symbol layers
maplibregl.setRTLTextPlugin(
    "https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js",
    true,
);
import { AlertTriangle, Radio, Globe, Activity, Play } from "lucide-react";
import WikiImage from "@/components/WikiImage";
import { useTheme } from "@/lib/ThemeContext";

import {
    svgPlaneCyan, svgPlaneYellow, svgPlaneOrange, svgPlanePurple,
    svgFighter, svgHeli, svgHeliCyan, svgHeliOrange, svgHeliPurple,
    svgTanker, svgRecon, svgPlanePink, svgPlaneAlertRed, svgPlaneDarkBlue,
    svgPlaneWhiteAlert, svgHeliPink, svgHeliAlertRed, svgHeliDarkBlue,
    svgHeliBlue, svgHeliLime, svgHeliWhiteAlert, svgPlaneBlack, svgHeliBlack,
    svgDrone, svgDataCenter, svgRadioTower, svgTrain, svgShipGray, svgShipRed, svgShipYellow,
    svgShipBlue, svgShipWhite, svgShipPink, svgCarrier, svgCctv, svgWarning, svgThreat,
    svgTriangleYellow, svgTriangleRed,
    svgFireYellow, svgFireOrange, svgFireRed, svgFireDarkRed,
    svgFireClusterSmall, svgFireClusterMed, svgFireClusterLarge, svgFireClusterXL,
    svgPotusPlane, svgPotusHeli, POTUS_ICAOS,
    svgAirlinerCyan, svgAirlinerOrange, svgAirlinerPurple, svgAirlinerYellow,
    svgAirlinerPink, svgAirlinerRed, svgAirlinerDarkBlue, svgAirlinerBlue,
    svgAirlinerLime, svgAirlinerBlack, svgAirlinerWhite,
    svgTurbopropCyan, svgTurbopropOrange, svgTurbopropPurple, svgTurbopropYellow,
    svgTurbopropPink, svgTurbopropRed, svgTurbopropDarkBlue, svgTurbopropBlue,
    svgTurbopropLime, svgTurbopropBlack, svgTurbopropWhite,
    svgBizjetCyan, svgBizjetOrange, svgBizjetPurple, svgBizjetYellow,
    svgBizjetPink, svgBizjetRed, svgBizjetDarkBlue, svgBizjetBlue,
    svgBizjetLime, svgBizjetBlack, svgBizjetWhite,
    svgAirlinerGrey, svgTurbopropGrey, svgBizjetGrey, svgHeliGrey,
    GROUNDED_ICON_MAP, COLOR_MAP_COMMERCIAL, COLOR_MAP_PRIVATE,
    COLOR_MAP_JETS, COLOR_MAP_MILITARY, MIL_SPECIAL_MAP,
} from "@/components/map/icons/AircraftIcons";
import { classifyAircraft } from "@/utils/aircraftClassification";
import { makeSatSvg, MISSION_COLORS, MISSION_ICON_MAP } from "@/components/map/icons/SatelliteIcons";
import { EMPTY_FC } from "@/components/map/mapConstants";

import { useImperativeSource } from "@/components/map/hooks/useImperativeSource";
import { ClusterCountLabels, TrackedFlightLabels, CarrierLabels, TrackedYachtLabels, UavLabels, EarthquakeLabels, ThreatMarkers } from "@/components/map/MapMarkers";
import type { MaplibreViewerProps } from "@/types/dashboard";
import { INTERP_TICK_MS, ALERT_BOX_WIDTH_PX, ALERT_MAX_OFFSET_PX } from "@/lib/constants";
import { useInterpolation } from "@/components/map/hooks/useInterpolation";
import { useClusterLabels } from "@/components/map/hooks/useClusterLabels";
import { spreadAlertItems } from "@/utils/alertSpread";
import WeatherModal from "@/components/WeatherModal";
import {
    buildEarthquakesGeoJSON, buildJammingGeoJSON, buildCctvGeoJSON, buildKiwisdrGeoJSON,
    buildFirmsGeoJSON, buildInternetOutagesGeoJSON, buildDataCentersGeoJSON, buildMilitaryBasesGeoJSON,
    buildGdeltGeoJSON, buildLiveuaGeoJSON, buildFrontlineGeoJSON,
    buildFlightLayerGeoJSON, buildUavGeoJSON,
    buildSatellitesGeoJSON, buildShipsGeoJSON, buildCarriersGeoJSON, buildTrainsGeoJSON,
    buildPowerPlantsGeoJSON, buildPskReporterGeoJSON, buildSatnogsStationsGeoJSON,
    buildTinygsGeoJSON, buildScannerGeoJSON, buildSigintGeoJSON,
    buildMeshtasticGeoJSON, buildAprsGeoJSON,
    buildWeatherAlertsGeoJSON, buildWeatherAlertLabelsGeoJSON,
    buildAirQualityGeoJSON, buildVolcanoesGeoJSON, buildFishingActivityGeoJSON,
    buildVIIRSChangeNodesGeoJSON, buildCorrelationsGeoJSON,
    buildWastewaterGeoJSON, buildCrowdThreatGeoJSON, buildUapSightingsGeoJSON,
    buildSarAnomaliesGeoJSON, buildSarAoisGeoJSON,
    BRANCH_COLORS,
    type FlightLayerConfig,
} from "@/components/map/geoJSONBuilders";
import type { MilBaseBranch } from "@/types/dashboard";

const MaplibreViewer = ({ data, activeLayers, onEntityClick, flyToLocation, selectedEntity, onMouseCoords, onRightClick, regionDossier, regionDossierLoading, onViewStateChange, measureMode, onMeasureClick, measurePoints, gibsDate, gibsOpacity, viewBoundsRef, setTrackedSdr, pikudTimeOffset, pikudHistoryData, ukraineTimeOffset, ukraineHistoryData, bgpTimeOffset, bgpHistoryData, cfTimeOffset, cfHistoryData, milBaseFilter, cctvLoading }: MaplibreViewerProps) => {
    const mapRef = useRef<MapRef>(null);
    const [mapReady, setMapReady] = useState(false);

    // RainViewer radar: fetch latest timestamp for tile URL
    const [radarTimestamp, setRadarTimestamp] = useState<string | null>(null);
    useEffect(() => {
        if (!activeLayers.weather_radar) { setRadarTimestamp(null); return; }
        let cancelled = false;
        const fetchTs = () => {
            fetch('https://api.rainviewer.com/public/weather-maps.json')
                .then(r => r.json())
                .then(d => {
                    if (cancelled) return;
                    const past = d?.radar?.past;
                    if (past?.length) setRadarTimestamp(past[past.length - 1].path);
                })
                .catch(() => {});
        };
        fetchTs();
        const iv = setInterval(fetchTs, 300000); // refresh every 5 min
        return () => { cancelled = true; clearInterval(iv); };
    }, [activeLayers.weather_radar]);
    const { theme } = useTheme();
    const mapThemeStyle = useMemo(() => theme === 'light' ? lightStyle : darkStyle, [theme]);

    const [viewState, setViewState] = useState<ViewState>({
        longitude: 0,
        latitude: 20,
        zoom: 2,
        bearing: 0,
        pitch: 0,
        padding: { top: 0, bottom: 0, left: 0, right: 0 }
    });

    // Viewport bounds for culling off-screen features [west, south, east, north]
    // Buffer extends bounds by ~20% so features near edges don't pop in/out
    const [mapBounds, setMapBounds] = useState<[number, number, number, number]>([-180, -90, 180, 90]);
    const boundsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const updateBounds = useCallback(() => {
        const map = mapRef.current?.getMap();
        if (!map) return;
        const b = map.getBounds();
        const latRange = b.getNorth() - b.getSouth();
        const lngRange = b.getEast() - b.getWest();
        const buf = 0.2; // 20% buffer
        setMapBounds([
            b.getWest() - lngRange * buf,
            b.getSouth() - latRange * buf,
            b.getEast() + lngRange * buf,
            b.getNorth() + latRange * buf
        ]);
        // Write raw (unpadded) bounds for server-side viewport filtering
        if (viewBoundsRef && 'current' in viewBoundsRef) {
            (viewBoundsRef as React.MutableRefObject<any>).current = {
                south: b.getSouth(),
                west: b.getWest(),
                north: b.getNorth(),
                east: b.getEast(),
            };
        }
        
        // Debounce POSTing viewport bounds to backend for dynamic AIS stream filtering
        if (boundsTimerRef.current) clearTimeout(boundsTimerRef.current);
        boundsTimerRef.current = setTimeout(() => {
            fetch(`${API_BASE}/api/viewport`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    s: b.getSouth(),
                    w: b.getWest(),
                    n: b.getNorth(),
                    e: b.getEast()
                })
            }).catch(e => console.error("Failed to update backend viewport:", e));
        }, 1500); // 1.5s debounce after map stops moving
    }, [viewBoundsRef]);

    // Fast bounds check — used by all GeoJSON builders and Marker loops
    const inView = useCallback((lat: number, lng: number) =>
        lng >= mapBounds[0] && lng <= mapBounds[2] && lat >= mapBounds[1] && lat <= mapBounds[3],
        [mapBounds]
    );

    const [dynamicRoute, setDynamicRoute] = useState<any>(null);
    const prevCallsign = useRef<string | null>(null);

    // Global Incidents popup: dismiss state
    // Keys use stable content hash (title+coords) to survive data.news array replacement on refresh
    // NOTE: Using Set (not Map) to avoid collision with the `Map` react-map-gl import
    const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());

    // --- Smooth interpolation via extracted hook ---
    const { interpTick, interpFlight, interpShip, interpSat, dtSeconds, dataTimestamp } = useInterpolation();

    // Track when flight/ship/satellite data actually changes (new fetch arrived)
    useEffect(() => {
        dataTimestamp.current = Date.now();
    }, [data?.commercial_flights, data?.ships, data?.satellites]);

    // --- Solar Terminator: recompute the night polygon every 60 seconds ---
    const [nightGeoJSON, setNightGeoJSON] = useState<GeoJSON.FeatureCollection>(() => computeNightPolygon());
    useEffect(() => {
        const timer = setInterval(() => setNightGeoJSON(computeNightPolygon()), 60000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        let isMounted = true;

        let callsign = null;
        let entityLat = 0;
        let entityLng = 0;
        if (selectedEntity && data) {
            let entity = null;
            if (selectedEntity.type === 'flight') entity = data?.commercial_flights?.find((f: any) => f.icao24 === selectedEntity.id);
            else if (selectedEntity.type === 'private_flight') entity = data?.private_flights?.find((f: any) => f.icao24 === selectedEntity.id);
            else if (selectedEntity.type === 'military_flight') entity = data?.military_flights?.find((f: any) => f.icao24 === selectedEntity.id);
            else if (selectedEntity.type === 'private_jet') entity = data?.private_jets?.find((f: any) => f.icao24 === selectedEntity.id);
            else if (selectedEntity.type === 'tracked_flight') entity = data?.tracked_flights?.find((f: any) => f.icao24 === selectedEntity.id);

            if (entity && entity.callsign) {
                callsign = entity.callsign;
                entityLat = entity.lat ?? 0;
                entityLng = entity.lng ?? 0;
            }
        }

        if (callsign && callsign !== prevCallsign.current) {
            prevCallsign.current = callsign;
            fetch(`${API_BASE}/api/route/${callsign}?lat=${entityLat}&lng=${entityLng}`)
                .then(res => res.json())
                .then(routeData => {
                    if (isMounted) setDynamicRoute(routeData);
                })
                .catch(() => {
                    if (isMounted) setDynamicRoute(null);
                });
        } else if (!callsign) {
            prevCallsign.current = null;
            if (isMounted) setDynamicRoute(null);
        }

        return () => { isMounted = false; };
    }, [selectedEntity, data]);

    useEffect(() => {
        if (flyToLocation && mapRef.current) {
            mapRef.current.flyTo({
                center: [flyToLocation.lng, flyToLocation.lat],
                zoom: 8,
                duration: 1500
            });
        }
    }, [flyToLocation]);

    const earthquakesGeoJSON = useMemo(() =>
        activeLayers.earthquakes ? buildEarthquakesGeoJSON(data?.earthquakes) : null,
        [activeLayers.earthquakes, data?.earthquakes]);

    const jammingGeoJSON = useMemo(() =>
        activeLayers.gps_jamming ? buildJammingGeoJSON(data?.gps_jamming) : null,
        [activeLayers.gps_jamming, data?.gps_jamming]);

    const cctvGeoJSON = useMemo(() =>
        activeLayers.cctv ? buildCctvGeoJSON(data?.cctv, inView) : null,
        [activeLayers.cctv, data?.cctv, inView]);

    const kiwisdrGeoJSON = useMemo(() =>
        activeLayers.kiwisdr ? buildKiwisdrGeoJSON(data?.kiwisdr, inView) : null,
        [activeLayers.kiwisdr, data?.kiwisdr, inView]);

    const trainsGeoJSON = useMemo(() =>
        activeLayers.trains ? buildTrainsGeoJSON(data?.trains, inView) : null,
        [activeLayers.trains, data?.trains, inView]);

    const firmsGeoJSON = useMemo(() =>
        activeLayers.firms ? buildFirmsGeoJSON(data?.firms_fires) : null,
        [activeLayers.firms, data?.firms_fires]);

    const internetOutagesGeoJSON = useMemo(() =>
        activeLayers.internet_outages ? buildInternetOutagesGeoJSON(data?.internet_outages) : null,
        [activeLayers.internet_outages, data?.internet_outages]);

    const dataCentersGeoJSON = useMemo(() =>
        activeLayers.datacenters ? buildDataCentersGeoJSON(data?.datacenters) : null,
        [activeLayers.datacenters, data?.datacenters]);

    // ── New upstream layers ──
    const powerPlantsGeoJSON = useMemo(() =>
        activeLayers.power_plants ? buildPowerPlantsGeoJSON(data?.power_plants) : null,
        [activeLayers.power_plants, data?.power_plants]);

    const pskReporterGeoJSON = useMemo(() =>
        activeLayers.psk_reporter ? buildPskReporterGeoJSON(data?.psk_reporter, inView) : null,
        [activeLayers.psk_reporter, data?.psk_reporter, inView]);

    const satnogsGeoJSON = useMemo(() =>
        activeLayers.satnogs ? buildSatnogsStationsGeoJSON(data?.satnogs_stations, inView) : null,
        [activeLayers.satnogs, data?.satnogs_stations, inView]);

    const tinygsGeoJSON = useMemo(() =>
        activeLayers.tinygs ? buildTinygsGeoJSON(data?.tinygs_satellites, inView) : null,
        [activeLayers.tinygs, data?.tinygs_satellites, inView]);

    const scannerGeoJSON = useMemo(() =>
        activeLayers.scanners ? buildScannerGeoJSON(data?.scanners, inView) : null,
        [activeLayers.scanners, data?.scanners, inView]);

    const meshtasticGeoJSON = useMemo(() =>
        activeLayers.sigint_meshtastic ? buildMeshtasticGeoJSON(data?.sigint) : null,
        [activeLayers.sigint_meshtastic, data?.sigint]);

    const aprsGeoJSON = useMemo(() =>
        activeLayers.sigint_aprs ? buildAprsGeoJSON(data?.sigint) : null,
        [activeLayers.sigint_aprs, data?.sigint]);

    const weatherAlertsGeoJSON = useMemo(() =>
        activeLayers.weather_alerts ? buildWeatherAlertsGeoJSON(data?.weather_alerts) : null,
        [activeLayers.weather_alerts, data?.weather_alerts]);

    const weatherAlertLabelsGeoJSON = useMemo(() =>
        activeLayers.weather_alerts ? buildWeatherAlertLabelsGeoJSON(data?.weather_alerts) : null,
        [activeLayers.weather_alerts, data?.weather_alerts]);

    const airQualityGeoJSON = useMemo(() =>
        activeLayers.air_quality ? buildAirQualityGeoJSON(data?.air_quality) : null,
        [activeLayers.air_quality, data?.air_quality]);

    const volcanoesGeoJSON = useMemo(() =>
        activeLayers.volcanoes ? buildVolcanoesGeoJSON(data?.volcanoes) : null,
        [activeLayers.volcanoes, data?.volcanoes]);

    const fishingGeoJSON = useMemo(() =>
        activeLayers.fishing_activity ? buildFishingActivityGeoJSON(data?.fishing_activity) : null,
        [activeLayers.fishing_activity, data?.fishing_activity]);

    const viirsChangeNodesGeoJSON = useMemo(() =>
        activeLayers.viirs_nightlights ? buildVIIRSChangeNodesGeoJSON(data?.viirs_change_nodes) : null,
        [activeLayers.viirs_nightlights, data?.viirs_change_nodes]);

    const correlationsGeoJSON = useMemo(() =>
        activeLayers.correlations ? buildCorrelationsGeoJSON(data?.correlations) : null,
        [activeLayers.correlations, data?.correlations]);

    // Upstream-added OSINT layers
    const wastewaterGeoJSON = useMemo(() =>
        activeLayers.wastewater ? buildWastewaterGeoJSON(data?.wastewater) : null,
        [activeLayers.wastewater, data?.wastewater]);
    const crowdthreatGeoJSON = useMemo(() =>
        activeLayers.crowdthreat ? buildCrowdThreatGeoJSON(data?.crowdthreat) : null,
        [activeLayers.crowdthreat, data?.crowdthreat]);
    const uapSightingsGeoJSON = useMemo(() =>
        activeLayers.uap_sightings ? buildUapSightingsGeoJSON(data?.uap_sightings) : null,
        [activeLayers.uap_sightings, data?.uap_sightings]);
    const sarAnomaliesGeoJSON = useMemo(() =>
        activeLayers.sar ? buildSarAnomaliesGeoJSON(data?.sar_anomalies) : null,
        [activeLayers.sar, data?.sar_anomalies]);
    const sarAoisGeoJSON = useMemo(() =>
        activeLayers.sar ? buildSarAoisGeoJSON(data?.sar_aois) : null,
        [activeLayers.sar, data?.sar_aois]);

    // --- Military base polygon LOD: show outlines when base ≥ 50px on screen ---
    const PX_THRESHOLD = 50;
    const milBasePolygonsRef = useRef<Record<number, any>>({}); // idx -> geometry
    const milBasePendingRef = useRef<Record<number, boolean>>({});
    const [milBasePolyVersion, setMilBasePolyVersion] = useState(0); // trigger re-render
    const [dossierModal, setDossierModal] = useState<'sentinel' | 'weather' | null>(null);
    // Reset modal choice when entity changes
    useEffect(() => { if (selectedEntity?.type !== 'region_dossier') setDossierModal(null); }, [selectedEntity]);

    // Compute which bases have active polygon rendering (used to hide their points)
    const milBasePolyActiveRef = useRef<Record<number, boolean>>({});

    // Compute polygon GeoJSON first so we know which indices are polygon-rendered
    const milBasePolygonGeoJSON = useMemo(() => {
        const active: Record<number, boolean> = {};
        if (!activeLayers.military_bases || !data?.military_bases?.length) {
            milBasePolyActiveRef.current = active;
            return null;
        }
        const map = mapRef.current?.getMap();
        if (!map) { milBasePolyActiveRef.current = active; return null; }
        const zoom = viewState.zoom;
        const mPerPx = 40075016.686 / (512 * Math.pow(2, zoom));

        const needIds: number[] = [];
        const features: any[] = [];
        const polys = milBasePolygonsRef.current;

        for (let i = 0; i < data.military_bases.length; i++) {
            const base = data.military_bases[i];
            if (milBaseFilter && Object.keys(milBaseFilter).length > 0) {
                const owner = base.owner || base.country || '';
                const ownerSet = milBaseFilter[owner];
                if (!ownerSet || !ownerSet.has(base.branch as MilBaseBranch)) continue;
            }
            const diam = base.diameter_m || 0;
            const screenPx = diam / mPerPx;

            if (screenPx >= PX_THRESHOLD) {
                if (!inView(base.lat, base.lng)) {
                    delete polys[i];
                    continue;
                }
                if (polys[i]) {
                    active[i] = true;
                    const color = BRANCH_COLORS[base.branch] || '#9ca3af';
                    features.push({
                        type: 'Feature',
                        geometry: polys[i],
                        properties: {
                            id: `milbase-${i}`,
                            type: 'military_base',
                            name: base.name || 'Unknown',
                            branch: base.branch,
                            color,
                        },
                    });
                } else {
                    needIds.push(i);
                }
            } else {
                delete polys[i];
            }
        }

        // Fetch missing polygons
        if (needIds.length > 0) {
            const pending = milBasePendingRef.current;
            const toFetch = needIds.filter(id => !pending[id]);
            if (toFetch.length > 0) {
                toFetch.forEach(id => { pending[id] = true; });
                fetch(`${API_BASE}/api/military-bases/geometries`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: toFetch }),
                })
                    .then(r => r.json())
                    .then(d => {
                        const geoms = d.geometries || {};
                        for (const [idStr, geom] of Object.entries(geoms)) {
                            const id = parseInt(idStr);
                            milBasePolygonsRef.current[id] = geom;
                            delete milBasePendingRef.current[id];
                        }
                        setMilBasePolyVersion(v => v + 1);
                    })
                    .catch(() => {
                        toFetch.forEach(id => { delete pending[id]; });
                    });
            }
        }

        milBasePolyActiveRef.current = active;
        if (!features.length) return null;
        return { type: 'FeatureCollection', features };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeLayers.military_bases, data?.military_bases, milBaseFilter, viewState.zoom, mapBounds, milBasePolyVersion]);

    // Build point GeoJSON, excluding bases that have active polygon rendering
    const militaryBasesGeoJSON = useMemo(() =>
        activeLayers.military_bases
            ? buildMilitaryBasesGeoJSON(data?.military_bases, milBaseFilter, milBasePolyActiveRef.current)
            : null,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [activeLayers.military_bases, data?.military_bases, milBaseFilter, milBasePolygonGeoJSON]);

    // Pikud HaOref: age buckets match Israeli shelter doctrine (10 min shelter window).
    // In live mode: age is relative to now.
    // In scrub mode: age is relative to the scrub position, so alerts at the leading
    //   edge of the window show red, older ones in the same slice fade to orange/amber.
    //   >30 min before scrub position are dropped (same rule as live).
    //   0–10 min → "hot"    #ef4444 red    — shelter-in-place window
    //   10–20 min→ "recent" #f97316 orange — recently cleared
    //   20–30 min→ "old"    #eab308 amber  — fading
    //   >30 min  → dropped
    const pikudAlertsGeoJSON = useMemo(() => {
        if (!activeLayers.pikud_alerts) return null;
        const isLive = pikudTimeOffset === null || pikudTimeOffset === undefined || pikudTimeOffset === 0;
        const alerts = isLive ? (data?.pikud_alerts ?? []) : (pikudHistoryData ?? []);
        if (!alerts.length) return null;
        // Reference point: now for live, scrub position for history
        const refSec = isLive
            ? Date.now() / 1000
            : Date.now() / 1000 + (pikudTimeOffset ?? 0) * 60;
        const features = alerts.flatMap((a: any, i: number) => {
            const ageMins = (refSec - (a.ts ?? 0)) / 60;
            // In history mode the fetch window already bounds to 30 min — don't re-filter.
            // In live mode drop anything older than 30 min or in the future.
            if (isLive && ageMins > 30) return [];
            if (ageMins < 0) return [];
            const ageClass = ageMins < 10 ? "hot"
                : ageMins < 20 ? "recent"
                : "old";
            return [{
                type: "Feature" as const,
                geometry: { type: "Point" as const, coordinates: [a.lng, a.lat] },
                properties: {
                    id: `pikud-${i}`,
                    type: "pikud_alert",
                    city: a.city,
                    category: a.cat_label ?? a.category ?? a.cat,
                    cat: a.cat,
                    color: a.color,
                    threat: a.threat,
                    is_drill: a.is_drill,
                    timestamp: a.timestamp,
                    ts: a.ts,
                    age_class: ageClass,
                },
            }];
        });
        if (!features.length) return null;
        return { type: "FeatureCollection" as const, features };
    }, [activeLayers.pikud_alerts, data?.pikud_alerts, pikudTimeOffset, pikudHistoryData]);

    // Ukraine oblast alerts — color-coded by alert type
    const ukraineAlertsGeoJSON = useMemo(() => {
        if (!activeLayers.ukraine_alerts) return null;
        const isLive = ukraineTimeOffset === null || ukraineTimeOffset === undefined || ukraineTimeOffset === 0;
        const alerts = isLive ? (data?.ukraine_alerts ?? []) : (ukraineHistoryData ?? []);
        if (!alerts.length) return null;
        const refSec = isLive
            ? Date.now() / 1000
            : Date.now() / 1000 + (ukraineTimeOffset ?? 0) * 60;
        const features = alerts.flatMap((a: any, i: number) => {
            const ageMins = (refSec - (a.ts ?? 0)) / 60;
            if (isLive && ageMins > 60) return [];
            if (ageMins < 0) return [];
            return [{
                type: "Feature" as const,
                geometry: { type: "Point" as const, coordinates: [a.lng, a.lat] },
                properties: {
                    id: `ukraine-${i}`,
                    type: "ukraine_alert",
                    region: a.region,
                    alert_type: a.type,
                    type_label: a.type_label,
                    color: a.color ?? "#ff2222",
                    timestamp: a.timestamp,
                    ts: a.ts,
                    active: a.active ?? false,
                },
            }];
        });
        if (!features.length) return null;
        return { type: "FeatureCollection" as const, features };
    }, [activeLayers.ukraine_alerts, data?.ukraine_alerts, ukraineTimeOffset, ukraineHistoryData]);

    // BGP anomaly arcs — great circle lines from hijacker to victim country centroid
    const bgpAnomaliesGeoJSON = useMemo(() => {
        if (!activeLayers.bgp_anomalies) return null;
        const isLive = bgpTimeOffset === null || bgpTimeOffset === undefined || bgpTimeOffset === 0;
        const events = isLive ? (data?.bgp_anomalies ?? []) : (bgpHistoryData ?? []);
        if (!events.length) return null;
        const refSec = isLive ? Date.now() / 1000 : Date.now() / 1000 + (bgpTimeOffset ?? 0) * 60;
        const features = events.flatMap((ev: any) => {
            const ageMins = (refSec - (ev.ts ?? 0)) / 60;
            if (isLive && ageMins > 4320) return []; // 3 days in live
            if (ageMins < 0) return [];
            return [{
                type: "Feature" as const,
                geometry: {
                    type: "LineString" as const,
                    coordinates: [[ev.hijacker_lng, ev.hijacker_lat], [ev.victim_lng, ev.victim_lat]],
                },
                properties: {
                    id: ev.id,
                    type: "bgp_anomaly",
                    bgp_type: ev.type,
                    hijacker_country: ev.hijacker_country,
                    hijacker_org: ev.hijacker_org,
                    hijacker_asn: ev.hijacker_asn,
                    victim_country: ev.victim_country,
                    victim_org: ev.victim_org,
                    victim_asn: ev.victim_asn,
                    affected_prefixes: ev.affected_prefixes,
                    confidence_score: ev.confidence_score,
                    peer_count: ev.peer_count,
                    timestamp: ev.timestamp,
                    ts: ev.ts,
                    color: ev.type === "hijack" ? "#ff4444" : "#ff9900",
                },
            }];
        });
        if (!features.length) return null;
        return { type: "FeatureCollection" as const, features };
    }, [activeLayers.bgp_anomalies, data?.bgp_anomalies, bgpTimeOffset, bgpHistoryData]);

    // CF traffic anomaly points
    const cfAnomaliesGeoJSON = useMemo(() => {
        if (!activeLayers.cf_anomalies) return null;
        const isLive = cfTimeOffset === null || cfTimeOffset === undefined || cfTimeOffset === 0;
        const events = isLive ? (data?.cf_anomalies ?? []) : (cfHistoryData ?? []);
        if (!events.length) return null;
        const refSec = isLive ? Date.now() / 1000 : Date.now() / 1000 + (cfTimeOffset ?? 0) * 60;
        const features = events.flatMap((ev: any) => {
            const ageMins = (refSec - (ev.ts ?? 0)) / 60;
            if (isLive && ageMins > 10080) return []; // 7 days
            if (ageMins < 0) return [];
            return [{
                type: "Feature" as const,
                geometry: { type: "Point" as const, coordinates: [ev.lng, ev.lat] },
                properties: {
                    id: ev.id,
                    type: "cf_anomaly",
                    location: ev.location,
                    location_name: ev.location_name,
                    status: ev.status,
                    description: ev.description,
                    timestamp: ev.timestamp,
                    ts: ev.ts,
                },
            }];
        });
        if (!features.length) return null;
        return { type: "FeatureCollection" as const, features };
    }, [activeLayers.cf_anomalies, data?.cf_anomalies, cfTimeOffset, cfHistoryData]);

    // Active DDoS lines — L7 top attack pairs (straight lines with directional pulse)
    const PULSE_STEPS = 48;
    const ddosArcsRef = useRef<{ coords: [number, number][]; props: Record<string, any> }[]>([]);
    const activeDdosGeoJSON = useMemo(() => {
        if (!activeLayers.active_ddos) { ddosArcsRef.current = []; return null; }
        const attacks = data?.active_ddos ?? [];
        if (!attacks.length) { ddosArcsRef.current = []; return null; }
        const arcsForPulse: { coords: [number, number][]; props: Record<string, any> }[] = [];
        const features = attacks.map((a: any) => {
            const from: [number, number] = [a.origin_lng, a.origin_lat];
            const to: [number, number] = [a.target_lng, a.target_lat];
            // Interpolate N points along the straight line for the pulse segment
            const coords: [number, number][] = [];
            for (let i = 0; i <= PULSE_STEPS; i++) {
                const t = i / PULSE_STEPS;
                coords.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
            }
            const props = {
                id: a.id,
                type: "active_ddos",
                origin_country: a.origin_country,
                origin_country_name: a.origin_country_name,
                target_country: a.target_country,
                target_country_name: a.target_country_name,
                requests_percent: a.requests_percent,
                layer: a.layer,
            };
            arcsForPulse.push({ coords, props });
            return {
                type: "Feature" as const,
                geometry: { type: "LineString" as const, coordinates: [from, to] },
                properties: props,
            };
        });
        ddosArcsRef.current = arcsForPulse;
        return { type: "FeatureCollection" as const, features };
    }, [activeLayers.active_ddos, data?.active_ddos]);

    // DDoS directional pulse — a short bright segment sliding source→target along each line
    const PULSE_LEN = 6; // segment length in interpolation steps
    const ddosPulseAnimRef = useRef<number>(0);
    const ddosPulsePhaseRef = useRef<number>(0);

    useEffect(() => {
        if (!activeDdosGeoJSON || !ddosArcsRef.current.length) {
            if (ddosPulseAnimRef.current) cancelAnimationFrame(ddosPulseAnimRef.current);
            return;
        }

        let lastTime = 0;
        const speed = 0.03; // phase increment per ms (~2.2 sec full cycle)

        const tick = (time: number) => {
            const dt = lastTime ? time - lastTime : 16;
            lastTime = time;
            ddosPulsePhaseRef.current = (ddosPulsePhaseRef.current + speed * dt / 16) % (PULSE_STEPS + PULSE_LEN);

            const phase = ddosPulsePhaseRef.current;
            const features = ddosArcsRef.current.map((arc) => {
                const start = Math.max(0, Math.floor(phase - PULSE_LEN));
                const end = Math.min(arc.coords.length - 1, Math.floor(phase));
                if (end <= start) return null;
                return {
                    type: "Feature" as const,
                    geometry: {
                        type: "LineString" as const,
                        coordinates: arc.coords.slice(start, end + 1),
                    },
                    properties: arc.props,
                };
            }).filter(Boolean);

            const fc = { type: "FeatureCollection" as const, features };

            const map = mapRef.current?.getMap();
            const src = map?.getSource("active-ddos-pulse") as any;
            if (src?.setData) {
                src.setData(fc);
            }

            ddosPulseAnimRef.current = requestAnimationFrame(tick);
        };

        ddosPulseAnimRef.current = requestAnimationFrame(tick);
        return () => { if (ddosPulseAnimRef.current) cancelAnimationFrame(ddosPulseAnimRef.current); };
    }, [activeDdosGeoJSON]);

    // Load Images into the Map Style once loaded
    const onMapLoad = useCallback((e: any) => {
        const map = e.target;

        // Track which images are still loading so we can retry on styleimagemissing
        const pendingImages: Record<string, string> = {};

        const loadImg = (id: string, url: string) => {
            if (map.hasImage(id)) return;
            // data: URLs are synchronously decodable — use decode() to guarantee
            // the image is ready before MapLibre's layer tries to render it.
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = url;
            if (url.startsWith('data:')) {
                // Inline SVG/data URLs: decode synchronously then add immediately
                img.decode().then(() => {
                    if (!map.hasImage(id)) map.addImage(id, img);
                }).catch(() => {});
            } else {
                pendingImages[id] = url;
                img.onload = () => {
                    if (!map.hasImage(id)) map.addImage(id, img);
                    delete pendingImages[id];
                };
            }
        };

        // Retry handler for external-URL images still loading when a layer fires
        map.on('styleimagemissing', (ev: any) => {
            const id = ev.id;
            const url = pendingImages[id];
            if (url) {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.src = url;
                img.onload = () => {
                    if (!map.hasImage(id)) map.addImage(id, img);
                    delete pendingImages[id];
                };
            }
        });

        // Critical icons — needed immediately for default-on layers
        loadImg('svgPlaneCyan', svgPlaneCyan);
        loadImg('svgPlaneYellow', svgPlaneYellow);
        loadImg('svgPlaneOrange', svgPlaneOrange);
        loadImg('svgPlanePurple', svgPlanePurple);
        loadImg('svgHeli', svgHeli);
        loadImg('svgHeliCyan', svgHeliCyan);
        loadImg('svgHeliOrange', svgHeliOrange);
        loadImg('svgHeliPurple', svgHeliPurple);
        loadImg('svgHeliBlue', svgHeliBlue);
        loadImg('svgHeliLime', svgHeliLime);
        loadImg('svgFighter', svgFighter);
        loadImg('svgTanker', svgTanker);
        loadImg('svgRecon', svgRecon);
        loadImg('svgAirlinerCyan', svgAirlinerCyan);
        loadImg('svgAirlinerOrange', svgAirlinerOrange);
        loadImg('svgAirlinerPurple', svgAirlinerPurple);
        loadImg('svgAirlinerYellow', svgAirlinerYellow);
        loadImg('svgTurbopropCyan', svgTurbopropCyan);
        loadImg('svgTurbopropOrange', svgTurbopropOrange);
        loadImg('svgTurbopropPurple', svgTurbopropPurple);
        loadImg('svgTurbopropYellow', svgTurbopropYellow);
        loadImg('svgBizjetCyan', svgBizjetCyan);
        loadImg('svgBizjetOrange', svgBizjetOrange);
        loadImg('svgBizjetPurple', svgBizjetPurple);
        loadImg('svgBizjetYellow', svgBizjetYellow);
        loadImg('svgAirlinerGrey', svgAirlinerGrey);
        loadImg('svgTurbopropGrey', svgTurbopropGrey);
        loadImg('svgBizjetGrey', svgBizjetGrey);
        loadImg('svgHeliGrey', svgHeliGrey);
        loadImg('svgShipGray', svgShipGray);
        loadImg('svgShipRed', svgShipRed);
        loadImg('svgShipYellow', svgShipYellow);
        loadImg('svgShipBlue', svgShipBlue);
        loadImg('svgShipWhite', svgShipWhite);
        loadImg('svgShipPink', svgShipPink);
        loadImg('svgCarrier', svgCarrier);
        loadImg('svgWarning', svgWarning);
        loadImg('icon-threat', svgThreat);

        // Deferred icons — for off-by-default layers and rare variants
        // Loaded in next frame to avoid blocking initial map render
        setTimeout(() => {
            loadImg('svgRadioTower', svgRadioTower);
            loadImg('svgPlanePink', svgPlanePink);
            loadImg('svgPlaneAlertRed', svgPlaneAlertRed);
            loadImg('svgPlaneDarkBlue', svgPlaneDarkBlue);
            loadImg('svgPlaneWhiteAlert', svgPlaneWhiteAlert);
            loadImg('svgPlaneBlack', svgPlaneBlack);
            loadImg('svgHeliPink', svgHeliPink);
            loadImg('svgHeliAlertRed', svgHeliAlertRed);
            loadImg('svgHeliDarkBlue', svgHeliDarkBlue);
            loadImg('svgHeliWhiteAlert', svgHeliWhiteAlert);
            loadImg('svgHeliBlack', svgHeliBlack);
            loadImg('svgPotusPlane', svgPotusPlane);
            loadImg('svgPotusHeli', svgPotusHeli);
            loadImg('svgAirlinerPink', svgAirlinerPink);
            loadImg('svgAirlinerRed', svgAirlinerRed);
            loadImg('svgAirlinerDarkBlue', svgAirlinerDarkBlue);
            loadImg('svgAirlinerBlue', svgAirlinerBlue);
            loadImg('svgAirlinerLime', svgAirlinerLime);
            loadImg('svgAirlinerBlack', svgAirlinerBlack);
            loadImg('svgAirlinerWhite', svgAirlinerWhite);
            loadImg('svgTurbopropPink', svgTurbopropPink);
            loadImg('svgTurbopropRed', svgTurbopropRed);
            loadImg('svgTurbopropDarkBlue', svgTurbopropDarkBlue);
            loadImg('svgTurbopropBlue', svgTurbopropBlue);
            loadImg('svgTurbopropLime', svgTurbopropLime);
            loadImg('svgTurbopropBlack', svgTurbopropBlack);
            loadImg('svgTurbopropWhite', svgTurbopropWhite);
            loadImg('svgBizjetPink', svgBizjetPink);
            loadImg('svgBizjetRed', svgBizjetRed);
            loadImg('svgBizjetDarkBlue', svgBizjetDarkBlue);
            loadImg('svgBizjetBlue', svgBizjetBlue);
            loadImg('svgBizjetLime', svgBizjetLime);
            loadImg('svgBizjetBlack', svgBizjetBlack);
            loadImg('svgBizjetWhite', svgBizjetWhite);
            loadImg('svgDrone', svgDrone);
            loadImg('svgCctv', svgCctv);
            loadImg('svgTrain', svgTrain);
            loadImg('icon-liveua-yellow', svgTriangleYellow);
            loadImg('icon-liveua-red', svgTriangleRed);
            // FIRMS fire icons
            loadImg('fire-yellow', svgFireYellow);
            loadImg('fire-orange', svgFireOrange);
            loadImg('fire-red', svgFireRed);
            loadImg('fire-darkred', svgFireDarkRed);
            loadImg('fire-cluster-sm', svgFireClusterSmall);
            loadImg('fire-cluster-md', svgFireClusterMed);
            loadImg('fire-cluster-lg', svgFireClusterLarge);
            loadImg('fire-cluster-xl', svgFireClusterXL);
            // Data center icon
            loadImg('datacenter', svgDataCenter);
            // Satellite mission-type icons
            loadImg('sat-mil', makeSatSvg('#ff3333'));
            loadImg('sat-sar', makeSatSvg('#00e5ff'));
            loadImg('sat-sigint', makeSatSvg('#ffffff'));
            loadImg('sat-nav', makeSatSvg('#4488ff'));
            loadImg('sat-ew', makeSatSvg('#ff00ff'));
            loadImg('sat-com', makeSatSvg('#44ff44'));
            loadImg('sat-station', makeSatSvg('#ffdd00'));
            loadImg('sat-gen', makeSatSvg('#aaaaaa'));
        }, 0);

        setMapReady(true);
    }, []);

    // WebGL context loss recovery — browser/GPU drops context on sleep/wake
    const contextLostRef = useRef(false);
    useEffect(() => {
        if (!mapReady) return;
        const canvas = mapRef.current?.getMap()?.getCanvas();
        if (!canvas) return;

        const handleLost = (e: Event) => {
            e.preventDefault();
            contextLostRef.current = true;
            console.warn('[MaplibreViewer] WebGL context lost');
        };
        const handleRestored = () => {
            contextLostRef.current = false;
            console.info('[MaplibreViewer] WebGL context restored');
            mapRef.current?.getMap()?.triggerRepaint();
        };

        // Fallback: on wake from sleep, if context wasn't restored, force reload
        const handleVisibility = () => {
            if (document.visibilityState !== 'visible') return;
            // Give the browser a moment to restore the context naturally
            setTimeout(() => {
                const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                if (contextLostRef.current || !gl || gl.isContextLost()) {
                    console.warn('[MaplibreViewer] Context still lost after wake — reloading page');
                    window.location.reload();
                } else {
                    // Context survived but tiles may be stale — force repaint
                    mapRef.current?.getMap()?.triggerRepaint();
                }
            }, 1000);
        };

        canvas.addEventListener('webglcontextlost', handleLost);
        canvas.addEventListener('webglcontextrestored', handleRestored);
        document.addEventListener('visibilitychange', handleVisibility);
        return () => {
            canvas.removeEventListener('webglcontextlost', handleLost);
            canvas.removeEventListener('webglcontextrestored', handleRestored);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [mapReady]);

    // Build a set of tracked icao24s to exclude from other flight layers
    const trackedIcaoSet = useMemo(() => {
        const s = new Set<string>();
        if (data?.tracked_flights) {
            for (const t of data.tracked_flights) {
                if (t.icao24) s.add(t.icao24.toLowerCase());
            }
        }
        return s;
    }, [data?.tracked_flights]);


    // Satellite GeoJSON with interpolated positions
    const satellitesGeoJSON = useMemo(() =>
        activeLayers.satellites ? buildSatellitesGeoJSON(data?.satellites, inView, interpSat) : null,
        [activeLayers.satellites, data?.satellites, dtSeconds, inView]);

    // Flight layer configs — shared across 4 near-identical builders
    const flightHelpers = useMemo(() => ({ interpFlight, inView, trackedIcaoSet }), [interpFlight, inView, trackedIcaoSet]);
    const commConfig: FlightLayerConfig = { colorMap: COLOR_MAP_COMMERCIAL, groundedMap: GROUNDED_ICON_MAP, typeLabel: 'flight', idPrefix: 'flight-', useTrackHeading: true };
    const privConfig: FlightLayerConfig = { colorMap: COLOR_MAP_PRIVATE, groundedMap: GROUNDED_ICON_MAP, typeLabel: 'private_flight', idPrefix: 'pflight-' };
    const jetsConfig: FlightLayerConfig = { colorMap: COLOR_MAP_JETS, groundedMap: GROUNDED_ICON_MAP, typeLabel: 'private_jet', idPrefix: 'pjet-' };
    const milConfig: FlightLayerConfig = { colorMap: COLOR_MAP_MILITARY, groundedMap: GROUNDED_ICON_MAP, typeLabel: 'military_flight', idPrefix: 'mflight-', milSpecialMap: MIL_SPECIAL_MAP };

    const commFlightsGeoJSON = useMemo(() =>
        activeLayers.flights ? buildFlightLayerGeoJSON(data?.commercial_flights, commConfig, flightHelpers) : null,
        [activeLayers.flights, data?.commercial_flights, flightHelpers]);

    const privFlightsGeoJSON = useMemo(() =>
        activeLayers.private ? buildFlightLayerGeoJSON(data?.private_flights, privConfig, flightHelpers) : null,
        [activeLayers.private, data?.private_flights, flightHelpers]);

    const privJetsGeoJSON = useMemo(() =>
        activeLayers.jets ? buildFlightLayerGeoJSON(data?.private_jets, jetsConfig, flightHelpers) : null,
        [activeLayers.jets, data?.private_jets, flightHelpers]);

    const milFlightsGeoJSON = useMemo(() =>
        activeLayers.military ? buildFlightLayerGeoJSON(data?.military_flights, milConfig, flightHelpers) : null,
        [activeLayers.military, data?.military_flights, flightHelpers]);

    const shipsGeoJSON = useMemo(() =>
        buildShipsGeoJSON(data?.ships, activeLayers, inView, interpShip),
        [activeLayers.ships_military, activeLayers.ships_cargo, activeLayers.ships_civilian, activeLayers.ships_passenger, activeLayers.ships_tracked_yachts, data?.ships, inView]);

    // Extract cluster label positions via shared hook
    const shipClusters = useClusterLabels(mapRef, 'ships', shipsGeoJSON);
    const eqClusters = useClusterLabels(mapRef, 'earthquakes', earthquakesGeoJSON);

    const carriersGeoJSON = useMemo(() =>
        activeLayers.ships_military ? buildCarriersGeoJSON(data?.ships) : null,
        [activeLayers.ships_military, data?.ships]);

    const activeRouteGeoJSON = useMemo(() => {
        if (!selectedEntity || !data) return null;

        // Polymorphic entity lookup — runtime guards ensure correct type access
        let entity: any = null;
        if (selectedEntity.type === 'flight') entity = data?.commercial_flights?.find((f) => f.icao24 === selectedEntity.id);
        else if (selectedEntity.type === 'private_flight') entity = data?.private_flights?.find((f) => f.icao24 === selectedEntity.id);
        else if (selectedEntity.type === 'military_flight') entity = data?.military_flights?.find((f) => f.icao24 === selectedEntity.id);
        else if (selectedEntity.type === 'private_jet') entity = data?.private_jets?.find((f) => f.icao24 === selectedEntity.id);
        else if (selectedEntity.type === 'tracked_flight') entity = data?.tracked_flights?.find((f) => f.icao24 === selectedEntity.id);
        else if (selectedEntity.type === 'ship') entity = data?.ships?.find((s) => s.mmsi === selectedEntity.id);

        if (!entity) return null;

        const currentLoc = [entity.lng, entity.lat];
        let originLoc = entity.origin_loc;
        let destLoc = entity.dest_loc;

        if (dynamicRoute && dynamicRoute.orig_loc && dynamicRoute.dest_loc) {
            originLoc = dynamicRoute.orig_loc;
            destLoc = dynamicRoute.dest_loc;
            // Also override display names so NewsFeed shows the resolved airport info
            if (dynamicRoute.origin_name) entity.origin_name = dynamicRoute.origin_name;
            if (dynamicRoute.dest_name) entity.dest_name = dynamicRoute.dest_name;
        }

        const features = [];
        // Extract IATA codes from "IATA: Airport Name" format
        const originCode = (entity.origin_name || '').split(':')[0]?.trim() || '';
        const destCode = (entity.dest_name || '').split(':')[0]?.trim() || '';

        if (originLoc) {
            features.push({
                type: 'Feature',
                properties: { type: 'route-origin' },
                geometry: { type: 'LineString', coordinates: [currentLoc, originLoc] }
            });
            // Airport dot at origin
            features.push({
                type: 'Feature',
                properties: { type: 'airport', code: originCode, role: 'DEP' },
                geometry: { type: 'Point', coordinates: originLoc }
            });
        }
        if (destLoc) {
            features.push({
                type: 'Feature',
                properties: { type: 'route-dest' },
                geometry: { type: 'LineString', coordinates: [currentLoc, destLoc] }
            });
            // Airport dot at destination
            features.push({
                type: 'Feature',
                properties: { type: 'airport', code: destCode, role: 'ARR' },
                geometry: { type: 'Point', coordinates: destLoc }
            });
        }

        if (features.length === 0) return null;
        return { type: 'FeatureCollection', features };
    }, [selectedEntity, data, dynamicRoute]);

    // Trail history GeoJSON: shows where the SELECTED aircraft has been (only for no-route flights)
    const trailGeoJSON = useMemo(() => {
        if (!selectedEntity || !data) return null;

        let entity: any = null;
        if (selectedEntity.type === 'flight') entity = data?.commercial_flights?.find((f) => f.icao24 === selectedEntity.id);
        else if (selectedEntity.type === 'private_flight') entity = data?.private_flights?.find((f) => f.icao24 === selectedEntity.id);
        else if (selectedEntity.type === 'military_flight') entity = data?.military_flights?.find((f) => f.icao24 === selectedEntity.id);
        else if (selectedEntity.type === 'private_jet') entity = data?.private_jets?.find((f) => f.icao24 === selectedEntity.id);
        else if (selectedEntity.type === 'tracked_flight') entity = data?.tracked_flights?.find((f) => f.icao24 === selectedEntity.id);

        if (!entity || !entity.trail || entity.trail.length < 2) return null;
        if (entity.origin_name && entity.origin_name !== 'UNKNOWN') return null;

        const coords = entity.trail.map((p: any) => [p[1] ?? p.lng, p[0] ?? p.lat]);
        if (entity.lat != null && entity.lng != null) {
            coords.push([entity.lng, entity.lat]);
        }

        return {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: { type: 'trail' },
                geometry: { type: 'LineString', coordinates: coords }
            }]
        };
    }, [selectedEntity, data]);

    const spreadAlerts = useMemo(() => {
        if (!data?.news) return [];
        return spreadAlertItems(data.news, viewState.zoom, dismissedAlerts);
    }, [data?.news, Math.round(viewState.zoom), dismissedAlerts]);

    // Tracked flights GeoJSON with interpolation
    const trackedFlightsGeoJSON = useMemo(() => {
        if (!activeLayers.tracked || !data?.tracked_flights) return null;

        // Tracked icon maps by aircraft shape and alert color
        const trackedIconMap: Record<string, Record<string, string>> = {
            heli: { '#ff1493': 'svgHeliPink', pink: 'svgHeliPink', red: 'svgHeliAlertRed', blue: 'svgHeliBlue', darkblue: 'svgHeliDarkBlue', yellow: 'svgHeli', orange: 'svgHeliOrange', purple: 'svgHeliPurple', '#32cd32': 'svgHeliLime', black: 'svgHeliBlack', white: 'svgHeliWhiteAlert' },
            airliner: { '#ff1493': 'svgAirlinerPink', pink: 'svgAirlinerPink', red: 'svgAirlinerRed', blue: 'svgAirlinerBlue', darkblue: 'svgAirlinerDarkBlue', yellow: 'svgAirlinerYellow', orange: 'svgAirlinerOrange', purple: 'svgAirlinerPurple', '#32cd32': 'svgAirlinerLime', black: 'svgAirlinerBlack', white: 'svgAirlinerWhite' },
            turboprop: { '#ff1493': 'svgTurbopropPink', pink: 'svgTurbopropPink', red: 'svgTurbopropRed', blue: 'svgTurbopropBlue', darkblue: 'svgTurbopropDarkBlue', yellow: 'svgTurbopropYellow', orange: 'svgTurbopropOrange', purple: 'svgTurbopropPurple', '#32cd32': 'svgTurbopropLime', black: 'svgTurbopropBlack', white: 'svgTurbopropWhite' },
            bizjet: { '#ff1493': 'svgBizjetPink', pink: 'svgBizjetPink', red: 'svgBizjetRed', blue: 'svgBizjetBlue', darkblue: 'svgBizjetDarkBlue', yellow: 'svgBizjetYellow', orange: 'svgBizjetOrange', purple: 'svgBizjetPurple', '#32cd32': 'svgBizjetLime', black: 'svgBizjetBlack', white: 'svgBizjetWhite' },
        };

        const features: any[] = [];
        for (let i = 0; i < data.tracked_flights.length; i++) {
            const f = data.tracked_flights[i];
            if (f.lat == null || f.lng == null) continue;

            const [lng, lat] = interpFlight(f);
            const alertColor = f.alert_color || 'white';
            const acType = classifyAircraft(f.model, f.aircraft_category);
            const grounded = f.alt != null && f.alt <= 100;
            const icaoHex = (f.icao24 || '').toUpperCase();
            const isPotus = POTUS_ICAOS.has(icaoHex);
            const potusIcon = acType === 'heli' ? 'svgPotusHeli' : 'svgPotusPlane';
            const iconId = isPotus ? potusIcon : grounded ? GROUNDED_ICON_MAP[acType] : (trackedIconMap[acType]?.[alertColor] || trackedIconMap.airliner[alertColor] || 'svgAirlinerWhite');
            const displayName = f.alert_operator || f.operator || f.owner || f.name || f.callsign || f.icao24 || "UNKNOWN";

            features.push({
                type: 'Feature',
                properties: { id: f.icao24 || i, type: 'tracked_flight', callsign: String(displayName), rotation: f.heading || 0, iconId },
                geometry: { type: 'Point', coordinates: [lng, lat] }
            });
        }
        return { type: 'FeatureCollection', features };
    }, [activeLayers.tracked, data?.tracked_flights, dtSeconds]);

    const uavGeoJSON = useMemo(() =>
        activeLayers.military ? buildUavGeoJSON(data?.uavs, inView) : null,
        [activeLayers.military, data?.uavs, inView]);

    // UAV range circles removed — real ADS-B drones don't have a fixed orbit center

    const gdeltGeoJSON = useMemo(() =>
        activeLayers.global_incidents ? buildGdeltGeoJSON(data?.gdelt, inView) : null,
        [activeLayers.global_incidents, data?.gdelt, inView]);

    const liveuaGeoJSON = useMemo(() =>
        activeLayers.global_incidents ? buildLiveuaGeoJSON(data?.liveuamap, inView) : null,
        [activeLayers.global_incidents, data?.liveuamap, inView]);

    const frontlineGeoJSON = useMemo(() =>
        activeLayers.ukraine_frontline ? buildFrontlineGeoJSON(data?.frontlines) : null,
        [activeLayers.ukraine_frontline, data?.frontlines]);



    // Interactive layer IDs for click handling
    const activeInteractiveLayerIds = [
        commFlightsGeoJSON && 'commercial-flights-layer',
        privFlightsGeoJSON && 'private-flights-layer',
        privJetsGeoJSON && 'private-jets-layer',
        milFlightsGeoJSON && 'military-flights-layer',
        shipsGeoJSON && 'ships-clusters-layer',
        shipsGeoJSON && 'ships-layer',
        carriersGeoJSON && 'carriers-layer',
        trackedFlightsGeoJSON && 'tracked-flights-layer',
        uavGeoJSON && 'uav-layer',
        gdeltGeoJSON && 'gdelt-layer',
        liveuaGeoJSON && 'liveuamap-layer',
        frontlineGeoJSON && 'ukraine-frontline-layer',
        earthquakesGeoJSON && 'earthquakes-layer',
        satellitesGeoJSON && 'satellites-layer',
        cctvGeoJSON && 'cctv-layer',
        kiwisdrGeoJSON && 'kiwisdr-clusters',
        kiwisdrGeoJSON && 'kiwisdr-layer',
        trainsGeoJSON && 'trains-layer',
        internetOutagesGeoJSON && 'internet-outages-layer',
        dataCentersGeoJSON && 'datacenters-layer',
        militaryBasesGeoJSON && 'military-bases-layer',
        milBasePolygonGeoJSON && 'military-bases-poly-fill',
        firmsGeoJSON && 'firms-viirs-layer',
        pikudAlertsGeoJSON && 'pikud-alerts-layer',
        ukraineAlertsGeoJSON && 'ukraine-alerts-layer',
        bgpAnomaliesGeoJSON && 'bgp-anomalies-layer',
        cfAnomaliesGeoJSON && 'cf-anomalies-layer',
        activeDdosGeoJSON && 'active-ddos-layer',
        activeDdosGeoJSON && 'active-ddos-pulse-layer',
        powerPlantsGeoJSON && 'power-plants-layer',
        pskReporterGeoJSON && 'psk-reporter-layer',
        satnogsGeoJSON && 'satnogs-layer',
        scannerGeoJSON && 'scanner-layer',
        airQualityGeoJSON && 'air-quality-layer',
        volcanoesGeoJSON && 'volcanoes-layer',
        fishingGeoJSON && 'fishing-layer',
        viirsChangeNodesGeoJSON && 'viirs-change-nodes-layer',
        wastewaterGeoJSON && 'wastewater-layer',
        crowdthreatGeoJSON && 'crowdthreat-layer',
        uapSightingsGeoJSON && 'uap-sightings-layer',
        sarAnomaliesGeoJSON && 'sar-anomalies-layer',
        sarAoisGeoJSON && 'sar-aois-fill',
    ].filter(Boolean) as string[];


    // --- Imperative source updates: bypass React reconciliation for GeoJSON layers ---
    const mapForHook = mapReady ? mapRef.current : null;
    useImperativeSource(mapForHook, 'commercial-flights', commFlightsGeoJSON);
    useImperativeSource(mapForHook, 'private-flights', privFlightsGeoJSON);
    useImperativeSource(mapForHook, 'private-jets', privJetsGeoJSON);
    useImperativeSource(mapForHook, 'military-flights', milFlightsGeoJSON);
    useImperativeSource(mapForHook, 'tracked-flights', trackedFlightsGeoJSON);
    useImperativeSource(mapForHook, 'uavs', uavGeoJSON);
    useImperativeSource(mapForHook, 'satellites', satellitesGeoJSON);
    useImperativeSource(mapForHook, 'firms-fires', firmsGeoJSON, 2000);
    // New upstream layers
    useImperativeSource(mapForHook, 'tinygs', tinygsGeoJSON);
    useImperativeSource(mapForHook, 'psk-reporter', pskReporterGeoJSON, 75);
    useImperativeSource(mapForHook, 'satnogs', satnogsGeoJSON, 75);
    useImperativeSource(mapForHook, 'scanners', scannerGeoJSON, 75);
    useImperativeSource(mapForHook, 'power-plants', powerPlantsGeoJSON, 140);
    useImperativeSource(mapForHook, 'viirs-change-nodes', viirsChangeNodesGeoJSON, 120);
    useImperativeSource(mapForHook, 'air-quality-source', airQualityGeoJSON, 100);
    useImperativeSource(mapForHook, 'volcanoes-source', volcanoesGeoJSON, 100);
    useImperativeSource(mapForHook, 'fishing-source', fishingGeoJSON, 100);
    useImperativeSource(mapForHook, 'meshtastic-source', meshtasticGeoJSON, 60);
    useImperativeSource(mapForHook, 'aprs-source', aprsGeoJSON, 60);
    // Upstream-added OSINT layers
    useImperativeSource(mapForHook, 'wastewater-source', wastewaterGeoJSON, 100);
    useImperativeSource(mapForHook, 'crowdthreat-source', crowdthreatGeoJSON, 100);
    useImperativeSource(mapForHook, 'uap-sightings-source', uapSightingsGeoJSON, 100);
    useImperativeSource(mapForHook, 'sar-anomalies-source', sarAnomaliesGeoJSON, 100);
    useImperativeSource(mapForHook, 'sar-aois-source', sarAoisGeoJSON, 100);

    const handleMouseMove = useCallback((evt: any) => {
        if (onMouseCoords) onMouseCoords({ lat: evt.lngLat.lat, lng: evt.lngLat.lng });
    }, [onMouseCoords]);

    const opacityFilter: any = selectedEntity
        ? ['case', ['all', ['==', ['get', 'type'], selectedEntity.type], ['==', ['get', 'id'], selectedEntity.id]], 1.0, 0.0]
        : 1.0;

    return (
        <div className={`relative h-full w-full z-0 isolate ${selectedEntity && ['region_dossier', 'gdelt', 'liveuamap', 'news'].includes(selectedEntity.type) ? 'map-focus-active' : ''}`}>
            <Map
                ref={mapRef}
                reuseMaps
                maxTileCacheSize={200}
                fadeDuration={0}
                initialViewState={viewState}
                onMove={evt => {
                    setViewState(evt.viewState);
                    onViewStateChange?.({ zoom: evt.viewState.zoom, latitude: evt.viewState.latitude });
                    // Debounce bounds update to avoid thrashing during drag
                    if (boundsTimerRef.current) clearTimeout(boundsTimerRef.current);
                    boundsTimerRef.current = setTimeout(updateBounds, 500);
                }}
                onMouseMove={handleMouseMove}
                onContextMenu={(evt) => {
                    evt.preventDefault();
                    onRightClick?.({ lat: evt.lngLat.lat, lng: evt.lngLat.lng });
                }}
                mapStyle={mapThemeStyle as any}
                mapLib={maplibregl}
                onLoad={onMapLoad}
                onIdle={updateBounds}
                interactiveLayerIds={activeInteractiveLayerIds}
                onClick={(e) => {
                    // Measurement mode: place waypoints instead of selecting entities
                    if (measureMode && onMeasureClick) {
                        onMeasureClick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
                        return;
                    }
                    if (selectedEntity) {
                        onEntityClick?.(null);
                    } else if (e.features && e.features.length > 0) {
                        const feature = e.features[0];
                        const props = feature.properties || {};

                        // If the clicked feature is a cluster, zoom into it instead of selecting an entity
                        if (props.cluster) {
                            mapRef.current?.flyTo({
                                center: [e.lngLat.lng, e.lngLat.lat],
                                zoom: viewState.zoom + 2,
                                duration: 500
                            });
                            return;
                        }
                        onEntityClick?.({
                            id: props.id,
                            type: props.type,
                            name: props.name,
                            media_url: props.media_url,
                            extra: { ...props, _clickLng: e.lngLat.lng, _clickLat: e.lngLat.lat }
                        });
                    } else {
                        onEntityClick?.(null);
                    }
                }}
            >
                {/* Esri World Imagery — high-res static satellite (zoom 0-18+) */}
                {activeLayers.highres_satellite && (
                    <Source
                        id="esri-world-imagery"
                        type="raster"
                        tiles={['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}']}
                        tileSize={256}
                        maxzoom={18}
                        attribution="Esri, Maxar, Earthstar Geographics"
                    >
                        <Layer
                            id="esri-world-imagery-layer"
                            type="raster"
                            beforeId="imagery-ceiling"
                            paint={{
                                'raster-opacity': 1,
                                'raster-fade-duration': 300
                            }}
                        />
                    </Source>
                )}
                {/* Esri Reference Overlay — borders, labels, cities on top of satellite imagery */}
                {activeLayers.highres_satellite && (
                    <Source
                        id="esri-reference-overlay"
                        type="raster"
                        tiles={['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}']}
                        tileSize={256}
                        maxzoom={18}
                    >
                        <Layer
                            id="esri-reference-overlay-layer"
                            type="raster"
                            paint={{
                                'raster-opacity': 0.9,
                                'raster-fade-duration': 300
                            }}
                        />
                    </Source>
                )}

                {/* NASA GIBS MODIS Terra — daily satellite imagery overlay */}
                {activeLayers.gibs_imagery && gibsDate && (
                    <Source
                        key={`gibs-${gibsDate}`}
                        id="gibs-modis"
                        type="raster"
                        tiles={[`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${gibsDate}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`]}
                        tileSize={256}
                        maxzoom={9}
                    >
                        <Layer
                            id="gibs-modis-layer"
                            type="raster"
                            beforeId="imagery-ceiling"
                            paint={{
                                'raster-opacity': gibsOpacity ?? 0.6,
                                'raster-fade-duration': 0
                            }}
                        />
                    </Source>
                )}

                {/* RainViewer Weather Radar — global precipitation radar */}
                {activeLayers.weather_radar && radarTimestamp && (
                    <Source
                        key={`rainviewer-${radarTimestamp}`}
                        id="rainviewer-radar"
                        type="raster"
                        tiles={[`https://tilecache.rainviewer.com${radarTimestamp}/256/{z}/{x}/{y}/6/1_1.png`]}
                        tileSize={256}
                    >
                        <Layer
                            id="rainviewer-radar-layer"
                            type="raster"
                            paint={{ 'raster-opacity': 0.7, 'raster-fade-duration': 0 }}
                        />
                    </Source>
                )}

                {/* OpenWeatherMap tile layers */}
                {activeLayers.weather_clouds && process.env.NEXT_PUBLIC_OWM_API_KEY && (
                    <Source
                        id="owm-clouds"
                        type="raster"
                        tiles={[`https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid=${process.env.NEXT_PUBLIC_OWM_API_KEY}`]}
                        tileSize={256}
                    >
                        <Layer id="owm-clouds-layer" type="raster" paint={{ 'raster-opacity': 0.6, 'raster-fade-duration': 0 }} />
                    </Source>
                )}
                {activeLayers.weather_precipitation && process.env.NEXT_PUBLIC_OWM_API_KEY && (
                    <Source
                        id="owm-precipitation"
                        type="raster"
                        tiles={[`https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${process.env.NEXT_PUBLIC_OWM_API_KEY}`]}
                        tileSize={256}
                    >
                        <Layer id="owm-precipitation-layer" type="raster" paint={{ 'raster-opacity': 0.7, 'raster-fade-duration': 0 }} />
                    </Source>
                )}
                {activeLayers.weather_pressure && process.env.NEXT_PUBLIC_OWM_API_KEY && (
                    <Source
                        id="owm-pressure"
                        type="raster"
                        tiles={[`https://tile.openweathermap.org/map/pressure_new/{z}/{x}/{y}.png?appid=${process.env.NEXT_PUBLIC_OWM_API_KEY}`]}
                        tileSize={256}
                    >
                        <Layer id="owm-pressure-layer" type="raster" paint={{ 'raster-opacity': 0.6, 'raster-fade-duration': 0 }} />
                    </Source>
                )}
                {activeLayers.weather_wind && process.env.NEXT_PUBLIC_OWM_API_KEY && (
                    <Source
                        id="owm-wind"
                        type="raster"
                        tiles={[`https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${process.env.NEXT_PUBLIC_OWM_API_KEY}`]}
                        tileSize={256}
                    >
                        <Layer id="owm-wind-layer" type="raster" paint={{ 'raster-opacity': 0.7, 'raster-fade-duration': 0 }} />
                    </Source>
                )}
                {activeLayers.weather_temperature && process.env.NEXT_PUBLIC_OWM_API_KEY && (
                    <Source
                        id="owm-temperature"
                        type="raster"
                        tiles={[`https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${process.env.NEXT_PUBLIC_OWM_API_KEY}`]}
                        tileSize={256}
                    >
                        <Layer id="owm-temperature-layer" type="raster" paint={{ 'raster-opacity': 0.6, 'raster-fade-duration': 0 }} />
                    </Source>
                )}

                {/* NASA FIRMS VIIRS — fire hotspot icons from FIRMS CSV feed */}
                {/* firms-fires: data pushed imperatively via useImperativeSource */}
                    <Source id="firms-fires" type="geojson" data={EMPTY_FC as any} cluster={true} clusterRadius={40} clusterMaxZoom={10}>
                        {/* Cluster fire icons — flame shape to differentiate from Global Incidents circles */}
                        <Layer
                            id="firms-clusters"
                            type="symbol"
                            filter={['has', 'point_count']}
                            layout={{
                                'icon-image': ['step', ['get', 'point_count'],
                                    'fire-cluster-sm', 10, 'fire-cluster-md', 50, 'fire-cluster-lg', 200, 'fire-cluster-xl'],
                                'icon-size': ['step', ['get', 'point_count'], 1.0, 10, 1.1, 50, 1.2, 200, 1.3],
                                'icon-allow-overlap': true,
                                'icon-ignore-placement': true,
                                'text-field': '{point_count_abbreviated}',
                                'text-font': ['Noto Sans Bold'],
                                'text-size': ['step', ['get', 'point_count'], 9, 10, 10, 50, 11, 200, 12],
                                'text-offset': [0, 0.15],
                                'text-allow-overlap': true,
                            }}
                            paint={{
                                'text-color': '#ffffff',
                                'text-halo-color': 'rgba(0,0,0,0.8)',
                                'text-halo-width': 1.2,
                            }}
                        />
                        {/* Individual fire icons — flame shape sized by FRP */}
                        <Layer
                            id="firms-viirs-layer"
                            type="symbol"
                            filter={['!', ['has', 'point_count']]}
                            layout={{
                                'icon-image': ['get', 'iconId'],
                                'icon-size': ['interpolate', ['linear'], ['zoom'],
                                    2, 0.4,
                                    5, 0.6,
                                    8, 0.8,
                                    12, 1.0
                                ],
                                'icon-allow-overlap': true,
                                'icon-ignore-placement': true,
                            }}
                        />
                    </Source>

                {/* SOLAR TERMINATOR — night overlay */}
                {activeLayers.day_night && nightGeoJSON && (
                    <Source id="night-overlay" type="geojson" data={nightGeoJSON as any}>
                        <Layer
                            id="night-overlay-layer"
                            type="fill"
                            paint={{
                                'fill-color': '#0a0e1a',
                                'fill-opacity': 0.35,
                            }}
                        />
                    </Source>
                )}

                {/* commercial/private/military flights: data pushed imperatively */}
                    <Source id="commercial-flights" type="geojson" data={EMPTY_FC as any}>
                        <Layer
                            id="commercial-flights-layer"
                            type="symbol"
                            layout={{
                                'icon-image': ['get', 'iconId'],
                                'icon-size': 0.8,
                                'icon-allow-overlap': true,
                                'icon-rotate': ['get', 'rotation'],
                                'icon-rotation-alignment': 'map'
                            }}
                            paint={{ 'icon-opacity': opacityFilter }}
                        />
                    </Source>

                    <Source id="private-flights" type="geojson" data={EMPTY_FC as any}>
                        <Layer
                            id="private-flights-layer"
                            type="symbol"
                            layout={{
                                'icon-image': ['get', 'iconId'],
                                'icon-size': 0.8,
                                'icon-allow-overlap': true,
                                'icon-rotate': ['get', 'rotation'],
                                'icon-rotation-alignment': 'map'
                            }}
                            paint={{ 'icon-opacity': opacityFilter }}
                        />
                    </Source>

                    <Source id="private-jets" type="geojson" data={EMPTY_FC as any}>
                        <Layer
                            id="private-jets-layer"
                            type="symbol"
                            layout={{
                                'icon-image': ['get', 'iconId'],
                                'icon-size': 0.8,
                                'icon-allow-overlap': true,
                                'icon-rotate': ['get', 'rotation'],
                                'icon-rotation-alignment': 'map'
                            }}
                            paint={{ 'icon-opacity': opacityFilter }}
                        />
                    </Source>

                    <Source id="military-flights" type="geojson" data={EMPTY_FC as any}>
                        <Layer
                            id="military-flights-layer"
                            type="symbol"
                            layout={{
                                'icon-image': ['get', 'iconId'],
                                'icon-size': 0.8,
                                'icon-allow-overlap': true,
                                'icon-rotate': ['get', 'rotation'],
                                'icon-rotation-alignment': 'map'
                            }}
                            paint={{ 'icon-opacity': opacityFilter }}
                        />
                    </Source>

                {shipsGeoJSON && (
                    <Source
                        id="ships"
                        type="geojson"
                        data={shipsGeoJSON as any}
                        cluster={true}
                        clusterMaxZoom={8}
                        clusterRadius={40}
                    >
                        {/* Clustered circles */}
                        <Layer
                            id="ships-clusters-layer"
                            type="circle"
                            filter={['has', 'point_count']}
                            paint={{
                                'circle-opacity': opacityFilter,
                                'circle-stroke-opacity': opacityFilter,
                                'circle-color': 'rgba(30, 64, 175, 0.85)',
                                'circle-radius': [
                                    'step',
                                    ['get', 'point_count'],
                                    12,
                                    10, 15,
                                    100, 20,
                                    1000, 25,
                                    5000, 30
                                ],
                                'circle-stroke-width': 2,
                                'circle-stroke-color': 'rgba(59, 130, 246, 1.0)'
                            }}
                        />

                        {/* Cluster count - rendered via HTML markers below */}
                        <Layer
                            id="ships-cluster-count-layer"
                            type="circle"
                            filter={['has', 'point_count']}
                            paint={{ 'circle-radius': 0, 'circle-opacity': 0 }}
                        />

                        {/* Unclustered individual ships (Cargo, Tankers, etc.) */}
                        <Layer
                            id="ships-layer"
                            type="symbol"
                            minzoom={4}
                            filter={['!', ['has', 'point_count']]}
                            layout={{
                                'icon-image': ['get', 'iconId'],
                                'icon-size': 0.8,
                                'icon-allow-overlap': true,
                                'icon-rotate': ['get', 'rotation'],
                                'icon-rotation-alignment': 'map'
                            }}
                            paint={{
                                'icon-opacity': opacityFilter
                            }}
                        />
                    </Source>
                )}

                {carriersGeoJSON && (
                    <Source id="carriers" type="geojson" data={carriersGeoJSON as any}>
                        <Layer
                            id="carriers-layer"
                            type="symbol"
                            layout={{
                                'icon-image': 'svgCarrier',
                                'icon-size': 0.8,
                                'icon-allow-overlap': true,
                                'icon-rotate': ['get', 'rotation'],
                                'icon-rotation-alignment': 'map'
                            }}
                            paint={{ 'icon-opacity': opacityFilter }}
                        />
                    </Source>
                )}


                {activeRouteGeoJSON && (
                    <Source id="active-route" type="geojson" data={activeRouteGeoJSON as any}>
                        <Layer
                            id="active-route-layer"
                            type="line"
                            filter={['in', ['get', 'type'], ['literal', ['route-origin', 'route-dest']]]}
                            paint={{
                                'line-color': [
                                    'match',
                                    ['get', 'type'],
                                    'route-origin', '#38bdf8',
                                    'route-dest', '#fcd34d',
                                    '#ffffff'
                                ],
                                'line-width': 2,
                                'line-dasharray': [2, 2],
                                'line-opacity': 0.8
                            }}
                        />
                        {/* Airport dots at origin/destination */}
                        <Layer
                            id="airport-dots"
                            type="circle"
                            filter={['==', ['get', 'type'], 'airport']}
                            paint={{
                                'circle-radius': 5,
                                'circle-color': ['match', ['get', 'role'], 'DEP', '#38bdf8', 'ARR', '#fcd34d', '#ffffff'],
                                'circle-stroke-color': '#000',
                                'circle-stroke-width': 1.5,
                                'circle-opacity': 0.9
                            }}
                        />
                        {/* IATA code labels at airports */}
                        <Layer
                            id="airport-labels"
                            type="symbol"
                            filter={['==', ['get', 'type'], 'airport']}
                            layout={{
                                'text-field': ['get', 'code'],
                                'text-font': ['Noto Sans Bold'],
                                'text-size': 11,
                                'text-offset': [0, -1.4],
                                'text-anchor': 'bottom',
                                'text-allow-overlap': true,
                            }}
                            paint={{
                                'text-color': ['match', ['get', 'role'], 'DEP', '#38bdf8', 'ARR', '#fcd34d', '#ffffff'],
                                'text-halo-color': '#000',
                                'text-halo-width': 1.5,
                            }}
                        />
                    </Source>
                )}

                {/* Flight trail history (where the aircraft has been) */}
                {trailGeoJSON && (
                    <Source id="flight-trail" type="geojson" data={trailGeoJSON as any}>
                        <Layer
                            id="flight-trail-layer"
                            type="line"
                            paint={{
                                'line-color': '#22d3ee',
                                'line-width': 2,
                                'line-opacity': 0.6,
                            }}
                        />
                    </Source>
                )}

                {/* tracked-flights & UAVs: data pushed imperatively */}
                    <Source id="tracked-flights" type="geojson" data={EMPTY_FC as any}>
                        {/* Gold halo ring — POTUS aircraft only (Air Force One/Two, Marine One) */}
                        <Layer
                            id="tracked-flights-halo"
                            type="circle"
                            filter={['any',
                                ['==', ['get', 'iconId'], 'svgPotusPlane'],
                                ['==', ['get', 'iconId'], 'svgPotusHeli'],
                            ]}
                            paint={{
                                'circle-radius': 18,
                                'circle-color': 'transparent',
                                'circle-stroke-width': 2,
                                'circle-stroke-color': 'gold',
                                'circle-stroke-opacity': opacityFilter,
                                'circle-opacity': 0,
                            }}
                        />
                        <Layer
                            id="tracked-flights-layer"
                            type="symbol"
                            layout={{
                                'icon-image': ['get', 'iconId'],
                                'icon-size': ['case',
                                    ['==', ['get', 'iconId'], 'svgPotusPlane'], 1.3,
                                    ['==', ['get', 'iconId'], 'svgPotusHeli'], 1.3,
                                    0.8
                                ],
                                'icon-allow-overlap': true,
                                'icon-rotate': ['get', 'rotation'],
                                'icon-rotation-alignment': 'map'
                            }}
                            paint={{ 'icon-opacity': opacityFilter }}
                        />
                    </Source>

                    <Source id="uavs" type="geojson" data={EMPTY_FC as any}>
                        <Layer
                            id="uav-layer"
                            type="symbol"
                            layout={{
                                'icon-image': ['get', 'iconId'],
                                'icon-size': 0.8,
                                'icon-allow-overlap': true,
                                'icon-rotate': ['get', 'rotation'],
                                'icon-rotation-alignment': 'map'
                            }}
                            paint={{ 'icon-opacity': opacityFilter }}
                        />
                    </Source>

                {/* UAV range circles removed — real ADS-B data has no fixed orbit */}

                {gdeltGeoJSON && (
                    <Source id="gdelt" type="geojson" data={gdeltGeoJSON as any}>
                        <Layer
                            id="gdelt-layer"
                            type="circle"
                            minzoom={4}
                            paint={{
                                'circle-radius': 5,
                                'circle-color': '#ff8c00',
                                'circle-stroke-color': '#ff0000',
                                'circle-stroke-width': 1,
                                'circle-opacity': 0.7
                            }}
                        />
                    </Source>
                )}

                {liveuaGeoJSON && (
                    <Source id="liveuamap" type="geojson" data={liveuaGeoJSON as any}>
                        <Layer
                            id="liveuamap-layer"
                            type="symbol"
                            minzoom={4}
                            layout={{
                                'icon-image': ['get', 'iconId'],
                                'icon-size': 0.8,
                                'icon-allow-overlap': true,
                            }}
                        />
                    </Source>
                )}

                {/* HTML labels for ship cluster counts (hidden when any entity popup is active) */}
                {shipsGeoJSON && !selectedEntity && <ClusterCountLabels clusters={shipClusters} prefix="sc" />}

                {/* HTML labels for tracked flights — color-matched, zoom-gated for non-HVA */}
                {trackedFlightsGeoJSON && !selectedEntity && data?.tracked_flights && (
                    <TrackedFlightLabels flights={data.tracked_flights} viewState={viewState} inView={inView} interpFlight={interpFlight} />
                )}

                {/* HTML labels for carriers (orange names, with ESTIMATED badge for OSINT positions) */}
                {carriersGeoJSON && !selectedEntity && data?.ships && (
                    <CarrierLabels ships={data.ships} inView={inView} interpShip={interpShip} />
                )}

                {/* HTML labels for tracked yachts (pink owner names) */}
                {shipsGeoJSON && activeLayers.ships_tracked_yachts && !selectedEntity && data?.ships && (
                    <TrackedYachtLabels ships={data.ships} inView={inView} interpShip={interpShip} />
                )}

                {/* HTML labels for earthquake cluster counts (hidden when any entity popup is active) */}
                {earthquakesGeoJSON && !selectedEntity && <ClusterCountLabels clusters={eqClusters} prefix="eqc" />}

                {/* HTML labels for UAVs (orange names) */}
                {uavGeoJSON && !selectedEntity && data?.uavs && (
                    <UavLabels uavs={data.uavs} inView={inView} />
                )}

                {/* HTML labels for earthquakes (yellow) - only show when zoomed in (~2000 miles = zoom ~5) */}
                {earthquakesGeoJSON && !selectedEntity && viewState.zoom >= 5 && data?.earthquakes && (
                    <EarthquakeLabels earthquakes={data.earthquakes} inView={inView} />
                )}

                {/* Maplibre HTML Custom Markers for high-importance Threat Overlays (highest z-index) */}
                {activeLayers.global_incidents && (
                    <ThreatMarkers spreadAlerts={spreadAlerts} viewState={viewState} selectedEntity={selectedEntity} onEntityClick={onEntityClick} onDismiss={(alertKey: string) => { setDismissedAlerts(prev => new Set(prev).add(alertKey)); if (selectedEntity?.type === 'news') onEntityClick?.(null); }} />
                )}

                {frontlineGeoJSON && (
                    <Source id="frontlines" type="geojson" data={frontlineGeoJSON as any}>
                        <Layer
                            id="ukraine-frontline-layer"
                            type="fill"
                            paint={{
                                'fill-color': '#ff0000',
                                'fill-opacity': 0.3,
                                'fill-outline-color': '#ff5500'
                            }}
                        />
                    </Source>
                )}

                {earthquakesGeoJSON && (
                    <Source
                        id="earthquakes"
                        type="geojson"
                        data={earthquakesGeoJSON as any}
                        cluster={true}
                        clusterMaxZoom={10}
                        clusterRadius={60}
                    >
                        {/* Earthquake cluster circles */}
                        <Layer
                            id="eq-clusters-layer"
                            type="circle"
                            filter={['has', 'point_count']}
                            paint={{
                                'circle-color': 'rgba(255, 170, 0, 0.85)',
                                'circle-radius': [
                                    'step',
                                    ['get', 'point_count'],
                                    12,
                                    5, 16,
                                    10, 20,
                                    20, 24
                                ],
                                'circle-stroke-width': 2,
                                'circle-stroke-color': 'rgba(255, 200, 0, 1.0)'
                            }}
                        />
                        {/* Individual (unclustered) earthquake icons */}
                        <Layer
                            id="earthquakes-layer"
                            type="symbol"
                            filter={['!', ['has', 'point_count']]}
                            layout={{
                                'icon-image': 'icon-threat',
                                'icon-size': 0.5,
                                'icon-allow-overlap': true
                            }}
                            paint={{ 'icon-opacity': 1.0 }}
                        />
                    </Source>
                )}

                {/* GPS Jamming Zones — red translucent grid squares */}
                {jammingGeoJSON && (
                    <Source id="gps-jamming" type="geojson" data={jammingGeoJSON as any}>
                        <Layer
                            id="gps-jamming-fill"
                            type="fill"
                            paint={{
                                'fill-color': '#ff0040',
                                'fill-opacity': ['get', 'opacity']
                            }}
                        />
                        <Layer
                            id="gps-jamming-outline"
                            type="line"
                            paint={{
                                'line-color': '#ff0040',
                                'line-width': 1.5,
                                'line-opacity': 0.6
                            }}
                        />
                        <Layer
                            id="gps-jamming-label"
                            type="symbol"
                            layout={{
                                'text-field': ['concat', 'GPS JAM ', ['to-string', ['round', ['*', 100, ['get', 'ratio']]]], '%'],
                                'text-size': [
                                    'interpolate', ['linear'], ['zoom'],
                                    2, 8,
                                    5, 10,
                                    8, 12
                                ],
                                'text-allow-overlap': false,
                                'text-ignore-placement': false
                            }}
                            paint={{
                                'text-color': '#ff4060',
                                'text-halo-color': '#000000',
                                'text-halo-width': 1.5
                            }}
                        />
                    </Source>
                )}

                {/* CCTV Cameras — clustered green dots */}
                {cctvGeoJSON && (
                    <Source id="cctv" type="geojson" data={cctvGeoJSON as any} cluster={true} clusterRadius={50} clusterMaxZoom={14}>
                        {/* Cluster circles — green, sized by count */}
                        <Layer
                            id="cctv-clusters"
                            type="circle"
                            filter={['has', 'point_count']}
                            paint={{
                                'circle-color': '#22c55e',
                                'circle-radius': [
                                    'step', ['get', 'point_count'],
                                    14, 10,
                                    18, 50,
                                    24, 200,
                                    30
                                ],
                                'circle-opacity': 0.8,
                                'circle-stroke-width': 2,
                                'circle-stroke-color': '#16a34a'
                            }}
                        />
                        {/* Cluster count labels */}
                        <Layer
                            id="cctv-cluster-count"
                            type="symbol"
                            filter={['has', 'point_count']}
                            layout={{
                                'text-field': '{point_count_abbreviated}',
                                'text-size': 12,
                                'text-allow-overlap': true
                            }}
                            paint={{
                                'text-color': '#ffffff',
                                'text-halo-color': '#000000',
                                'text-halo-width': 1
                            }}
                        />
                        {/* Individual camera dots */}
                        <Layer
                            id="cctv-layer"
                            type="circle"
                            filter={['!', ['has', 'point_count']]}
                            paint={{
                                'circle-color': '#22c55e',
                                'circle-radius': [
                                    'interpolate', ['linear'], ['zoom'],
                                    2, 2,
                                    8, 4,
                                    14, 6
                                ],
                                'circle-opacity': 0.9,
                                'circle-stroke-width': 1,
                                'circle-stroke-color': '#16a34a'
                            }}
                        />
                    </Source>
                )}

                {/* KiwiSDR Receivers — radio tower icons with pulse rings */}
                {kiwisdrGeoJSON && (
                    <Source id="kiwisdr" type="geojson" data={kiwisdrGeoJSON as any} cluster={true} clusterRadius={50} clusterMaxZoom={14}>
                        {/* Pulse ring behind clusters */}
                        <Layer
                            id="kiwisdr-cluster-pulse"
                            type="circle"
                            filter={['has', 'point_count']}
                            paint={{
                                'circle-radius': ['step', ['get', 'point_count'], 20, 10, 26, 50, 32, 200, 40],
                                'circle-color': 'rgba(245, 158, 11, 0.08)',
                                'circle-stroke-width': 1.5,
                                'circle-stroke-color': 'rgba(245, 158, 11, 0.35)',
                                'circle-blur': 0.4,
                            }}
                        />
                        {/* Clusters — tower icon with count */}
                        <Layer
                            id="kiwisdr-clusters"
                            type="symbol"
                            filter={['has', 'point_count']}
                            layout={{
                                'icon-image': 'svgRadioTower',
                                'icon-size': 0.9,
                                'icon-allow-overlap': true,
                                'text-field': '{point_count_abbreviated}',
                                'text-size': 10,
                                'text-offset': [0, 1.4],
                                'text-allow-overlap': true,
                                'text-font': ['Noto Sans Bold'],
                            }}
                            paint={{
                                'text-color': '#f59e0b',
                                'text-halo-color': '#000000',
                                'text-halo-width': 1.5,
                            }}
                        />
                        {/* Pulse ring behind individual towers */}
                        <Layer
                            id="kiwisdr-pulse"
                            type="circle"
                            filter={['!', ['has', 'point_count']]}
                            paint={{
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 6, 8, 10, 14, 14],
                                'circle-color': 'rgba(245, 158, 11, 0.06)',
                                'circle-stroke-width': 1,
                                'circle-stroke-color': 'rgba(245, 158, 11, 0.3)',
                                'circle-blur': 0.5,
                            }}
                        />
                        {/* Individual tower icons */}
                        <Layer
                            id="kiwisdr-layer"
                            type="symbol"
                            filter={['!', ['has', 'point_count']]}
                            layout={{
                                'icon-image': 'svgRadioTower',
                                'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.5, 8, 0.8, 14, 1.0],
                                'icon-allow-overlap': true,
                            }}
                        />
                    </Source>
                )}

                {/* OpenRailwayMap — global railway infrastructure raster overlay */}
                {activeLayers.railway_map && (
                    <Source
                        id="openrailwaymap"
                        type="raster"
                        tiles={['https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png']}
                        tileSize={256}
                        maxzoom={18}
                        attribution="OpenRailwayMap"
                    >
                        <Layer
                            id="openrailwaymap-layer"
                            type="raster"
                            paint={{
                                'raster-opacity': 0.75,
                                'raster-fade-duration': 300,
                            }}
                        />
                    </Source>
                )}

                {/* Trains — live train position markers with clustering */}
                {trainsGeoJSON && (
                    <Source id="trains" type="geojson" data={trainsGeoJSON as any} cluster={true} clusterRadius={40} clusterMaxZoom={10}>
                        {/* Cluster circles */}
                        <Layer
                            id="trains-clusters"
                            type="circle"
                            filter={['has', 'point_count']}
                            paint={{
                                'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 50, 28, 200, 36],
                                'circle-color': 'rgba(16, 185, 129, 0.15)',
                                'circle-stroke-width': 1.5,
                                'circle-stroke-color': 'rgba(16, 185, 129, 0.5)',
                            }}
                        />
                        {/* Cluster count labels */}
                        <Layer
                            id="trains-cluster-count"
                            type="symbol"
                            filter={['has', 'point_count']}
                            layout={{
                                'icon-image': 'svgTrain',
                                'icon-size': 0.85,
                                'icon-allow-overlap': true,
                                'text-field': '{point_count_abbreviated}',
                                'text-size': 10,
                                'text-offset': [0, 1.4],
                                'text-allow-overlap': true,
                                'text-font': ['Noto Sans Bold'],
                            }}
                            paint={{
                                'text-color': '#10b981',
                                'text-halo-color': '#000000',
                                'text-halo-width': 1.5,
                            }}
                        />
                        {/* Individual train icons */}
                        <Layer
                            id="trains-layer"
                            type="symbol"
                            filter={['!', ['has', 'point_count']]}
                            layout={{
                                'icon-image': 'svgTrain',
                                'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.5, 8, 0.8, 14, 1.0],
                                'icon-allow-overlap': true,
                                'text-field': ['step', ['zoom'], '', 8, ['get', 'name']],
                                'text-size': 10,
                                'text-offset': [0, 1.4],
                                'text-allow-overlap': false,
                                'text-font': ['Noto Sans Regular'],
                            }}
                            paint={{
                                'text-color': '#10b981',
                                'text-halo-color': '#000000',
                                'text-halo-width': 1,
                            }}
                        />
                    </Source>
                )}

                {/* Internet Outages — region-level grey markers with % and labels */}
                {internetOutagesGeoJSON && (
                    <Source id="internet-outages" type="geojson" data={internetOutagesGeoJSON as any}>
                        {/* Outer ring */}
                        <Layer
                            id="internet-outages-pulse"
                            type="circle"
                            paint={{
                                'circle-radius': ['interpolate', ['linear'], ['get', 'severity'], 0, 14, 50, 18, 80, 22],
                                'circle-color': 'rgba(180, 180, 180, 0.1)',
                                'circle-stroke-width': 1.5,
                                'circle-stroke-color': 'rgba(180, 180, 180, 0.35)',
                            }}
                        />
                        {/* Inner solid circle — all grey, size conveys severity */}
                        <Layer
                            id="internet-outages-layer"
                            type="circle"
                            paint={{
                                'circle-radius': ['interpolate', ['linear'], ['get', 'severity'], 0, 6, 50, 9, 80, 12],
                                'circle-color': '#888888',
                                'circle-stroke-width': 2,
                                'circle-stroke-color': 'rgba(0, 0, 0, 0.6)',
                                'circle-opacity': 0.9
                            }}
                        />
                        {/* Severity % inside circle */}
                        <Layer
                            id="internet-outages-pct"
                            type="symbol"
                            layout={{
                                'text-field': ['case', ['>', ['get', 'severity'], 0], ['concat', ['to-string', ['get', 'severity']], '%'], '!'],
                                'text-size': 9,
                                'text-font': ['Noto Sans Bold'],
                                'text-allow-overlap': true,
                                'text-ignore-placement': true,
                            }}
                            paint={{
                                'text-color': '#ffffff',
                                'text-halo-color': 'rgba(0,0,0,0.8)',
                                'text-halo-width': 1,
                            }}
                        />
                        {/* Region name label below — grey */}
                        <Layer
                            id="internet-outages-label"
                            type="symbol"
                            layout={{
                                'text-field': ['get', 'region'],
                                'text-size': 10,
                                'text-font': ['Noto Sans Bold'],
                                'text-offset': [0, 1.8],
                                'text-anchor': 'top',
                                'text-allow-overlap': false,
                            }}
                            paint={{
                                'text-color': '#aaaaaa',
                                'text-halo-color': 'rgba(0,0,0,0.9)',
                                'text-halo-width': 1.5,
                            }}
                        />
                    </Source>
                )}

                {/* Data Center positions */}
                {dataCentersGeoJSON && (
                    <Source id="datacenters" type="geojson" data={dataCentersGeoJSON as any} cluster={true} clusterRadius={30} clusterMaxZoom={8}>
                        {/* Cluster circles */}
                        <Layer
                            id="datacenters-clusters"
                            type="circle"
                            filter={['has', 'point_count']}
                            paint={{
                                'circle-color': '#7c3aed',
                                'circle-radius': ['step', ['get', 'point_count'], 12, 10, 16, 50, 20],
                                'circle-opacity': 0.7,
                                'circle-stroke-width': 1,
                                'circle-stroke-color': '#a78bfa',
                            }}
                        />
                        <Layer
                            id="datacenters-cluster-count"
                            type="symbol"
                            filter={['has', 'point_count']}
                            layout={{
                                'text-field': '{point_count_abbreviated}',
                                'text-font': ['Noto Sans Bold'],
                                'text-size': 10,
                                'text-allow-overlap': true,
                            }}
                            paint={{
                                'text-color': '#e9d5ff',
                            }}
                        />
                        {/* Individual DC icons */}
                        <Layer
                            id="datacenters-layer"
                            type="symbol"
                            filter={['!', ['has', 'point_count']]}
                            layout={{
                                'icon-image': 'datacenter',
                                'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.5, 6, 0.7, 10, 1.0],
                                'icon-allow-overlap': true,
                                'text-field': ['step', ['zoom'], '', 6, ['get', 'name']],
                                'text-font': ['Noto Sans Regular'],
                                'text-size': 9,
                                'text-offset': [0, 1.2],
                                'text-anchor': 'top',
                                'text-allow-overlap': false,
                            }}
                            paint={{
                                'text-color': '#c4b5fd',
                                'text-halo-color': 'rgba(0,0,0,0.9)',
                                'text-halo-width': 1,
                            }}
                        />
                    </Source>
                )}

                {/* ═══ NEW UPSTREAM LAYERS ═══ */}

                {/* Power Plants — amber clustered icons */}
                {powerPlantsGeoJSON && (
                    <Source id="power-plants" type="geojson" data={EMPTY_FC} cluster={true} clusterRadius={30} clusterMaxZoom={8}>
                        <Layer
                            id="power-plants-clusters"
                            type="circle"
                            minzoom={4}
                            filter={['has', 'point_count']}
                            paint={{
                                'circle-color': '#92400e',
                                'circle-radius': ['step', ['get', 'point_count'], 12, 10, 16, 50, 20],
                                'circle-opacity': 0.7,
                                'circle-stroke-width': 1,
                                'circle-stroke-color': '#f59e0b',
                            }}
                        />
                        <Layer
                            id="power-plants-cluster-count"
                            type="symbol"
                            minzoom={4}
                            filter={['has', 'point_count']}
                            layout={{
                                'text-field': '{point_count_abbreviated}',
                                'text-font': ['Noto Sans Bold'],
                                'text-size': 10,
                                'text-allow-overlap': true,
                            }}
                            paint={{ 'text-color': '#fde68a' }}
                        />
                        <Layer
                            id="power-plants-layer"
                            type="circle"
                            minzoom={4}
                            filter={['!', ['has', 'point_count']]}
                            paint={{
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 3, 6, 5, 10, 8],
                                'circle-color': '#f59e0b',
                                'circle-opacity': 0.8,
                                'circle-stroke-width': 1,
                                'circle-stroke-color': '#92400e',
                            }}
                        />
                    </Source>
                )}

                {/* PSK Reporter — green HF digital mode spots with clustering */}
                {pskReporterGeoJSON && (
                    <Source id="psk-reporter" type="geojson" data={EMPTY_FC} cluster={true} clusterRadius={50} clusterMaxZoom={14}>
                        <Layer
                            id="psk-reporter-cluster-pulse"
                            type="circle"
                            filter={['has', 'point_count']}
                            minzoom={4}
                            paint={{
                                'circle-radius': ['step', ['get', 'point_count'], 20, 10, 26, 50, 32, 200, 40],
                                'circle-color': 'rgba(34, 197, 94, 0.08)',
                                'circle-stroke-width': 1.5,
                                'circle-stroke-color': 'rgba(34, 197, 94, 0.35)',
                                'circle-blur': 0.4,
                            }}
                        />
                        <Layer
                            id="psk-reporter-clusters"
                            type="circle"
                            filter={['has', 'point_count']}
                            minzoom={4}
                            paint={{
                                'circle-radius': ['step', ['get', 'point_count'], 12, 10, 16, 50, 20, 200, 26],
                                'circle-color': 'rgba(34, 197, 94, 0.6)',
                                'circle-stroke-width': 1.5,
                                'circle-stroke-color': 'rgba(34, 197, 94, 0.9)',
                            }}
                        />
                        <Layer
                            id="psk-reporter-layer"
                            type="circle"
                            filter={['!', ['has', 'point_count']]}
                            minzoom={4}
                            paint={{
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 2.5, 8, 4, 14, 6],
                                'circle-color': '#22c55e',
                                'circle-stroke-width': 0.5,
                                'circle-stroke-color': 'rgba(34, 197, 94, 0.8)',
                            }}
                        />
                    </Source>
                )}

                {/* SatNOGS Ground Stations — teal clustered circles */}
                {satnogsGeoJSON && (
                    <Source id="satnogs" type="geojson" data={EMPTY_FC} cluster={true} clusterRadius={50} clusterMaxZoom={14}>
                        <Layer
                            id="satnogs-clusters"
                            type="circle"
                            filter={['has', 'point_count']}
                            paint={{
                                'circle-radius': ['step', ['get', 'point_count'], 12, 10, 16, 50, 20],
                                'circle-color': 'rgba(20, 184, 166, 0.6)',
                                'circle-stroke-width': 1.5,
                                'circle-stroke-color': 'rgba(20, 184, 166, 0.9)',
                            }}
                        />
                        <Layer
                            id="satnogs-layer"
                            type="circle"
                            filter={['!', ['has', 'point_count']]}
                            paint={{
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 3, 8, 5, 14, 7],
                                'circle-color': '#14b8a6',
                                'circle-opacity': 0.85,
                                'circle-stroke-width': 1,
                                'circle-stroke-color': '#0d9488',
                            }}
                        />
                    </Source>
                )}

                {/* TinyGS LoRa Satellites — purple circles */}
                {tinygsGeoJSON && (
                    <Source id="tinygs" type="geojson" data={EMPTY_FC}>
                        <Layer
                            id="tinygs-layer"
                            type="circle"
                            paint={{
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 3, 6, 5, 10, 8],
                                'circle-color': '#c084fc',
                                'circle-opacity': 0.85,
                                'circle-stroke-width': 1,
                                'circle-stroke-color': '#9333ea',
                            }}
                        />
                    </Source>
                )}

                {/* Police Scanners (OpenMHZ) — red clustered circles */}
                {scannerGeoJSON && (
                    <Source id="scanners" type="geojson" data={EMPTY_FC} cluster={true} clusterRadius={50} clusterMaxZoom={14}>
                        <Layer
                            id="scanner-cluster-pulse"
                            type="circle"
                            filter={['has', 'point_count']}
                            paint={{
                                'circle-radius': ['step', ['get', 'point_count'], 20, 10, 26, 50, 32, 200, 40],
                                'circle-color': 'rgba(220, 38, 38, 0.08)',
                                'circle-stroke-width': 1.5,
                                'circle-stroke-color': 'rgba(220, 38, 38, 0.35)',
                                'circle-blur': 0.4,
                            }}
                        />
                        <Layer
                            id="scanner-clusters"
                            type="circle"
                            filter={['has', 'point_count']}
                            paint={{
                                'circle-radius': ['step', ['get', 'point_count'], 12, 10, 16, 50, 20],
                                'circle-color': 'rgba(220, 38, 38, 0.6)',
                                'circle-stroke-width': 1.5,
                                'circle-stroke-color': 'rgba(220, 38, 38, 0.9)',
                            }}
                        />
                        <Layer
                            id="scanner-layer"
                            type="circle"
                            filter={['!', ['has', 'point_count']]}
                            paint={{
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 3, 8, 5, 14, 7],
                                'circle-color': '#dc2626',
                                'circle-opacity': 0.8,
                                'circle-stroke-width': 1,
                                'circle-stroke-color': '#991b1b',
                            }}
                        />
                    </Source>
                )}

                {/* Meshtastic — green circle clusters */}
                {meshtasticGeoJSON && (
                    <Source id="meshtastic-source" type="geojson" data={EMPTY_FC} cluster={true} clusterRadius={42} clusterMaxZoom={8}>
                        <Layer
                            id="meshtastic-clusters"
                            type="circle"
                            filter={['has', 'point_count']}
                            paint={{
                                'circle-radius': ['step', ['get', 'point_count'], 12, 10, 16, 50, 22, 100, 28],
                                'circle-color': 'rgba(34, 197, 94, 0.5)',
                                'circle-stroke-width': 2,
                                'circle-stroke-color': '#86efac',
                            }}
                        />
                        <Layer
                            id="meshtastic-cluster-count"
                            type="symbol"
                            filter={['has', 'point_count']}
                            layout={{
                                'text-field': ['get', 'point_count_abbreviated'],
                                'text-size': 11,
                                'text-font': ['Noto Sans Bold'],
                                'text-allow-overlap': true,
                            }}
                            paint={{
                                'text-color': '#052e16',
                                'text-halo-color': '#86efac',
                                'text-halo-width': 0.8,
                            }}
                        />
                        <Layer
                            id="meshtastic-circles"
                            type="circle"
                            filter={['!', ['has', 'point_count']]}
                            paint={{
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 3, 8, 5, 14, 7],
                                'circle-color': '#22c55e',
                                'circle-opacity': 0.85,
                                'circle-stroke-width': 1,
                                'circle-stroke-color': '#15803d',
                            }}
                        />
                        <Layer
                            id="meshtastic-labels"
                            type="symbol"
                            minzoom={8}
                            layout={{
                                'text-field': ['get', 'callsign'],
                                'text-size': 9,
                                'text-offset': [0, 1.2],
                                'text-anchor': 'top',
                                'text-font': ['Noto Sans Regular'],
                                'text-allow-overlap': false,
                            }}
                            paint={{
                                'text-color': '#86efac',
                                'text-halo-color': 'rgba(0,0,0,0.8)',
                                'text-halo-width': 1,
                            }}
                        />
                    </Source>
                )}

                {/* APRS / JS8Call — pink circle clusters */}
                {aprsGeoJSON && (
                    <Source id="aprs-source" type="geojson" data={EMPTY_FC} cluster={true} clusterRadius={42} clusterMaxZoom={8}>
                        <Layer
                            id="aprs-clusters"
                            type="circle"
                            filter={['has', 'point_count']}
                            paint={{
                                'circle-radius': ['step', ['get', 'point_count'], 12, 10, 16, 50, 22, 100, 28],
                                'circle-color': 'rgba(244, 114, 182, 0.5)',
                                'circle-stroke-width': 2,
                                'circle-stroke-color': '#f9a8d4',
                            }}
                        />
                        <Layer
                            id="aprs-cluster-count"
                            type="symbol"
                            filter={['has', 'point_count']}
                            layout={{
                                'text-field': ['get', 'point_count_abbreviated'],
                                'text-size': 11,
                                'text-font': ['Noto Sans Bold'],
                                'text-allow-overlap': true,
                            }}
                            paint={{
                                'text-color': '#4a0525',
                                'text-halo-color': '#f9a8d4',
                                'text-halo-width': 0.8,
                            }}
                        />
                        <Layer
                            id="aprs-triangles"
                            type="circle"
                            filter={['!', ['has', 'point_count']]}
                            paint={{
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 3, 8, 5, 14, 7],
                                'circle-color': '#f472b6',
                                'circle-opacity': 0.85,
                                'circle-stroke-width': 1,
                                'circle-stroke-color': '#be185d',
                            }}
                        />
                        <Layer
                            id="aprs-labels"
                            type="symbol"
                            minzoom={8}
                            layout={{
                                'text-field': ['get', 'callsign'],
                                'text-size': 9,
                                'text-offset': [0, 1.2],
                                'text-anchor': 'top',
                                'text-font': ['Noto Sans Regular'],
                                'text-allow-overlap': false,
                            }}
                            paint={{
                                'text-color': '#f9a8d4',
                                'text-halo-color': 'rgba(0,0,0,0.8)',
                                'text-halo-width': 1,
                            }}
                        />
                    </Source>
                )}

                {/* Weather Alerts — severity-colored polygons with label overlay */}
                {weatherAlertsGeoJSON && (
                    <Source id="weather-alerts-source" type="geojson" data={(weatherAlertsGeoJSON as any)}>
                        <Layer
                            id="weather-alerts-fill"
                            type="fill"
                            paint={{
                                'fill-color': ['get', 'color'],
                                'fill-opacity': 0.12,
                            }}
                        />
                        <Layer
                            id="weather-alerts-outline"
                            type="line"
                            paint={{
                                'line-color': ['get', 'color'],
                                'line-width': 2,
                                'line-opacity': 0.7,
                                'line-dasharray': [4, 3],
                            }}
                        />
                    </Source>
                )}
                {weatherAlertLabelsGeoJSON && (
                    <Source id="weather-alert-labels-source" type="geojson" data={(weatherAlertLabelsGeoJSON as any)}>
                        <Layer
                            id="weather-alert-icons"
                            type="symbol"
                            layout={{
                                'text-field': ['get', 'event'],
                                'text-font': ['Noto Sans Bold'],
                                'text-size': 11,
                                'text-allow-overlap': false,
                                'text-max-width': 14,
                            }}
                            paint={{
                                'text-color': ['get', 'color'],
                                'text-halo-color': '#000000',
                                'text-halo-width': 1.5,
                            }}
                        />
                    </Source>
                )}

                {/* Air Quality — AQI-colored circles */}
                {airQualityGeoJSON && (
                    <Source id="air-quality-source" type="geojson" data={EMPTY_FC} cluster={true} clusterMaxZoom={8} clusterRadius={40}>
                        <Layer
                            id="air-quality-clusters"
                            type="circle"
                            filter={['has', 'point_count']}
                            paint={{
                                'circle-radius': ['step', ['get', 'point_count'], 12, 10, 16, 50, 20],
                                'circle-color': '#94a3b8',
                                'circle-opacity': 0.6,
                            }}
                        />
                        <Layer
                            id="air-quality-layer"
                            type="circle"
                            filter={['!', ['has', 'point_count']]}
                            paint={{
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 3, 6, 5, 10, 8],
                                'circle-color': ['get', 'color'],
                                'circle-opacity': 0.75,
                                'circle-stroke-width': 1,
                                'circle-stroke-color': '#000',
                            }}
                        />
                    </Source>
                )}

                {/* Volcanoes — orange-colored circles */}
                {volcanoesGeoJSON && (
                    <Source id="volcanoes-source" type="geojson" data={EMPTY_FC}>
                        <Layer
                            id="volcanoes-layer"
                            type="circle"
                            paint={{
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 4, 6, 7, 10, 10],
                                'circle-color': '#f97316',
                                'circle-opacity': 0.85,
                                'circle-stroke-width': 1.5,
                                'circle-stroke-color': '#c2410c',
                            }}
                        />
                        <Layer
                            id="volcanoes-label"
                            type="symbol"
                            layout={{
                                'text-field': ['step', ['zoom'], '', 6, ['get', 'name']],
                                'text-font': ['Noto Sans Bold'],
                                'text-size': 10,
                                'text-offset': [0, 1.2],
                                'text-anchor': 'top',
                                'text-allow-overlap': false,
                            }}
                            paint={{
                                'text-color': '#f97316',
                                'text-halo-color': 'rgba(0,0,0,0.9)',
                                'text-halo-width': 1,
                            }}
                        />
                    </Source>
                )}

                {/* Fishing Activity — sky blue clustered circles */}
                {fishingGeoJSON && (
                    <Source id="fishing-source" type="geojson" data={EMPTY_FC} cluster={true} clusterMaxZoom={6} clusterRadius={50}>
                        <Layer
                            id="fishing-clusters"
                            type="circle"
                            filter={['has', 'point_count']}
                            paint={{
                                'circle-radius': ['step', ['get', 'point_count'], 12, 10, 16, 50, 22],
                                'circle-color': '#0ea5e9',
                                'circle-opacity': 0.6,
                            }}
                        />
                        <Layer
                            id="fishing-layer"
                            type="circle"
                            filter={['!', ['has', 'point_count']]}
                            paint={{
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 3, 6, 5, 10, 7],
                                'circle-color': '#0ea5e9',
                                'circle-opacity': 0.7,
                                'circle-stroke-width': 1,
                                'circle-stroke-color': '#0369a1',
                            }}
                        />
                    </Source>
                )}

                {/* VIIRS Change Detection Nodes */}
                {viirsChangeNodesGeoJSON && (
                    <Source id="viirs-change-nodes" type="geojson" data={EMPTY_FC}>
                        <Layer
                            id="viirs-change-nodes-layer"
                            type="circle"
                            paint={{
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 4, 6, 8, 10, 12],
                                'circle-color': ['get', 'color'],
                                'circle-opacity': 0.85,
                                'circle-stroke-width': 1,
                                'circle-stroke-color': 'rgba(255,255,255,0.4)',
                            }}
                        />
                    </Source>
                )}

                {/* Correlation Alerts — Emergent Intelligence grid squares */}
                {correlationsGeoJSON && (
                    <Source id="correlations" type="geojson" data={(correlationsGeoJSON as any)}>
                        <Layer
                            id="corr-rf-fill"
                            type="fill"
                            filter={['==', ['get', 'corr_type'], 'rf_anomaly']}
                            minzoom={3}
                            paint={{ 'fill-color': '#6b7280', 'fill-opacity': ['get', 'opacity'] }}
                        />
                        <Layer
                            id="corr-rf-outline"
                            type="line"
                            filter={['==', ['get', 'corr_type'], 'rf_anomaly']}
                            minzoom={3}
                            paint={{ 'line-color': '#6b7280', 'line-width': 1.5, 'line-opacity': 0.6 }}
                        />
                        <Layer
                            id="corr-mil-fill"
                            type="fill"
                            filter={['==', ['get', 'corr_type'], 'military_buildup']}
                            minzoom={3}
                            paint={{ 'fill-color': '#dc2626', 'fill-opacity': ['get', 'opacity'] }}
                        />
                        <Layer
                            id="corr-mil-outline"
                            type="line"
                            filter={['==', ['get', 'corr_type'], 'military_buildup']}
                            minzoom={3}
                            paint={{ 'line-color': '#dc2626', 'line-width': 2, 'line-opacity': 0.7, 'line-dasharray': [4, 2] }}
                        />
                        <Layer
                            id="corr-infra-fill"
                            type="fill"
                            filter={['==', ['get', 'corr_type'], 'infra_cascade']}
                            minzoom={3}
                            paint={{ 'fill-color': '#1f2937', 'fill-opacity': ['get', 'opacity'] }}
                        />
                        <Layer
                            id="corr-infra-outline"
                            type="line"
                            filter={['==', ['get', 'corr_type'], 'infra_cascade']}
                            minzoom={3}
                            paint={{ 'line-color': '#374151', 'line-width': 1.5, 'line-opacity': 0.6 }}
                        />
                    </Source>
                )}

                {/* Wastewater pathogen surveillance — color by alert level */}
                {wastewaterGeoJSON && (
                    <Source id="wastewater-source" type="geojson" data={EMPTY_FC}>
                        <Layer
                            id="wastewater-layer"
                            type="circle"
                            paint={{
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 4, 6, 7, 10, 10],
                                'circle-color': ['get', 'color'],
                                'circle-opacity': 0.85,
                                'circle-stroke-width': 1.5,
                                'circle-stroke-color': 'rgba(255,255,255,0.4)',
                            }}
                        />
                    </Source>
                )}

                {/* CrowdThreat — crowdsourced threat intelligence */}
                {crowdthreatGeoJSON && (
                    <Source id="crowdthreat-source" type="geojson" data={EMPTY_FC}>
                        <Layer
                            id="crowdthreat-layer"
                            type="circle"
                            paint={{
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 3, 6, 6, 10, 9],
                                'circle-color': ['coalesce', ['get', 'category_colour'], '#f59e0b'],
                                'circle-opacity': 0.85,
                                'circle-stroke-width': 1,
                                'circle-stroke-color': 'rgba(255,255,255,0.5)',
                            }}
                        />
                    </Source>
                )}

                {/* UAP Sightings — color by reported shape */}
                {uapSightingsGeoJSON && (
                    <Source id="uap-sightings-source" type="geojson" data={EMPTY_FC}>
                        <Layer
                            id="uap-sightings-layer"
                            type="circle"
                            paint={{
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 3, 6, 6, 10, 9],
                                'circle-color': ['get', 'color'],
                                'circle-opacity': 0.85,
                                'circle-stroke-width': 1,
                                'circle-stroke-color': 'rgba(255,255,255,0.5)',
                            }}
                        />
                    </Source>
                )}

                {/* SAR (Synthetic Aperture Radar) — AOI watchboxes (polygons) */}
                {sarAoisGeoJSON && (
                    <Source id="sar-aois-source" type="geojson" data={EMPTY_FC}>
                        <Layer
                            id="sar-aois-fill"
                            type="fill"
                            paint={{ 'fill-color': '#eab308', 'fill-opacity': 0.08 }}
                        />
                        <Layer
                            id="sar-aois-outline"
                            type="line"
                            paint={{ 'line-color': '#eab308', 'line-width': 1.5, 'line-opacity': 0.6, 'line-dasharray': [3, 2] }}
                        />
                    </Source>
                )}

                {/* SAR anomalies — color by anomaly kind */}
                {sarAnomaliesGeoJSON && (
                    <Source id="sar-anomalies-source" type="geojson" data={EMPTY_FC}>
                        <Layer
                            id="sar-anomalies-layer"
                            type="circle"
                            paint={{
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 4, 6, 7, 10, 11],
                                'circle-color': ['get', 'color'],
                                'circle-opacity': 0.85,
                                'circle-stroke-width': 1.5,
                                'circle-stroke-color': 'rgba(255,255,255,0.5)',
                            }}
                        />
                    </Source>
                )}

                {/* ═══ END NEW UPSTREAM LAYERS ═══ */}

                {/* Military Base polygon outlines (LOD — visible when zoomed in) */}
                {milBasePolygonGeoJSON && (
                    <Source id="military-bases-poly" type="geojson" data={milBasePolygonGeoJSON as any}>
                        <Layer
                            id="military-bases-poly-fill"
                            type="fill"
                            paint={{
                                'fill-color': ['get', 'color'],
                                'fill-opacity': 0.15,
                            }}
                        />
                        <Layer
                            id="military-bases-poly-outline"
                            type="line"
                            paint={{
                                'line-color': ['get', 'color'],
                                'line-width': 1.5,
                                'line-opacity': 0.7,
                            }}
                        />
                    </Source>
                )}

                {/* Military Base point positions */}
                {militaryBasesGeoJSON && (
                    <Source id="military-bases" type="geojson" data={militaryBasesGeoJSON as any}>
                        <Layer
                            id="military-bases-layer"
                            type="circle"
                            paint={{
                                'circle-color': ['get', 'color'],
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 3, 6, 5, 10, 8],
                                'circle-opacity': 0.85,
                                'circle-stroke-width': 1.5,
                                'circle-stroke-color': ['get', 'color'],
                                'circle-stroke-opacity': 0.5,
                            }}
                        />
                        <Layer
                            id="military-bases-label"
                            type="symbol"
                            minzoom={7}
                            layout={{
                                'text-field': ['get', 'name'],
                                'text-font': ['Noto Sans Bold'],
                                'text-size': 10,
                                'text-offset': [0, 1.4],
                                'text-anchor': 'top',
                                'text-allow-overlap': false,
                            }}
                            paint={{
                                'text-color': ['get', 'color'],
                                'text-halo-color': 'rgba(0,0,0,0.9)',
                                'text-halo-width': 1,
                            }}
                        />
                    </Source>
                )}

                {/* Pikud HaOref — Israel red alerts, color-coded by age */}
                {/* hot (<2min)=#ef4444, recent (2-10min)=#f97316, old (10-30min)=#eab308 */}
                {pikudAlertsGeoJSON && (
                    <Source id="pikud-alerts" type="geojson" data={pikudAlertsGeoJSON as any}>
                        <Layer
                            id="pikud-alerts-pulse"
                            type="circle"
                            paint={{
                                'circle-color': ['match', ['get', 'age_class'],
                                    'hot',    '#ef4444',
                                    'recent', '#f97316',
                                    'old',    '#eab308',
                                    '#ef4444'],
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 8, 6, 14, 10, 20],
                                'circle-opacity': ['match', ['get', 'age_class'],
                                    'hot', 0.30, 'recent', 0.20, 'old', 0.12, 0.30],
                                'circle-stroke-width': 0,
                            }}
                        />
                        <Layer
                            id="pikud-alerts-layer"
                            type="circle"
                            paint={{
                                'circle-color': ['match', ['get', 'age_class'],
                                    'hot',    '#ef4444',
                                    'recent', '#f97316',
                                    'old',    '#eab308',
                                    '#ef4444'],
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 4, 6, 7, 10, 10],
                                'circle-opacity': ['match', ['get', 'age_class'],
                                    'hot', 1.0, 'recent', 0.85, 'old', 0.65, 1.0],
                                'circle-stroke-width': 1.5,
                                'circle-stroke-color': ['match', ['get', 'age_class'],
                                    'hot',    '#fca5a5',
                                    'recent', '#fdba74',
                                    'old',    '#fde047',
                                    '#fca5a5'],
                            }}
                        />
                        <Layer
                            id="pikud-alerts-label"
                            type="symbol"
                            minzoom={6}
                            layout={{
                                'text-field': ['get', 'city'],
                                'text-font': ['Noto Sans Bold'],
                                'text-size': 10,
                                'text-offset': [0, 1.4],
                                'text-anchor': 'top',
                                'text-allow-overlap': false,
                            }}
                            paint={{
                                'text-color': ['match', ['get', 'age_class'],
                                    'hot',    '#fca5a5',
                                    'recent', '#fdba74',
                                    'old',    '#fde047',
                                    '#fca5a5'],
                                'text-halo-color': 'rgba(0,0,0,0.9)',
                                'text-halo-width': 1,
                            }}
                        />
                    </Source>
                )}

                {/* Ukraine oblast alerts — color-coded by alert type */}
                {ukraineAlertsGeoJSON && (
                    <Source id="ukraine-alerts" type="geojson" data={ukraineAlertsGeoJSON as any}>
                        <Layer
                            id="ukraine-alerts-pulse"
                            type="circle"
                            paint={{
                                'circle-color': ['get', 'color'],
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 20, 6, 35, 10, 50],
                                'circle-opacity': 0.15,
                                'circle-stroke-width': 0,
                            }}
                        />
                        <Layer
                            id="ukraine-alerts-layer"
                            type="circle"
                            paint={{
                                'circle-color': ['get', 'color'],
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 6, 6, 10, 10, 14],
                                'circle-opacity': ['case', ['get', 'active'], 1.0, 0.7],
                                'circle-stroke-width': 1.5,
                                'circle-stroke-color': ['get', 'color'],
                            }}
                        />
                        <Layer
                            id="ukraine-alerts-label"
                            type="symbol"
                            minzoom={5}
                            layout={{
                                'text-field': ['get', 'region'],
                                'text-font': ['Noto Sans Bold'],
                                'text-size': 10,
                                'text-offset': [0, 1.4],
                                'text-anchor': 'top',
                                'text-allow-overlap': false,
                            }}
                            paint={{
                                'text-color': ['get', 'color'],
                                'text-halo-color': 'rgba(0,0,0,0.9)',
                                'text-halo-width': 1,
                            }}
                        />
                    </Source>
                )}

                {/* BGP Anomaly arcs — hijack/leak lines between country centroids */}
                {bgpAnomaliesGeoJSON && (
                    <Source id="bgp-anomalies" type="geojson" data={bgpAnomaliesGeoJSON as any}>
                        <Layer
                            id="bgp-anomalies-layer"
                            type="line"
                            paint={{
                                'line-color': ['get', 'color'],
                                'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1, 5, 2.5],
                                'line-opacity': 0.75,
                                'line-dasharray': [4, 2],
                            }}
                        />
                    </Source>
                )}

                {/* CF Traffic Anomaly points */}
                {cfAnomaliesGeoJSON && (
                    <Source id="cf-anomalies" type="geojson" data={cfAnomaliesGeoJSON as any}>
                        <Layer
                            id="cf-anomalies-pulse"
                            type="circle"
                            paint={{
                                'circle-color': '#ff6600',
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 16, 6, 28, 10, 40],
                                'circle-opacity': 0.12,
                                'circle-stroke-width': 0,
                            }}
                        />
                        <Layer
                            id="cf-anomalies-layer"
                            type="circle"
                            paint={{
                                'circle-color': '#ff6600',
                                'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 5, 6, 8, 10, 12],
                                'circle-opacity': 0.85,
                                'circle-stroke-width': 1.5,
                                'circle-stroke-color': '#ff6600',
                            }}
                        />
                        <Layer
                            id="cf-anomalies-label"
                            type="symbol"
                            minzoom={3}
                            layout={{
                                'text-field': ['get', 'location_name'],
                                'text-font': ['Noto Sans Bold'],
                                'text-size': 10,
                                'text-offset': [0, 1.4],
                                'text-anchor': 'top',
                                'text-allow-overlap': false,
                            }}
                            paint={{
                                'text-color': '#ff6600',
                                'text-halo-color': 'rgba(0,0,0,0.9)',
                                'text-halo-width': 1,
                            }}
                        />
                    </Source>
                )}

                {/* Active DDoS arcs — great-circle lines origin → target */}
                {activeDdosGeoJSON && (
                    <Source id="active-ddos" type="geojson" data={activeDdosGeoJSON as any}>
                        <Layer
                            id="active-ddos-layer"
                            type="line"
                            paint={{
                                'line-color': '#cc00ff',
                                'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.2, 5, 2.5],
                                'line-opacity': 0.35,
                            }}
                        />
                    </Source>
                )}
                {/* DDoS directional pulse — bright segment sliding along each arc */}
                {activeDdosGeoJSON && (
                    <Source id="active-ddos-pulse" type="geojson" data={EMPTY_FC as any}>
                        <Layer
                            id="active-ddos-pulse-layer"
                            type="line"
                            paint={{
                                'line-color': '#ee44ff',
                                'line-width': ['interpolate', ['linear'], ['zoom'], 1, 2.5, 5, 5],
                                'line-opacity': 0.9,
                                'line-blur': 2,
                            }}
                        />
                    </Source>
                )}

                {/* Satellite positions — mission-type icons */}
                {/* satellites: data pushed imperatively */}
                    <Source id="satellites" type="geojson" data={EMPTY_FC as any}>
                        <Layer
                            id="satellites-layer"
                            type="symbol"
                            layout={{
                                'icon-image': ['get', 'iconId'],
                                'icon-size': [
                                    'interpolate', ['linear'], ['zoom'],
                                    0, 0.4,
                                    3, 0.5,
                                    6, 0.7,
                                    10, 1.0
                                ],
                                'icon-allow-overlap': true,
                            }}
                        />
                    </Source>

                {/* Satellite click popup */}
                {selectedEntity?.type === 'satellite' && (() => {
                    const sat = data?.satellites?.find((s: any) => s.id === selectedEntity.id);
                    if (!sat) return null;
                    const missionLabels: Record<string, string> = {
                        military_recon: '🔴 MILITARY RECON', military_sar: '🔴 MILITARY SAR',
                        sar: '🔷 SAR IMAGING', sigint: '🟠 SIGINT / ELINT',
                        navigation: '🔵 NAVIGATION', early_warning: '🟣 EARLY WARNING',
                        commercial_imaging: '🟢 COMMERCIAL IMAGING', space_station: '🏠 SPACE STATION',
                        communication: '📡 COMMUNICATION'
                    };
                    return (
                        <Popup
                            longitude={sat.lng} latitude={sat.lat}
                            closeButton={false} closeOnClick={false}
                            onClose={() => onEntityClick?.(null)}
                            anchor="bottom" offset={12}
                        >
                            <div className="map-popup border border-cyan-500/30">
                                <div className="map-popup-title text-[#00c8ff]">
                                    🛰️ {sat.name}
                                </div>
                                <div className="map-popup-row text-[#8899aa]">
                                    NORAD ID: <span className="text-white">{sat.id}</span>
                                </div>
                                {sat.sat_type && (
                                    <div className="map-popup-row">
                                        Type: <span className="text-[#ffcc00]">{sat.sat_type}</span>
                                    </div>
                                )}
                                {sat.country && (
                                    <div className="map-popup-row">
                                        Country: <span className="text-white">{sat.country}</span>
                                    </div>
                                )}
                                {sat.mission && (
                                    <div className="map-popup-row font-semibold">
                                        {missionLabels[sat.mission] || `⚪ ${sat.mission.toUpperCase()}`}
                                    </div>
                                )}
                                <div className="map-popup-row">
                                    Altitude: <span className="text-[#44ff88]">{sat.alt_km?.toLocaleString()} km</span>
                                </div>
                                {sat.wiki && (
                                    <div className="mt-2 border-t border-[var(--border-primary)]/50 pt-2">
                                        <WikiImage wikiUrl={sat.wiki} label={sat.sat_type || sat.name} maxH="max-h-28" accent="hover:border-cyan-500/50" />
                                    </div>
                                )}
                            </div>
                        </Popup>
                    );
                })()}

                {/* UAV click popup — real ADS-B detected drones */}
                {selectedEntity?.type === 'uav' && (() => {
                    const uav = data?.uavs?.find((u: any) => u.id === selectedEntity.id);
                    if (!uav) return null;
                    return (
                        <Popup
                            longitude={uav.lng} latitude={uav.lat}
                            closeButton={false} closeOnClick={false}
                            onClose={() => onEntityClick?.(null)}
                            anchor="bottom" offset={12}
                        >
                            <div className="map-popup border border-red-500/40">
                                <div className="map-popup-title text-[#ff4444]">
                                    {uav.callsign}
                                </div>
                                <div className="map-popup-subtitle text-[#ff8844]">
                                    LIVE ADS-B TRANSPONDER
                                </div>
                                {uav.aircraft_model && (
                                    <div className="map-popup-row">
                                        Model: <span className="text-white">{uav.aircraft_model}</span>
                                    </div>
                                )}
                                {uav.uav_type && (
                                    <div className="map-popup-row">
                                        Classification: <span className="text-[#ffcc00]">{uav.uav_type}</span>
                                    </div>
                                )}
                                {uav.country && (
                                    <div className="map-popup-row">
                                        Registration: <span className="text-white">{uav.country}</span>
                                    </div>
                                )}
                                {uav.icao24 && (
                                    <div className="map-popup-row">
                                        ICAO: <span className="text-[#888]">{uav.icao24}</span>
                                    </div>
                                )}
                                <div className="map-popup-row">
                                    Altitude: <span className="text-[#44ff88]">{uav.alt?.toLocaleString()} m</span>
                                </div>
                                {(uav.speed_knots ?? 0) > 0 && (
                                    <div className="map-popup-row">
                                        Speed: <span className="text-[#00e5ff]">{uav.speed_knots} kn</span>
                                    </div>
                                )}
                                {uav.squawk && (
                                    <div className="map-popup-row">
                                        Squawk: <span className="text-[#888]">{uav.squawk}</span>
                                    </div>
                                )}
                                {uav.wiki && (
                                    <div className="mt-2 border-t border-[var(--border-primary)]/50 pt-2">
                                        <WikiImage wikiUrl={uav.wiki} label={uav.callsign} maxH="max-h-28" accent="hover:border-red-500/50" />
                                    </div>
                                )}
                            </div>
                        </Popup>
                    );
                })()}

                {/* KiwiSDR Receivers Popup */}
                {selectedEntity?.type === 'kiwisdr' && (() => {
                    const receiver = data?.kiwisdr?.find((k: any) => k.name === selectedEntity.name || String(k.id) === String(selectedEntity.id));
                    // use extra if available from the click event, otherwise fallback
                    const props = selectedEntity.extra || receiver || {} as any;
                    const lat = props.lat ?? selectedEntity.extra?.lat ?? selectedEntity.extra?.geometry?.coordinates?.[1];
                    const lng = props.lon ?? (props as any).lng ?? selectedEntity.extra?.lon ?? selectedEntity.extra?.geometry?.coordinates?.[0];
                    if (lat == null || lng == null) return null;
                    return (
                        <Popup
                            longitude={lng} latitude={lat}
                            closeButton={false} closeOnClick={false}
                            onClose={() => onEntityClick?.(null)}
                            anchor="bottom" offset={12}
                        >
                            <div className="map-popup !border-amber-500/40" style={{ borderWidth: 1, borderStyle: 'solid' }}>
                                <div className="flex justify-between items-start mb-1">
                                    <div className="map-popup-title text-amber-400">
                                        {(props.name || 'UNKNOWN SDR RECEIVER').toUpperCase()}
                                    </div>
                                    <button onClick={() => onEntityClick?.(null)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] ml-2">✕</button>
                                </div>
                                <div className="map-popup-subtitle text-amber-600/80 border-b border-amber-900/30 pb-1 flex items-center gap-1.5">
                                    <Radio size={10} /> PUBLIC NETWORK RECEIVER
                                </div>
                                
                                {props.location && (
                                    <div className="map-popup-row mt-1">
                                        Location: <span className="text-white">{props.location}</span>
                                    </div>
                                )}
                                {props.users !== undefined && (
                                    <div className="map-popup-row">
                                        Active Users: <span className={props.users >= (props.users_max || 4) ? 'text-red-400' : 'text-amber-400'}>{props.users} / {props.users_max || '?'}</span>
                                    </div>
                                )}
                                {props.antenna && (
                                    <div className="map-popup-row">
                                        Antenna: <span className="text-[#888]">{props.antenna}</span>
                                    </div>
                                )}
                                {props.bands && (
                                    <div className="map-popup-row">
                                        Bands: <span className="text-cyan-400">{(Number(props.bands.split('-')[0]) / 1e6).toFixed(0)}-{(Number(props.bands.split('-')[1]) / 1e6).toFixed(0)} MHz</span>
                                    </div>
                                )}

                                <div className="flex items-center gap-2 mt-3 pt-2 border-t border-[var(--border-primary)]">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            // The extra object contains the raw GeoJSON properties, including URL
                                            if (setTrackedSdr) {
                                                setTrackedSdr({
                                                    lat, lon: lng,
                                                    name: props.name,
                                                    url: props.url,
                                                    users: props.users,
                                                    users_max: props.users_max,
                                                    bands: props.bands,
                                                    antenna: props.antenna,
                                                    location: props.location
                                                });
                                            }
                                            onEntityClick?.(null);
                                        }}
                                        className="flex-1 text-center px-2 py-1.5 rounded bg-amber-950/40 border border-amber-500/30 hover:bg-amber-900/60 hover:border-amber-400 text-amber-400 text-[9px] font-mono tracking-widest transition-colors flex justify-center items-center gap-1.5"
                                    >
                                        <Activity size={10} /> TRACK SIGNAL
                                    </button>
                                    
                                    {props.url && (
                                        <a
                                            href={props.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-2 py-1.5 rounded bg-amber-500/10 border border-amber-500/50 hover:bg-amber-500/20 hover:border-amber-400 text-amber-400 text-[9px] font-mono tracking-widest transition-colors"
                                            title="Open SDR interface in new tab"
                                        >
                                            <Play size={10} className="fill-amber-400/20" />
                                        </a>
                                    )}
                                </div>
                            </div>
                        </Popup>
                    );
                })()}

                {/* Ship / carrier click popup */}
                {selectedEntity?.type === 'ship' && (() => {
                    const ship = data?.ships?.find((s: any, i: number) => {
                        return (s.mmsi || s.name || `ship-${i}`) === selectedEntity.id ||
                               (s.mmsi || s.name || `carrier-${i}`) === selectedEntity.id;
                    });
                    if (!ship) return null;
                    const [iLng, iLat] = interpShip(ship);
                    return (
                        <Popup
                            longitude={iLng} latitude={iLat}
                            closeButton={false} closeOnClick={false}
                            onClose={() => onEntityClick?.(null)}
                            anchor="bottom" offset={12}
                        >
                            <div className="map-popup" style={{ borderWidth: 1, borderStyle: 'solid', borderColor: ship.yacht_alert ? 'rgba(255,105,180,0.5)' : ship.type === 'carrier' ? 'rgba(255,170,0,0.5)' : 'rgba(59,130,246,0.4)' }}>
                                <div className="flex justify-between items-start mb-1">
                                    <div className="map-popup-title" style={{ color: ship.yacht_alert ? '#FF69B4' : ship.type === 'carrier' ? '#ffaa00' : '#3b82f6' }}>
                                        {ship.name || 'UNKNOWN VESSEL'}
                                    </div>
                                    <button onClick={() => onEntityClick?.(null)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] ml-2">✕</button>
                                </div>
                                {ship.estimated && (
                                    <div className="map-popup-subtitle text-[#ff6644] border-b border-[#ff664450] pb-1">
                                        ESTIMATED POSITION — {ship.source || 'OSINT DERIVED'}
                                    </div>
                                )}
                                {ship.type && (
                                    <div className="map-popup-row">
                                        Type: <span className="text-white capitalize">{ship.type.replace('_', ' ')}</span>
                                    </div>
                                )}
                                {ship.mmsi && (
                                    <div className="map-popup-row">
                                        MMSI: <span className="text-[#888]">{ship.mmsi}</span>
                                    </div>
                                )}
                                {ship.imo && (
                                    <div className="map-popup-row">
                                        IMO: <span className="text-[#888]">{ship.imo}</span>
                                    </div>
                                )}
                                {ship.callsign && (
                                    <div className="map-popup-row">
                                        Callsign: <span className="text-[#00e5ff]">{ship.callsign}</span>
                                    </div>
                                )}
                                {ship.country && (
                                    <div className="map-popup-row">
                                        Flag: <span className="text-white">{ship.country}</span>
                                    </div>
                                )}
                                {ship.destination && (
                                    <div className="map-popup-row">
                                        Destination: <span className="text-[#44ff88]">{ship.destination}</span>
                                    </div>
                                )}
                                {typeof ship.sog === 'number' && ship.sog > 0 && (
                                    <div className="map-popup-row">
                                        Speed: <span className="text-[#00e5ff]">{ship.sog.toFixed(1)} kn</span>
                                    </div>
                                )}
                                <div className="map-popup-row">
                                    Heading: <span style={{ color: ship.heading != null ? '#888' : '#ff6644' }}>
                                        {ship.heading != null ? `${Math.round(ship.heading)}°` : 'UNKNOWN'}
                                    </span>
                                </div>
                                {ship.type === 'carrier' && ship.source && (
                                    <div className="mt-1.5 p-[5px_7px] bg-[rgba(255,170,0,0.08)] border border-[rgba(255,170,0,0.3)] rounded text-[9px] tracking-wide">
                                        <div className="text-[#ffaa00] mb-0.5">
                                            SOURCE: {ship.source_url ? (
                                                <a href={ship.source_url} target="_blank" rel="noopener noreferrer"
                                                    className="text-[#00e5ff] underline">{ship.source}</a>
                                            ) : (
                                                <span className="text-white">{ship.source}</span>
                                            )}
                                        </div>
                                        {ship.last_osint_update && (
                                            <div className="text-[#888]">LAST OSINT UPDATE: {new Date(ship.last_osint_update).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</div>
                                        )}
                                        {ship.desc && (
                                            <div className="text-[#aaa] mt-0.5 text-[8px] leading-tight">{ship.desc}</div>
                                        )}
                                    </div>
                                )}
                                {ship.type !== 'carrier' && ship.last_osint_update && (
                                    <div className="map-popup-row">
                                        Last OSINT Update: <span className="text-[#888]">{new Date(ship.last_osint_update).toLocaleDateString()}</span>
                                    </div>
                                )}
                                {ship.yacht_alert && (
                                    <div className="mt-1.5 p-[5px_7px] bg-[rgba(255,105,180,0.08)] border border-[rgba(255,105,180,0.3)] rounded text-[9px] tracking-wide">
                                        <div className="text-[#FF69B4] font-bold mb-0.5">TRACKED YACHT</div>
                                        <div>Owner: <span className="text-white">{ship.yacht_owner}</span></div>
                                        {ship.yacht_builder && <div>Builder: <span className="text-[#888]">{ship.yacht_builder}</span></div>}
                                        {(ship.yacht_length ?? 0) > 0 && <div>Length: <span className="text-[#888]">{ship.yacht_length}m</span></div>}
                                        {(ship.yacht_year ?? 0) > 0 && <div>Year: <span className="text-[#888]">{ship.yacht_year}</span></div>}
                                        {ship.yacht_category && <div>Category: <span className="text-[#FF69B4]">{ship.yacht_category}</span></div>}
                                        {ship.yacht_link && <a href={ship.yacht_link} target="_blank" rel="noopener noreferrer" className="text-[#00e5ff] underline">Wikipedia</a>}
                                    </div>
                                )}
                            </div>
                        </Popup>
                    );
                })()}

                {/* Train click popup — route, type, stations, speed */}
                {selectedEntity?.type === 'train' && (() => {
                    const train = data?.trains?.find((t: any) => t.id === selectedEntity.id);
                    if (!train) return null;
                    // Parse stations from the raw data (not from GeoJSON string)
                    const stations = train.stations || [];
                    const statusColor = (train.status || '').toLowerCase().includes('late') ? '#ff6644'
                        : (train.status || '').toLowerCase().includes('early') ? '#00e5ff'
                        : '#10b981';
                    const serviceLabel = train.service_type === 'commuter' ? 'Commuter Rail'
                        : train.service_type === 'highspeed' ? 'High-Speed Rail'
                        : train.service_type === 'freight' ? 'Freight'
                        : 'Intercity Passenger';
                    return (
                        <Popup
                            longitude={train.lng} latitude={train.lat}
                            closeButton={false} closeOnClick={false}
                            onClose={() => onEntityClick?.(null)}
                            anchor="bottom" offset={12}
                            maxWidth="320px"
                        >
                            <div className="map-popup" style={{ borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(16, 185, 129, 0.5)' }}>
                                <div className="flex justify-between items-start mb-1">
                                    <div className="map-popup-title text-[#10b981]">
                                        {train.name || 'UNKNOWN TRAIN'}
                                        {train.train_num && <span className="text-[#888] ml-1">#{train.train_num}</span>}
                                    </div>
                                    <button onClick={() => onEntityClick?.(null)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] ml-2">✕</button>
                                </div>
                                <div className="map-popup-row">
                                    Operator: <span className="text-white">{train.operator}</span>
                                </div>
                                <div className="map-popup-row">
                                    Type: <span className="text-[#10b981]">{serviceLabel}</span>
                                </div>
                                {train.route_name && (
                                    <div className="map-popup-row">
                                        Route: <span className="text-[#00e5ff]">{train.route_name}</span>
                                    </div>
                                )}
                                <div className="map-popup-row">
                                    <span className="text-[#888]">{train.origin || train.origin_code}</span>
                                    <span className="text-[#10b981] mx-1">→</span>
                                    <span className="text-[#44ff88]">{train.destination || train.dest_code}</span>
                                </div>
                                {train.status && (
                                    <div className="map-popup-row">
                                        Status: <span style={{ color: statusColor }}>{train.status}</span>
                                    </div>
                                )}
                                {train.status_msg && (
                                    <div className="map-popup-row text-[9px] text-[#888]">{train.status_msg}</div>
                                )}
                                {typeof train.speed_mph === 'number' && train.speed_mph > 0 && (
                                    <div className="map-popup-row">
                                        Speed: <span className="text-[#00e5ff]">
                                            {train.country === 'US'
                                                ? `${Math.round(train.speed_mph)} mph`
                                                : `${Math.round(train.speed_kmh || train.speed_mph * 1.60934)} km/h`
                                            }
                                        </span>
                                    </div>
                                )}
                                {train.next_station && (
                                    <div className="map-popup-row">
                                        Next Stop: <span className="text-[#ffaa00]">{train.next_station}</span>
                                    </div>
                                )}
                                {train.last_station && (
                                    <div className="map-popup-row">
                                        Last Station: <span className="text-[#888]">{train.last_station}</span>
                                    </div>
                                )}
                                {/* Station list — compact scrollable route timeline */}
                                {stations.length > 0 && (
                                    <div className="mt-1.5 p-[5px_7px] bg-[rgba(16,185,129,0.06)] border border-[rgba(16,185,129,0.25)] rounded text-[9px] tracking-wide">
                                        <div className="text-[#10b981] font-bold mb-1">ROUTE ({stations.length} stops)</div>
                                        <div className="max-h-[120px] overflow-y-auto space-y-0.5 pr-1" style={{ scrollbarWidth: 'thin' }}>
                                            {stations.map((s: any, idx: number) => {
                                                const isDeparted = s.status === 'Departed';
                                                const isEnroute = s.status === 'Enroute' || s.status === 'Next';
                                                const dotColor = isDeparted ? '#888' : isEnroute ? '#ffaa00' : '#10b981';
                                                const timeStr = s.arr_cmnt || s.dep_cmnt || '';
                                                return (
                                                    <div key={idx} className="flex items-center gap-1">
                                                        <span style={{ color: dotColor }}>●</span>
                                                        <span className={isDeparted ? 'text-[#666]' : isEnroute ? 'text-[#ffaa00]' : 'text-[#ccc]'}>
                                                            {s.code ? `${s.name} (${s.code})` : s.name}
                                                        </span>
                                                        {timeStr && <span className="text-[#666] ml-auto text-[8px]">{timeStr}</span>}
                                                        {s.bus && <span className="text-[#ff6644] ml-1" title="Bus connection">🚌</span>}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                {train.country && (
                                    <div className="map-popup-row mt-1">
                                        Country: <span className="text-[#888]">{train.country}</span>
                                    </div>
                                )}
                            </div>
                        </Popup>
                    );
                })()}

                {/* Data Center click popup */}
                {/* Wastewater pathogen surveillance popup */}
                {selectedEntity?.type === 'wastewater' && selectedEntity.extra && (() => {
                    const p: any = selectedEntity.extra;
                    let pathogens: any[] = [];
                    try { pathogens = JSON.parse(p.pathogens_json || '[]'); } catch { pathogens = []; }
                    return (
                        <Popup
                            longitude={p._clickLng}
                            latitude={p._clickLat}
                            closeButton={false}
                            closeOnClick={false}
                            onClose={() => onEntityClick?.(null)}
                            className="threat-popup"
                            maxWidth="300px"
                        >
                            <div className="map-popup bg-[#0a1822] border border-cyan-500/40 text-[#cfe9f5] min-w-[210px]">
                                <div className="map-popup-title text-[#00e5ff] border-b border-cyan-500/20 pb-1">
                                    {p.name}
                                </div>
                                {(p.city || p.state) && (
                                    <div className="map-popup-row">Location: <span className="text-white">{[p.city, p.state].filter(Boolean).join(', ')}</span></div>
                                )}
                                {p.population != null && p.population !== '' && (
                                    <div className="map-popup-row">Population served: <span className="text-white">{Number(p.population).toLocaleString()}</span></div>
                                )}
                                {p.collection_date && (
                                    <div className="map-popup-row">Collected: <span className="text-white">{p.collection_date}</span></div>
                                )}
                                {Number(p.alert_count) > 0 && p.alert_pathogens && (
                                    <div className="mt-1.5 px-2 py-1 bg-red-500/15 border border-red-400/40 rounded text-[10px] text-[#ff6b6b]">
                                        ALERT — {p.alert_pathogens}
                                    </div>
                                )}
                                {pathogens.length > 0 && (
                                    <div className="mt-1.5 space-y-0.5">
                                        {pathogens.map((pt: any, i: number) => (
                                            <div key={i} className="map-popup-row flex justify-between gap-2">
                                                <span className={pt.alert ? 'text-[#ff6b6b]' : 'text-[#8fd3e8]'}>{pt.name}</span>
                                                <span className="text-white">{pt.activity}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div className="mt-1.5 text-[9px] text-cyan-600 tracking-wider">WASTEWATER SURVEILLANCE</div>
                            </div>
                        </Popup>
                    );
                })()}

                {/* CrowdThreat popup */}
                {selectedEntity?.type === 'crowdthreat' && selectedEntity.extra && (() => {
                    const t: any = selectedEntity.extra;
                    return (
                        <Popup
                            longitude={t._clickLng}
                            latitude={t._clickLat}
                            closeButton={false}
                            closeOnClick={false}
                            onClose={() => onEntityClick?.(null)}
                            className="threat-popup"
                            maxWidth="300px"
                        >
                            <div className="map-popup bg-[#1a0f0a] border border-amber-500/40 text-[#f5e6cf] min-w-[210px]">
                                <div className="map-popup-title text-amber-400 border-b border-amber-500/20 pb-1">
                                    {t.title}
                                </div>
                                {t.summary && <div className="map-popup-row text-[#e8d3a8]">{t.summary}</div>}
                                {(t.category || t.subcategory) && (
                                    <div className="map-popup-row">Type: <span className="text-white">{[t.category, t.subcategory].filter(Boolean).join(' / ')}</span></div>
                                )}
                                {(t.address || t.city) && (
                                    <div className="map-popup-row">Location: <span className="text-white">{[t.address, t.city, t.country].filter(Boolean).join(', ')}</span></div>
                                )}
                                {t.timeago && <div className="map-popup-row">When: <span className="text-white">{t.timeago}</span></div>}
                                {t.verification && <div className="map-popup-row">Verification: <span className="text-white">{t.verification}</span></div>}
                                {t.source_url && (
                                    <a href={t.source_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[10px] text-amber-300 underline">Source</a>
                                )}
                                <div className="mt-1.5 text-[9px] text-amber-600 tracking-wider">CROWDTHREAT</div>
                            </div>
                        </Popup>
                    );
                })()}

                {/* UAP sighting popup */}
                {selectedEntity?.type === 'uap_sighting' && selectedEntity.extra && (() => {
                    const s: any = selectedEntity.extra;
                    return (
                        <Popup
                            longitude={s._clickLng}
                            latitude={s._clickLat}
                            closeButton={false}
                            closeOnClick={false}
                            onClose={() => onEntityClick?.(null)}
                            className="threat-popup"
                            maxWidth="300px"
                        >
                            <div className="map-popup bg-[#0f0a1a] border border-violet-400/40 text-[#e9d5ff] min-w-[210px]">
                                <div className="map-popup-title text-violet-300 border-b border-violet-400/20 pb-1">
                                    {s.name}
                                </div>
                                {s.shape_raw && <div className="map-popup-row">Shape: <span className="text-white">{s.shape_raw}</span></div>}
                                {(s.city || s.state || s.country) && (
                                    <div className="map-popup-row">Location: <span className="text-white">{[s.city, s.state, s.country].filter(Boolean).join(', ')}</span></div>
                                )}
                                {s.date_time && <div className="map-popup-row">When: <span className="text-white">{s.date_time}</span></div>}
                                {s.duration && <div className="map-popup-row">Duration: <span className="text-white">{s.duration}</span></div>}
                                {s.summary && <div className="map-popup-row text-[#c4b5fd] mt-1">{s.summary}</div>}
                                <div className="mt-1.5 text-[9px] text-violet-600 tracking-wider">{s.source || 'NUFORC'} · UAP SIGHTING</div>
                            </div>
                        </Popup>
                    );
                })()}

                {/* SAR anomaly popup */}
                {selectedEntity?.type === 'sar_anomaly' && selectedEntity.extra && (() => {
                    const a: any = selectedEntity.extra;
                    return (
                        <Popup
                            longitude={a._clickLng}
                            latitude={a._clickLat}
                            closeButton={false}
                            closeOnClick={false}
                            onClose={() => onEntityClick?.(null)}
                            className="threat-popup"
                            maxWidth="320px"
                        >
                            <div className="map-popup bg-[#1a1505] border border-yellow-500/40 text-[#f5edcf] min-w-[220px]">
                                <div className="map-popup-title text-yellow-300 border-b border-yellow-500/20 pb-1">
                                    {a.name}
                                </div>
                                {a.kind && <div className="map-popup-row">Kind: <span className="text-white">{String(a.kind).replace(/_/g, ' ')}</span></div>}
                                {a.summary && <div className="map-popup-row text-[#e8dca8] mt-1">{a.summary}</div>}
                                {(a.magnitude != null && a.magnitude !== 0) && (
                                    <div className="map-popup-row">Magnitude: <span className="text-white">{a.magnitude}{a.magnitude_unit ? ` ${a.magnitude_unit}` : ''}</span></div>
                                )}
                                {(a.confidence != null && a.confidence !== 0) && (
                                    <div className="map-popup-row">Confidence: <span className="text-white">{Math.round(Number(a.confidence) * 100)}%</span></div>
                                )}
                                {a.source_constellation && <div className="map-popup-row">Source: <span className="text-white">{a.source_constellation}</span></div>}
                                {a.scene_count != null && Number(a.scene_count) > 0 && (
                                    <div className="map-popup-row">Scenes: <span className="text-white">{a.scene_count}</span></div>
                                )}
                                {a.provenance_url && (
                                    <a href={a.provenance_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[10px] text-yellow-300 underline">Provenance</a>
                                )}
                                <div className="mt-1.5 text-[9px] text-yellow-600 tracking-wider">SAR ANOMALY</div>
                            </div>
                        </Popup>
                    );
                })()}

                {/* SAR AOI watchbox popup */}
                {selectedEntity?.type === 'sar_aoi' && selectedEntity.extra && (() => {
                    const a: any = selectedEntity.extra;
                    return (
                        <Popup
                            longitude={a._clickLng}
                            latitude={a._clickLat}
                            closeButton={false}
                            closeOnClick={false}
                            onClose={() => onEntityClick?.(null)}
                            className="threat-popup"
                            maxWidth="300px"
                        >
                            <div className="map-popup bg-[#1a1505] border border-yellow-500/40 text-[#f5edcf] min-w-[200px]">
                                <div className="map-popup-title text-yellow-300 border-b border-yellow-500/20 pb-1">
                                    {a.name}
                                </div>
                                {a.description && <div className="map-popup-row text-[#e8dca8]">{a.description}</div>}
                                {a.category && <div className="map-popup-row">Category: <span className="text-white">{a.category}</span></div>}
                                {a.radius_km != null && Number(a.radius_km) > 0 && (
                                    <div className="map-popup-row">Radius: <span className="text-white">{a.radius_km} km</span></div>
                                )}
                                <div className="mt-1.5 text-[9px] text-yellow-600 tracking-wider">SAR WATCHBOX (AOI)</div>
                            </div>
                        </Popup>
                    );
                })()}

                {selectedEntity?.type === 'datacenter' && (() => {
                    const dc = data?.datacenters?.find((_: any, i: number) => `dc-${i}` === selectedEntity.id);
                    if (!dc) return null;
                    // Check if any internet outage is in the same country
                    const outagesInCountry = (data?.internet_outages || []).filter((o: any) =>
                        o.country_name && dc.country && o.country_name.toLowerCase() === dc.country.toLowerCase()
                    );
                    return (
                        <Popup
                            longitude={dc.lng}
                            latitude={dc.lat}
                            closeButton={false}
                            closeOnClick={false}
                            onClose={() => onEntityClick?.(null)}
                            className="threat-popup"
                            maxWidth="280px"
                        >
                            <div className="map-popup bg-[#1a1035] border border-violet-400/40 text-[#e9d5ff] min-w-[200px]">
                                <div className="map-popup-title text-violet-400 border-b border-violet-400/20 pb-1">
                                    {dc.name}
                                </div>
                                {dc.company && (
                                    <div className="map-popup-row">
                                        Operator: <span className="text-[#c4b5fd]">{dc.company}</span>
                                    </div>
                                )}
                                {dc.street && (
                                    <div className="map-popup-row">
                                        Address: <span className="text-white">{dc.street}{dc.zip ? ` ${dc.zip}` : ''}</span>
                                    </div>
                                )}
                                {dc.city && (
                                    <div className="map-popup-row">
                                        Location: <span className="text-white">{dc.city}{dc.country ? `, ${dc.country}` : ''}</span>
                                    </div>
                                )}
                                {!dc.city && dc.country && (
                                    <div className="map-popup-row">
                                        Country: <span className="text-white">{dc.country}</span>
                                    </div>
                                )}
                                {outagesInCountry.length > 0 && (
                                    <div className="mt-1.5 px-2 py-1 bg-red-500/15 border border-red-400/40 rounded text-[10px] text-[#ff6b6b]">
                                        OUTAGE IN REGION — {outagesInCountry.map((o: any) => `${o.region_name} (${o.severity}%)`).join(', ')}
                                    </div>
                                )}
                                <div className="mt-1.5 text-[9px] text-violet-600 tracking-wider">
                                    DATA CENTER
                                </div>
                            </div>
                        </Popup>
                    );
                })()}

                {selectedEntity?.type === 'military_base' && (() => {
                    const base = data?.military_bases?.find((_: any, i: number) => `milbase-${i}` === selectedEntity.id);
                    if (!base) return null;
                    const branchLabel: Record<string, string> = {
                        air_force: 'AIR FORCE', air_force_reserve: 'AF RESERVE', air_national_guard: 'AIR NAT\'L GUARD',
                        army: 'ARMY', army_reserve: 'ARMY RESERVE', army_national_guard: 'ARMY NAT\'L GUARD',
                        navy: 'NAVY', navy_reserve: 'NAVY RESERVE',
                        marines: 'MARINES', marines_reserve: 'MARINES RESERVE',
                        joint: 'JOINT', missile: 'MISSILE FORCES', nuclear: 'NUCLEAR FACILITY', other: 'OTHER',
                    };
                    const color = BRANCH_COLORS[base.branch] || '#9ca3af';
                    return (
                        <Popup
                            longitude={base.lng}
                            latitude={base.lat}
                            closeButton={false}
                            closeOnClick={false}
                            onClose={() => onEntityClick?.(null)}
                            className="threat-popup"
                            maxWidth="280px"
                        >
                            <div className="map-popup bg-[#1a1035] min-w-[200px]" style={{ borderColor: `${color}66` }}>
                                <div className="map-popup-title pb-1" style={{ color, borderBottomColor: `${color}33` }}>
                                    {base.name}
                                </div>
                                <div className="map-popup-row" style={{ color: `${color}cc` }}>
                                    Branch: <span className="text-white">{branchLabel[base.branch] || base.branch.toUpperCase()}</span>
                                </div>
                                {base.operator && (
                                    <div className="map-popup-row" style={{ color: `${color}cc` }}>
                                        Component: <span className="text-white">{base.operator.toUpperCase()}</span>
                                    </div>
                                )}
                                <div className="map-popup-row" style={{ color: `${color}cc` }}>
                                    Location: <span className="text-white">{base.state ? `${base.state}, ` : ''}{base.country?.toUpperCase()}</span>
                                </div>
                                {base.joint && (
                                    <div className="map-popup-row text-amber-400 font-semibold">JOINT BASE</div>
                                )}
                                <div className="mt-1.5 text-[9px] tracking-wider" style={{ color: `${color}99` }}>
                                    MILITARY BASE — {branchLabel[base.branch] || base.branch.toUpperCase()}
                                </div>
                            </div>
                        </Popup>
                    );
                })()}

                {/* BGP Anomaly click popup */}
                {selectedEntity?.type === 'bgp_anomaly' && (() => {
                    const p = selectedEntity.extra || {};
                    const lng = p._clickLng; const lat = p._clickLat;
                    if (lng == null || lat == null) return null;
                    const isHijack = p.bgp_type === 'hijack';
                    let prefixes: string[] = [];
                    try { prefixes = JSON.parse(p.affected_prefixes || '[]'); } catch {}
                    const ts = p.timestamp ? new Date(p.timestamp).toLocaleString() : '';
                    return (
                        <Popup longitude={lng} latitude={lat} closeButton={false} closeOnClick={false}
                            onClose={() => onEntityClick?.(null)} anchor="bottom" offset={12} maxWidth="300px">
                            <div className={`map-popup border ${isHijack ? 'border-red-500/50 bg-[#1a0a0a]' : 'border-orange-500/50 bg-[#1a1000]'} min-w-[220px]`}>
                                <div className={`map-popup-title ${isHijack ? 'text-red-400' : 'text-orange-400'} border-b ${isHijack ? 'border-red-500/20' : 'border-orange-500/20'} pb-1 flex justify-between items-center`}>
                                    <span>{isHijack ? 'BGP HIJACK' : 'BGP LEAK'}</span>
                                    <button onClick={() => onEntityClick?.(null)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] ml-2">✕</button>
                                </div>
                                <div className="map-popup-row">
                                    {isHijack ? 'Hijacker' : 'Leaker'}: <span className="text-white">{p.hijacker_org || `AS${p.hijacker_asn}`}</span>
                                    <span className="text-[#8899aa] ml-1">({p.hijacker_country})</span>
                                </div>
                                <div className="map-popup-row">
                                    Victim: <span className="text-white">{p.victim_org || `AS${p.victim_asn}`}</span>
                                    <span className="text-[#8899aa] ml-1">({p.victim_country})</span>
                                </div>
                                {prefixes.length > 0 && (
                                    <div className="map-popup-row">
                                        Prefixes: <span className="text-[#aabbcc]">{prefixes.slice(0, 4).join(', ')}{prefixes.length > 4 ? ` +${prefixes.length - 4}` : ''}</span>
                                    </div>
                                )}
                                <div className="map-popup-row">
                                    Confidence: <span className={`font-bold ${(p.confidence_score || 0) >= 5 ? 'text-red-400' : 'text-yellow-400'}`}>{p.confidence_score}</span>
                                    <span className="text-[#8899aa] ml-2">Peers: {p.peer_count}</span>
                                </div>
                                {ts && <div className="map-popup-row text-[#8899aa]">{ts}</div>}
                                <div className={`mt-1.5 text-[9px] tracking-wider ${isHijack ? 'text-red-500/70' : 'text-orange-500/70'}`}>
                                    CLOUDFLARE RADAR — BGP MONITORING
                                </div>
                            </div>
                        </Popup>
                    );
                })()}

                {/* CF Traffic Anomaly click popup */}
                {selectedEntity?.type === 'cf_anomaly' && (() => {
                    const p = selectedEntity.extra || {};
                    const lng = p._clickLng; const lat = p._clickLat;
                    if (lng == null || lat == null) return null;
                    const isOngoing = (p.status || '').toUpperCase() === 'ONGOING';
                    const ts = p.timestamp ? new Date(p.timestamp).toLocaleString() : '';
                    return (
                        <Popup longitude={lng} latitude={lat} closeButton={false} closeOnClick={false}
                            onClose={() => onEntityClick?.(null)} anchor="bottom" offset={12} maxWidth="280px">
                            <div className="map-popup border border-orange-500/50 bg-[#1a1000] min-w-[200px]">
                                <div className="map-popup-title text-orange-400 border-b border-orange-500/20 pb-1 flex justify-between items-center">
                                    <span>TRAFFIC ANOMALY</span>
                                    <button onClick={() => onEntityClick?.(null)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] ml-2">✕</button>
                                </div>
                                <div className="map-popup-row">
                                    Location: <span className="text-white font-semibold">{p.location_name || p.location}</span>
                                </div>
                                <div className="map-popup-row">
                                    Status: <span className={`font-bold ${isOngoing ? 'text-red-400' : 'text-green-400'}`}>{isOngoing ? 'ONGOING' : 'RESOLVED'}</span>
                                </div>
                                {p.description && (
                                    <div className="map-popup-row text-[#cccccc] text-[11px] leading-tight mt-1">{p.description}</div>
                                )}
                                {ts && <div className="map-popup-row text-[#8899aa] mt-1">{ts}</div>}
                                <div className="mt-1.5 text-[9px] text-orange-500/70 tracking-wider">
                                    CLOUDFLARE RADAR — TRAFFIC ANOMALY
                                </div>
                            </div>
                        </Popup>
                    );
                })()}

                {/* Active DDoS click popup */}
                {selectedEntity?.type === 'active_ddos' && (() => {
                    const p = selectedEntity.extra || {};
                    const lng = p._clickLng; const lat = p._clickLat;
                    if (lng == null || lat == null) return null;
                    const pct = typeof p.requests_percent === 'number' ? p.requests_percent : parseFloat(p.requests_percent || '0');
                    return (
                        <Popup longitude={lng} latitude={lat} closeButton={false} closeOnClick={false}
                            onClose={() => onEntityClick?.(null)} anchor="bottom" offset={12} maxWidth="280px">
                            <div className="map-popup border border-purple-500/50 bg-[#150a25] min-w-[200px]">
                                <div className="map-popup-title text-purple-400 border-b border-purple-500/20 pb-1 flex justify-between items-center">
                                    <span>DDoS ATTACK</span>
                                    <button onClick={() => onEntityClick?.(null)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] ml-2">✕</button>
                                </div>
                                <div className="map-popup-row">
                                    Origin: <span className="text-white font-semibold">{p.origin_country_name || p.origin_country}</span>
                                </div>
                                <div className="map-popup-row">
                                    Target: <span className="text-white font-semibold">{p.target_country_name || p.target_country}</span>
                                </div>
                                <div className="map-popup-row">
                                    Traffic share: <span className={`font-bold ${pct >= 5 ? 'text-red-400' : pct >= 1 ? 'text-yellow-400' : 'text-purple-300'}`}>{pct.toFixed(2)}%</span>
                                </div>
                                <div className="map-popup-row text-[#8899aa]">
                                    Layer: {p.layer || 'L7'}
                                </div>
                                <div className="mt-1.5 text-[9px] text-purple-500/70 tracking-wider">
                                    CLOUDFLARE RADAR — L7 DDoS
                                </div>
                            </div>
                        </Popup>
                    );
                })()}

                {selectedEntity?.type === 'pikud_alert' && (() => {
                    const alerts = (pikudTimeOffset !== null && pikudTimeOffset !== undefined && pikudTimeOffset !== 0)
                        ? (pikudHistoryData ?? [])
                        : (data?.pikud_alerts ?? []);
                    const alert = alerts.find((_: any, i: number) => `pikud-${i}` === selectedEntity.id);
                    if (!alert) return null;
                    return (
                        <Popup
                            longitude={(alert as any).lng}
                            latitude={(alert as any).lat}
                            closeButton={false}
                            closeOnClick={false}
                            onClose={() => onEntityClick?.(null)}
                            className="threat-popup"
                            maxWidth="240px"
                        >
                            <div className="map-popup bg-[#1a0a0a] border border-red-500/50 text-[#fca5a5] min-w-[180px]">
                                <div className="map-popup-title text-red-400 border-b border-red-500/20 pb-1" dir="rtl">
                                    {(alert as any).city}
                                </div>
                                <div className="map-popup-row">
                                    Type: <span className="text-white">{(alert as any).cat_label ?? (alert as any).category ?? (alert as any).cat}</span>
                                </div>
                                <div className="map-popup-row">
                                    Time: <span className="text-white">{(alert as any).timestamp}</span>
                                </div>
                                {(alert as any).area && (
                                    <div className="map-popup-row">
                                        Area: <span className="text-white" dir="rtl">{(alert as any).area}</span>
                                    </div>
                                )}
                                <div className="mt-1.5 text-[9px] tracking-wider" style={{ color: (alert as any).color || '#ef4444' }}>
                                    {(alert as any).is_drill ? 'DRILL' : 'RED ALERT'} — PIKUD HAOREF
                                </div>
                            </div>
                        </Popup>
                    );
                })()}

                {(() => {
                    if (selectedEntity?.type !== 'gdelt' || !data?.gdelt) return null;
                    const item = data.gdelt.find((g: any) => (g.properties?.name || String(g.geometry?.coordinates)) === selectedEntity.id);
                    if (!item?.geometry?.coordinates) return null;
                    return (
                        <Popup
                            longitude={item.geometry.coordinates[0]}
                            latitude={item.geometry.coordinates[1]}
                            closeButton={false}
                            closeOnClick={false}
                            onClose={() => onEntityClick?.(null)}
                            anchor="bottom"
                            offset={15}
                        >
                            <div className="bg-[var(--bg-secondary)]/90 backdrop-blur-md border border-orange-800 rounded-lg flex flex-col z-[100] font-mono shadow-[0_4px_30px_rgba(255,140,0,0.4)] pointer-events-auto overflow-hidden w-[300px]">
                                <div className="p-2 border-b border-orange-500/30 bg-orange-950/40 flex justify-between items-center">
                                    <h2 className="text-[10px] tracking-widest font-bold text-orange-400 flex items-center gap-1">
                                        <AlertTriangle size={12} className="text-orange-400" /> NEWS ON THE GROUND
                                    </h2>
                                    <button onClick={() => onEntityClick?.(null)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">✕</button>
                                </div>
                                <div className="p-3 flex flex-col gap-2">
                                    <div className="flex justify-between items-center border-b border-[var(--border-primary)] pb-1">
                                        <span className="text-[var(--text-muted)] text-[9px]">LOCATION</span>
                                        <span className="text-white text-[10px] font-bold text-right ml-2 break-words max-w-[150px]">{item.properties?.name || 'UNKNOWN REGION'}</span>
                                    </div>
                                    <div className="flex flex-col gap-1 mt-1">
                                        <span className="text-[var(--text-muted)] text-[9px]">LATEST REPORTS: ({item.properties?.count || 1})</span>
                                        <div className="flex flex-col gap-2 max-h-[200px] overflow-y-auto styled-scrollbar mt-1">
                                            {(() => {
                                                const urls: string[] = item.properties?._urls_list || [];
                                                const headlines: string[] = item.properties?._headlines_list || [];
                                                if (urls.length === 0) return <span className="text-[var(--text-muted)] text-[10px]">No articles available.</span>;
                                                return urls.map((url: string, idx: number) => {
                                                    const headline = headlines[idx] || '';
                                                    let domain = '';
                                                    try { domain = new URL(url).hostname.replace('www.', ''); } catch { domain = ''; }
                                                    return (
                                                        <a
                                                            key={idx}
                                                            href={url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            onClick={(e) => e.stopPropagation()}
                                                            className="block py-1.5 border-b border-[var(--border-primary)]/50 last:border-0 cursor-pointer group"
                                                            style={{ pointerEvents: 'all' }}
                                                        >
                                                            <span className="text-orange-400 text-[11px] font-bold leading-tight group-hover:text-orange-300 block">
                                                                {headline || domain || 'View Article'}
                                                            </span>
                                                            {headline && domain && (
                                                                <span className="text-[var(--text-muted)] text-[9px] block mt-0.5">{domain}</span>
                                                            )}
                                                        </a>
                                                    );
                                                });
                                            })()}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </Popup>
                    );
                })()}

                {
                    selectedEntity?.type === 'liveuamap' && data?.liveuamap?.find((l: any) => String(l.id) === String(selectedEntity.id)) && (() => {
                        const item = data.liveuamap.find((l: any) => String(l.id) === String(selectedEntity.id));
                        if (!item) return null;
                        return (
                            <Popup
                                longitude={item.lng}
                                latitude={item.lat}
                                closeButton={false}
                                closeOnClick={false}
                                onClose={() => onEntityClick?.(null)}
                                anchor="bottom"
                                offset={15}
                            >
                                <div className="bg-[var(--bg-secondary)]/90 backdrop-blur-md border border-yellow-800 rounded-lg flex flex-col z-[100] font-mono shadow-[0_4px_30px_rgba(255,255,0,0.3)] pointer-events-auto overflow-hidden w-[280px]">
                                    <div className="p-2 border-b border-yellow-500/30 bg-yellow-950/40 flex justify-between items-center">
                                        <h2 className="text-[10px] tracking-widest font-bold text-yellow-400 flex items-center gap-1">
                                            <AlertTriangle size={12} className="text-yellow-400" /> REGIONAL TACTICAL EVENT
                                        </h2>
                                        <button onClick={() => onEntityClick?.(null)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">✕</button>
                                    </div>
                                    <div className="p-3 flex flex-col gap-2">
                                        <div className="flex flex-col gap-1 border-b border-[var(--border-primary)] pb-1">
                                            <span className="text-yellow-400 text-[10px] font-bold leading-tight">{item.title}</span>
                                        </div>
                                        <div className="flex justify-between items-center border-b border-[var(--border-primary)] pb-1 mt-1">
                                            <span className="text-[var(--text-muted)] text-[9px]">TIME</span>
                                            <span className="text-white text-[9px] font-bold">{item.timestamp || 'UNKNOWN'}</span>
                                        </div>
                                        {item.link && (
                                            <div className="flex justify-between items-center mt-1">
                                                <a href={item.link} target="_blank" rel="noreferrer" className="text-yellow-400 hover:text-yellow-300 text-[9px] font-bold underline">
                                                    View Source Report
                                                </a>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </Popup>
                        );
                    })()
                }

                {(() => {
                    if (selectedEntity?.type !== 'news' || !data?.news) return null;
                    const item = data.news.find((n: any) => {
                        const key = n.alertKey || `${n.title}|${n.coords?.[0]},${n.coords?.[1]}`;
                        return key === selectedEntity.id;
                    });
                    if (!item) return null;
                        let threatColor = "text-yellow-400";
                        let borderColor = "border-yellow-800";
                        let bgHeaderColor = "bg-yellow-950/40";
                        let shadowColor = "rgba(255,255,0,0.3)";
                        if (item.risk_score >= 8) {
                            threatColor = "text-red-400";
                            borderColor = "border-red-800";
                            bgHeaderColor = "bg-red-950/40";
                            shadowColor = "rgba(255,0,0,0.3)";
                        } else if (item.risk_score <= 4) {
                            threatColor = "text-green-400";
                            borderColor = "border-green-800";
                            bgHeaderColor = "bg-green-950/40";
                            shadowColor = "rgba(0,255,0,0.3)";
                        }

                    if (!item.coords) return null;

                        return (
                            <Popup
                                longitude={item.coords[1]}
                                latitude={item.coords[0]}
                                closeButton={false}
                                closeOnClick={false}
                                onClose={() => onEntityClick?.(null)}
                                anchor="bottom"
                                offset={25}
                            >
                                <div className={`bg-[var(--bg-secondary)]/90 backdrop-blur-md border ${borderColor} rounded-lg flex flex-col z-[100] font-mono shadow-[0_4px_30px_${shadowColor}] pointer-events-auto overflow-hidden w-[280px]`}>
                                    <div className={`p-2 border-b ${borderColor}/50 ${bgHeaderColor} flex justify-between items-center`}>
                                        <h2 className={`text-[10px] tracking-widest font-bold ${threatColor} flex items-center gap-1`}>
                                            <AlertTriangle size={12} className={threatColor} /> THREAT INTERCEPT
                                        </h2>
                                        <div className="flex items-center gap-2">
                                            <span className={`text-[10px] ${threatColor} font-mono font-bold animate-pulse`}>LVL: {item.risk_score}/10</span>
                                            <button onClick={() => onEntityClick?.(null)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">✕</button>
                                        </div>
                                    </div>
                                    <div className="p-3 flex flex-col gap-2">
                                        <div className="flex flex-col gap-1 border-b border-[var(--border-primary)] pb-1">
                                            <span className={`text-[10px] font-bold leading-tight ${threatColor}`}>{item.title}</span>
                                        </div>
                                        <div className="flex justify-between items-center border-b border-[var(--border-primary)] pb-1 mt-1">
                                            <span className="text-[var(--text-muted)] text-[9px]">SOURCE</span>
                                            <span className="text-white text-[9px] font-bold text-right ml-2">{item.source || 'UNKNOWN'}</span>
                                        </div>
                                        {item.machine_assessment && (
                                            <div className="mt-1 p-2 bg-black/60 border border-cyan-800/50 rounded-sm text-[8px] text-cyan-400 font-mono leading-tight relative overflow-hidden shadow-[inset_0_0_10px_rgba(0,255,255,0.05)]">
                                                <div className="absolute top-0 left-0 w-[2px] h-full bg-cyan-500 animate-pulse"></div>
                                                <span className="font-bold text-white">&gt;_ SYS.ANALYSIS: </span>
                                                <span className="text-cyan-300 opacity-90">{item.machine_assessment}</span>
                                            </div>
                                        )}
                                        {item.link && (
                                            <div className="flex justify-between items-center mt-1">
                                                <a href={item.link} target="_blank" rel="noreferrer" className={`${threatColor} hover:text-red-300 text-[9px] font-bold underline`}>
                                                    View Details
                                                </a>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </Popup>
                        );
                })()}

                {/* REGION DOSSIER — pin + popup chooser */}
                {selectedEntity?.type === 'region_dossier' && selectedEntity.extra && (
                    <>
                        <Marker
                            longitude={selectedEntity.extra.lng}
                            latitude={selectedEntity.extra.lat}
                            anchor="bottom"
                            style={{ zIndex: 10 }}
                        >
                            <div className="flex flex-col items-center pointer-events-none">
                                <div className="w-8 h-8 rounded-full border-2 border-emerald-500 animate-ping absolute opacity-30" />
                                <div className="w-4 h-4 rounded-full bg-emerald-500 border-2 border-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.6)]" />
                            </div>
                        </Marker>
                        {/* Popup chooser — appears after loading completes */}
                        {!regionDossierLoading && regionDossier && !dossierModal && (
                            <Popup
                                longitude={selectedEntity.extra.lng}
                                latitude={selectedEntity.extra.lat}
                                closeButton={false}
                                closeOnClick={false}
                                onClose={() => onEntityClick(null)}
                                anchor="bottom"
                                offset={20}
                            >
                                <div className="map-popup border border-emerald-500/40 bg-black/90 min-w-[180px]">
                                    <div className="map-popup-title text-emerald-400 border-b border-emerald-500/20 pb-1 text-[10px] tracking-widest flex justify-between items-center">
                                        <span>INTEL TARGET</span>
                                        <button onClick={() => onEntityClick(null)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] ml-2">✕</button>
                                    </div>
                                    <div className="flex flex-col gap-1.5 mt-2">
                                        <button
                                            onClick={() => setDossierModal('sentinel')}
                                            disabled={!regionDossier.sentinel2?.found}
                                            className={`flex items-center gap-2 px-3 py-2 rounded border text-[10px] font-mono tracking-wider transition-colors ${
                                                regionDossier.sentinel2?.found
                                                    ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-950/40 cursor-pointer'
                                                    : 'border-[var(--border-primary)] text-[var(--text-muted)] opacity-40 cursor-not-allowed'
                                            }`}
                                        >
                                            <span>🛰️</span> SENTINEL IMAGERY
                                        </button>
                                        <button
                                            onClick={() => setDossierModal('weather')}
                                            disabled={!regionDossier.weather}
                                            className={`flex items-center gap-2 px-3 py-2 rounded border text-[10px] font-mono tracking-wider transition-colors ${
                                                regionDossier.weather
                                                    ? 'border-cyan-500/40 text-cyan-400 hover:bg-cyan-950/40 cursor-pointer'
                                                    : 'border-[var(--border-primary)] text-[var(--text-muted)] opacity-40 cursor-not-allowed'
                                            }`}
                                        >
                                            <span>🌤️</span> LOCAL WEATHER
                                        </button>
                                    </div>
                                </div>
                            </Popup>
                        )}
                        {regionDossierLoading && (
                            <Popup
                                longitude={selectedEntity.extra.lng}
                                latitude={selectedEntity.extra.lat}
                                closeButton={false} closeOnClick={false}
                                anchor="bottom" offset={20}
                            >
                                <div className="map-popup border border-emerald-500/30 bg-black/90">
                                    <span className="text-emerald-400 text-[9px] font-mono animate-pulse tracking-widest">COMPILING...</span>
                                </div>
                            </Popup>
                        )}
                    </>
                )}

                {/* SENTINEL-2 IMAGERY — fullscreen overlay modal */}
                {dossierModal === 'sentinel' && selectedEntity?.type === 'region_dossier' && selectedEntity.extra && regionDossier?.sentinel2 && (() => {
                    const s2 = regionDossier.sentinel2;
                    const imgUrl = s2.fullres_url || s2.thumbnail_url;
                    return (
                        <div
                            style={{
                                position: 'fixed',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                zIndex: 9999,
                                background: 'rgba(0,0,0,0.85)',
                                backdropFilter: 'blur(8px)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '60px 20px 80px 20px',
                            }}
                            onClick={(e) => { if (e.target === e.currentTarget) setDossierModal(null); }}
                            onKeyDown={(e: any) => { if (e.key === 'Escape') setDossierModal(null); }}
                            tabIndex={-1}
                            ref={(el) => el?.focus()}
                        >
                            <div style={{
                                background: 'rgba(0,0,0,0.95)',
                                border: '1px solid rgba(34,197,94,0.5)',
                                borderRadius: 12,
                                overflow: 'hidden',
                                maxWidth: 'calc(100vw - 40px)',
                                maxHeight: 'calc(100vh - 80px)',
                                display: 'flex',
                                flexDirection: 'column',
                                boxShadow: '0 0 60px rgba(34,197,94,0.3)',
                            }}>
                                {/* Header bar */}
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '10px 16px',
                                    background: 'rgba(20,83,45,0.4)',
                                    borderBottom: '1px solid rgba(34,197,94,0.3)',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', animation: 'pulse 2s infinite' }} />
                                        <span style={{ fontSize: 11, color: '#4ade80', fontFamily: 'monospace', letterSpacing: '0.2em', fontWeight: 'bold' }}>
                                            SENTINEL-2 IMAGERY
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <span style={{ fontSize: 10, color: 'rgba(134,239,172,0.6)', fontFamily: 'monospace' }}>
                                            {selectedEntity.extra.lat.toFixed(4)}, {selectedEntity.extra.lng.toFixed(4)}
                                        </span>
                                        <button
                                            onClick={() => setDossierModal(null)}
                                            style={{
                                                background: 'rgba(239,68,68,0.2)',
                                                border: '1px solid rgba(239,68,68,0.4)',
                                                borderRadius: 6,
                                                color: '#ef4444',
                                                fontSize: 10,
                                                fontFamily: 'monospace',
                                                padding: '4px 10px',
                                                cursor: 'pointer',
                                                letterSpacing: '0.1em',
                                            }}
                                        >
                                            ✕ CLOSE
                                        </button>
                                    </div>
                                </div>

                                {s2.found ? (
                                    <>
                                        {/* Metadata row */}
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            padding: '8px 16px',
                                            fontSize: 11,
                                            fontFamily: 'monospace',
                                            borderBottom: '1px solid rgba(20,83,45,0.4)',
                                        }}>
                                            <span style={{ color: '#86efac' }}>{s2.platform}</span>
                                            <span style={{ color: '#4ade80', fontWeight: 'bold' }}>{s2.datetime?.slice(0, 10)}</span>
                                            <span style={{ color: '#86efac' }}>{s2.cloud_cover?.toFixed(0)}% cloud</span>
                                        </div>

                                        {/* Zoomable/pannable image viewer */}
                                        {imgUrl ? (() => {
                                            // Inline zoom/pan state via refs for performance
                                            const containerRef = React.createRef<HTMLDivElement>();
                                            const stateRef = { scale: 1, panX: 0, panY: 0, dragging: false, lastX: 0, lastY: 0 };

                                            const applyTransform = () => {
                                                const el = containerRef.current?.querySelector('img') as HTMLImageElement | null;
                                                if (el) el.style.transform = `translate(${stateRef.panX}px, ${stateRef.panY}px) scale(${stateRef.scale})`;
                                            };

                                            const handleWheel = (e: React.WheelEvent) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                const delta = e.deltaY > 0 ? 0.85 : 1.18;
                                                const newScale = Math.min(20, Math.max(0.1, stateRef.scale * delta));
                                                // Zoom toward cursor position
                                                const rect = containerRef.current?.getBoundingClientRect();
                                                if (rect) {
                                                    const cx = e.clientX - rect.left - rect.width / 2;
                                                    const cy = e.clientY - rect.top - rect.height / 2;
                                                    const ratio = 1 - newScale / stateRef.scale;
                                                    stateRef.panX += (cx - stateRef.panX) * ratio;
                                                    stateRef.panY += (cy - stateRef.panY) * ratio;
                                                }
                                                stateRef.scale = newScale;
                                                applyTransform();
                                            };

                                            const handleMouseDown = (e: React.MouseEvent) => {
                                                if (e.button !== 0) return;
                                                stateRef.dragging = true;
                                                stateRef.lastX = e.clientX;
                                                stateRef.lastY = e.clientY;
                                                e.preventDefault();
                                            };

                                            const handleMouseMove = (e: React.MouseEvent) => {
                                                if (!stateRef.dragging) return;
                                                stateRef.panX += e.clientX - stateRef.lastX;
                                                stateRef.panY += e.clientY - stateRef.lastY;
                                                stateRef.lastX = e.clientX;
                                                stateRef.lastY = e.clientY;
                                                applyTransform();
                                            };

                                            const handleMouseUp = () => { stateRef.dragging = false; };

                                            const resetView = () => {
                                                stateRef.scale = 1; stateRef.panX = 0; stateRef.panY = 0;
                                                applyTransform();
                                            };

                                            const zoomIn = () => { stateRef.scale = Math.min(20, stateRef.scale * 1.5); applyTransform(); };
                                            const zoomOut = () => { stateRef.scale = Math.max(0.1, stateRef.scale / 1.5); applyTransform(); };

                                            const zoomBtnStyle: React.CSSProperties = {
                                                background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(34,197,94,0.5)',
                                                borderRadius: 4, color: '#4ade80', fontSize: 14, fontFamily: 'monospace',
                                                width: 28, height: 28, cursor: 'pointer', display: 'flex',
                                                alignItems: 'center', justifyContent: 'center',
                                            };

                                            return (
                                                <div
                                                    ref={containerRef}
                                                    style={{
                                                        flex: 1, overflow: 'hidden', position: 'relative',
                                                        cursor: 'grab', minHeight: 400,
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    }}
                                                    onWheel={handleWheel}
                                                    onMouseDown={handleMouseDown}
                                                    onMouseMove={handleMouseMove}
                                                    onMouseUp={handleMouseUp}
                                                    onMouseLeave={handleMouseUp}
                                                >
                                                    <img
                                                        src={imgUrl}
                                                        alt="Sentinel-2 scene"
                                                        draggable={false}
                                                        style={{
                                                            maxWidth: '100%',
                                                            maxHeight: 'calc(100vh - 220px)',
                                                            objectFit: 'contain',
                                                            display: 'block',
                                                            transformOrigin: 'center center',
                                                            transition: 'none',
                                                            userSelect: 'none',
                                                        }}
                                                    />
                                                    {/* Zoom controls */}
                                                    <div style={{
                                                        position: 'absolute', bottom: 12, right: 12,
                                                        display: 'flex', flexDirection: 'column', gap: 4,
                                                    }}>
                                                        <button onClick={zoomIn} style={zoomBtnStyle} title="Zoom in">+</button>
                                                        <button onClick={zoomOut} style={zoomBtnStyle} title="Zoom out">−</button>
                                                        <button onClick={resetView} style={{ ...zoomBtnStyle, fontSize: 10 }} title="Reset view">⟲</button>
                                                    </div>
                                                </div>
                                            );
                                        })() : (
                                            <div style={{ padding: '40px 16px', fontSize: 11, color: 'rgba(134,239,172,0.5)', fontFamily: 'monospace', textAlign: 'center' }}>
                                                Scene found — no preview available
                                            </div>
                                        )}

                                        {/* Action buttons */}
                                        {imgUrl && (
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: 12,
                                                padding: '10px 16px',
                                                background: 'rgba(20,83,45,0.3)',
                                                borderTop: '1px solid rgba(34,197,94,0.2)',
                                            }}>
                                                <a
                                                    href={imgUrl}
                                                    download={`sentinel2_${selectedEntity.extra.lat.toFixed(4)}_${selectedEntity.extra.lng.toFixed(4)}.jpg`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{
                                                        background: 'rgba(34,197,94,0.2)',
                                                        border: '1px solid rgba(34,197,94,0.5)',
                                                        borderRadius: 6,
                                                        color: '#4ade80',
                                                        fontSize: 10,
                                                        fontFamily: 'monospace',
                                                        padding: '6px 16px',
                                                        cursor: 'pointer',
                                                        textDecoration: 'none',
                                                        letterSpacing: '0.15em',
                                                        fontWeight: 'bold',
                                                    }}
                                                >
                                                    ⬇ DOWNLOAD
                                                </a>
                                                <button
                                                    onClick={async () => {
                                                        try {
                                                            const resp = await fetch(imgUrl);
                                                            const blob = await resp.blob();
                                                            await navigator.clipboard.write([
                                                                new ClipboardItem({ [blob.type]: blob })
                                                            ]);
                                                        } catch {
                                                            // fallback: copy URL
                                                            await navigator.clipboard.writeText(imgUrl);
                                                        }
                                                    }}
                                                    style={{
                                                        background: 'rgba(34,197,94,0.15)',
                                                        border: '1px solid rgba(34,197,94,0.4)',
                                                        borderRadius: 6,
                                                        color: '#4ade80',
                                                        fontSize: 10,
                                                        fontFamily: 'monospace',
                                                        padding: '6px 16px',
                                                        cursor: 'pointer',
                                                        letterSpacing: '0.15em',
                                                        fontWeight: 'bold',
                                                    }}
                                                >
                                                    📋 COPY
                                                </button>
                                                <a
                                                    href={imgUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{
                                                        background: 'rgba(16,185,129,0.15)',
                                                        border: '1px solid rgba(16,185,129,0.4)',
                                                        borderRadius: 6,
                                                        color: '#10b981',
                                                        fontSize: 10,
                                                        fontFamily: 'monospace',
                                                        padding: '6px 16px',
                                                        cursor: 'pointer',
                                                        textDecoration: 'none',
                                                        letterSpacing: '0.15em',
                                                        fontWeight: 'bold',
                                                    }}
                                                >
                                                    ↗ OPEN FULL RES
                                                </a>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div style={{ padding: '40px 16px', fontSize: 11, color: 'rgba(134,239,172,0.5)', fontFamily: 'monospace', textAlign: 'center' }}>
                                        No clear imagery in last 30 days
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })()}

                {/* WEATHER MODAL — fullscreen weather widget */}
                {dossierModal === 'weather' && selectedEntity?.type === 'region_dossier' && selectedEntity.extra && regionDossier?.weather && (
                    <WeatherModal
                        weather={regionDossier.weather}
                        lat={selectedEntity.extra.lat}
                        lng={selectedEntity.extra.lng}
                        locationName={regionDossier?.location?.city || regionDossier?.location?.display_name}
                        onClose={() => setDossierModal(null)}
                    />
                )}

                {/* MEASUREMENT LINES */}
                {measurePoints && measurePoints.length >= 2 && (
                    <Source id="measure-lines" type="geojson" data={{
                        type: 'FeatureCollection',
                        features: [{
                            type: 'Feature',
                            properties: {},
                            geometry: {
                                type: 'LineString',
                                coordinates: measurePoints.map((p: any) => [p.lng, p.lat])
                            }
                        }]
                    } as any}>
                        <Layer
                            id="measure-lines-layer"
                            type="line"
                            paint={{
                                'line-color': '#00ffff',
                                'line-width': 2,
                                'line-dasharray': [4, 3],
                                'line-opacity': 0.8,
                            }}
                        />
                    </Source>
                )}

                {/* MEASUREMENT WAYPOINTS */}
                {measurePoints && measurePoints.map((pt: any, idx: number) => (
                    <Marker key={`measure-${idx}`} longitude={pt.lng} latitude={pt.lat} anchor="center">
                        <div className="flex flex-col items-center pointer-events-none">
                            <div className="w-6 h-6 rounded-full border-2 border-cyan-400 animate-ping absolute opacity-20" />
                            <div className="w-4 h-4 rounded-full bg-cyan-500 border-2 border-cyan-300 shadow-[0_0_12px_rgba(0,255,255,0.6)] flex items-center justify-center">
                                <span className="text-[7px] font-mono font-bold text-black">{idx + 1}</span>
                            </div>
                        </div>
                    </Marker>
                ))}

            </Map>
            {/* CCTV seed loading indicator */}
            {cctvLoading && (
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[300] pointer-events-none">
                    <div className="border border-emerald-500/40 bg-black/85 backdrop-blur-sm px-5 py-2 rounded">
                        <span className="text-emerald-400 text-[10px] font-mono animate-pulse tracking-widest">COMPILING CCTV MESH...</span>
                    </div>
                </div>
            )}
        </div>
    );
}

import dynamic from "next/dynamic";

export default dynamic(() => Promise.resolve(MaplibreViewer), {
    ssr: false
});
