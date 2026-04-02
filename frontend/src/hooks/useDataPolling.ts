import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { API_BASE } from "@/lib/api";

export type BackendStatus = 'connecting' | 'connected' | 'disconnected';
export type LayerErrorState = 'retrying' | 'failed';

/**
 * Event name dispatched by page.tsx when a layer toggle changes.
 * useDataPolling listens for this to immediately refetch slow-tier data
 * so toggled layers (power plants, GDELT, etc.) appear without the usual
 * 120-second wait.
 */
export const LAYER_TOGGLE_EVENT = 'sb:layer-toggle';

const MAX_RETRIES = 3;

// Which frontend layer IDs belong to the fast polling tier
const FAST_LAYERS = new Set([
  "flights", "private", "jets", "military", "tracked",
  "satellites", "trains", "cctv", "gps_jamming", "global_incidents",
  "ships_military", "ships_cargo", "ships_civilian", "ships_passenger", "ships_tracked_yachts",
  "pikud_alerts", "ukraine_alerts",
  "sigint_meshtastic", "sigint_aprs",
]);

// Which frontend layer IDs belong to the slow polling tier
const SLOW_LAYERS = new Set([
  "earthquakes", "ukraine_frontline", "global_incidents",
  "kiwisdr", "internet_outages", "firms", "datacenters", "military_bases",
  "bgp_anomalies", "cf_anomalies", "active_ddos",
  "power_plants", "satnogs", "tinygs", "psk_reporter", "scanners",
  "weather_alerts", "air_quality", "volcanoes", "fishing_activity",
  "correlations", "viirs_nightlights", "shodan_overlay", "sentinel_hub",
]);

/**
 * Demand-driven polling: only fetches data tiers that have at least one
 * active layer, and tells the backend which layers are on so it can trim
 * the response payload.  Zero network traffic on cold load.
 *
 * Error tolerance: each tier retries up to 3 times on consecutive failures,
 * then marks its layers as 'failed' and stops polling. Toggling a failed
 * layer off then on resets the error state and restarts polling.
 */
export function useDataPolling(activeLayers: Record<string, boolean>) {
  const dataRef = useRef<any>({});
  const [dataVersion, setDataVersion] = useState(0);
  const data = dataRef.current;

  const [backendStatus, setBackendStatus] = useState<BackendStatus>('connecting');
  const [layerErrors, setLayerErrors] = useState<Record<string, LayerErrorState>>({});

  const fastEtag = useRef<string | null>(null);
  const slowEtag = useRef<string | null>(null);

  // Track which tiers have been halted due to max retries.
  // When the layer CSV changes (user toggled something), the halt is cleared
  // because the useEffect re-runs from scratch.
  const fastHalted = useRef(false);
  const slowHalted = useRef(false);

  // Helper: set error state for all active layers in a tier
  const setTierError = useCallback((tier: 'fast' | 'slow', state: LayerErrorState | null) => {
    const tierSet = tier === 'fast' ? FAST_LAYERS : SLOW_LAYERS;
    setLayerErrors(prev => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(activeLayers)) {
        if (v && tierSet.has(k)) {
          if (state) {
            next[k] = state;
          } else {
            delete next[k];
          }
        }
      }
      return next;
    });
  }, [activeLayers]);

  // Derive which layers are active in each tier (stable string for dep array)
  const fastLayersCSV = useMemo(() => {
    const active = Object.entries(activeLayers)
      .filter(([k, v]) => v && FAST_LAYERS.has(k))
      .map(([k]) => k)
      .sort()
      .join(",");
    return active;
  }, [activeLayers]);

  const slowLayersCSV = useMemo(() => {
    const active = Object.entries(activeLayers)
      .filter(([k, v]) => v && SLOW_LAYERS.has(k))
      .map(([k]) => k)
      .sort()
      .join(",");
    return active;
  }, [activeLayers]);

  // ── Fast tier polling ──
  useEffect(() => {
    if (!fastLayersCSV) {
      setBackendStatus(prev => prev === 'disconnected' ? 'disconnected' : prev);
      return;
    }

    // Layer set changed → clear halt and errors for this tier
    fastHalted.current = false;
    setTierError('fast', null);

    let hasData = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let consecutiveFailures = 0;

    fastEtag.current = null;

    const fetchData = async () => {
      if (cancelled || fastHalted.current) return;
      try {
        const headers: Record<string, string> = {};
        if (fastEtag.current) headers['If-None-Match'] = fastEtag.current;
        const res = await fetch(
          `${API_BASE}/api/live-data/fast?layers=${encodeURIComponent(fastLayersCSV)}`,
          { headers },
        );
        if (cancelled) return;
        if (res.status === 304) {
          consecutiveFailures = 0;
          setTierError('fast', null);
          setBackendStatus('connected');
          scheduleNext();
          return;
        }
        if (res.ok) {
          consecutiveFailures = 0;
          setTierError('fast', null);
          setBackendStatus('connected');
          fastEtag.current = res.headers.get('etag') || null;
          const json = await res.json();
          dataRef.current = { ...dataRef.current, ...json };
          setDataVersion(v => v + 1);
          const flights = json.commercial_flights?.length || 0;
          if (flights > 100) hasData = true;
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (e) {
        if (cancelled) return;
        consecutiveFailures++;
        console.error(`[fast tier] fetch error (${consecutiveFailures}/${MAX_RETRIES})`, e);

        if (consecutiveFailures >= MAX_RETRIES) {
          fastHalted.current = true;
          setTierError('fast', 'failed');
          setBackendStatus('disconnected');
          return; // stop polling
        }
        setTierError('fast', 'retrying');
        setBackendStatus('disconnected');
      }
      scheduleNext();
    };

    const scheduleNext = () => {
      if (cancelled || fastHalted.current) return;
      let delay = 3000;
      if (hasData && consecutiveFailures === 0) {
        const pikudFresh = dataRef.current?.freshness?.pikud_alerts;
        if (pikudFresh) {
          const lastPoll = new Date(pikudFresh + 'Z').getTime();
          const nextFetch = lastPoll + 5000 + 1500;
          delay = Math.max(500, nextFetch - Date.now());
        } else {
          delay = 6500;
        }
      } else if (consecutiveFailures > 0) {
        // Back off on retries: 3s, 6s, 9s
        delay = 3000 * consecutiveFailures;
      }
      timerId = setTimeout(fetchData, delay);
    };

    fetchData();

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [fastLayersCSV, setTierError]);

  // ── Slow tier polling ──
  useEffect(() => {
    if (!slowLayersCSV) return;

    // Layer set changed → clear halt and errors for this tier
    slowHalted.current = false;
    setTierError('slow', null);

    let hasData = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let consecutiveFailures = 0;

    slowEtag.current = null;

    const fetchData = async () => {
      if (cancelled || slowHalted.current) return;
      try {
        const headers: Record<string, string> = {};
        if (slowEtag.current) headers['If-None-Match'] = slowEtag.current;
        const res = await fetch(
          `${API_BASE}/api/live-data/slow?layers=${encodeURIComponent(slowLayersCSV)}`,
          { headers },
        );
        if (cancelled) return;
        if (res.status === 304) {
          consecutiveFailures = 0;
          setTierError('slow', null);
          scheduleNext();
          return;
        }
        if (res.ok) {
          consecutiveFailures = 0;
          setTierError('slow', null);
          slowEtag.current = res.headers.get('etag') || null;
          const json = await res.json();
          dataRef.current = { ...dataRef.current, ...json };
          setDataVersion(v => v + 1);
          hasData = true;
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (e) {
        if (cancelled) return;
        consecutiveFailures++;
        console.error(`[slow tier] fetch error (${consecutiveFailures}/${MAX_RETRIES})`, e);

        if (consecutiveFailures >= MAX_RETRIES) {
          slowHalted.current = true;
          setTierError('slow', 'failed');
          return; // stop polling
        }
        setTierError('slow', 'retrying');
      }
      scheduleNext();
    };

    const scheduleNext = () => {
      if (cancelled || slowHalted.current) return;
      let delay = hasData ? 120000 : 5000;
      if (consecutiveFailures > 0) {
        delay = 5000 * consecutiveFailures; // 5s, 10s, 15s
      }
      timerId = setTimeout(fetchData, delay);
    };

    fetchData();

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [slowLayersCSV, setTierError]);

  // ── Always fetch right-panel context data (news, stocks, weather, space_weather) ──
  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let hasData = false;
    let consecutiveFailures = 0;

    const fetchContext = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/live-data/slow?layers=_context`);
        if (cancelled) return;
        if (res.ok) {
          const json = await res.json();
          dataRef.current = { ...dataRef.current, ...json };
          setDataVersion(v => v + 1);
          setBackendStatus('connected');
          hasData = true;
          consecutiveFailures = 0;
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (e) {
        if (cancelled) return;
        consecutiveFailures++;
        console.error(`[context] fetch error (${consecutiveFailures}/${MAX_RETRIES})`, e);
        if (consecutiveFailures >= MAX_RETRIES) {
          setBackendStatus('disconnected');
          return; // stop — banner already shows BACKEND OFFLINE
        }
        setBackendStatus('disconnected');
      }
      if (!cancelled && consecutiveFailures < MAX_RETRIES) {
        const delay = consecutiveFailures > 0 ? 5000 * consecutiveFailures : (hasData ? 120000 : 5000);
        timerId = setTimeout(fetchContext, delay);
      }
    };

    fetchContext();

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, []);

  return { data, dataVersion, backendStatus, layerErrors };
}
