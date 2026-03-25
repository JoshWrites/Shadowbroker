# Plan: Demand-Driven Layer Fetching + Error Tolerance

## Problem

1. Backend fetches all ~35 data sources on fixed schedules regardless of whether anyone is viewing them — wastes outbound traffic to third-party APIs
2. Frontend white-screens when backend drops connections — socket errors cascade into dead Next.js server process
3. No user-visible error state per layer — failures are silently logged to console

## Goals

- Layers default to OFF (already the case)
- Backend only fetches from external sources when a layer is actively requested by the frontend
- Frontend displays per-layer error state: "Error — manually cycle to try again"
- No automated retry on errors — user toggles layer off then on to retry
- Frontend never crashes on fetch errors — catch everything, display error badge

## Architecture Changes

### Backend (FastAPI + APScheduler)

**Demand tracking:**
- New in-memory dict `active_layers: dict[str, float]` — maps layer ID to last-requested timestamp
- `/api/live-data/fast` and `/api/live-data/slow` accept new query param `?layers=flights,military,...`
- On each request, update `active_layers[layer_id] = now()` for each requested layer
- Response only includes data for requested layers (plus always-on lightweight fields like `freshness`)

**Scheduler becomes conditional:**
- Each scheduled fetcher checks `active_layers` before running — skip if layer hasn't been requested in the last 2x the fetch interval (e.g., skip `fetch_flights` if no one has requested `flights` in the last 120s)
- Pikud WebSocket listener is an exception — always runs (critical alerting, low bandwidth)
- CCTV already has this pattern (lazy seed) — generalize it

**Layer-to-fetcher mapping:**
- Define a `LAYER_FETCHER_MAP` that maps frontend layer IDs to backend fetcher functions and their data keys
- This replaces the implicit coupling between layer IDs, data keys, and fetcher schedules

### Frontend (Next.js + useDataPolling)

**Pass active layers to backend:**
- `useDataPolling` accepts `activeLayers` as a parameter
- Builds `?layers=...` query string from currently-on layers
- Sends with each fast/slow poll

**Per-layer error tracking:**
- New state: `layerErrors: Record<string, string | null>`
- On fetch success: clear errors for all layers in the response
- On fetch failure: set error for all currently-requested layers
- Toggling a layer OFF clears its error state
- Toggling a layer ON triggers an immediate fetch (not waiting for next poll cycle)

**Layer list UI (WorldviewLeftPanel):**
- Error layers show red badge: "Error — manually cycle to try again"
- Error badge replaces the count/freshness display for that layer
- No spinner, no retry button — just the message

**Crash prevention:**
- Wrap all fetch calls in try/catch at the top level
- Never let a failed JSON parse or network error propagate beyond the polling hook
- Backend status indicator: connected / disconnected (already exists), but now per-layer granularity

### Signal Archive: Switch to CT107

- `LISTENER_URL` in `.env` already points to `http://10.100.102.107:7654`
- Rebuild Shadowbroker containers after implementing the above
- Backend backfills pikud_alerts from CT107 on startup (CT107 now has data back to Feb 28)
- CT106 continues running independently as fallback until CT107 proves stable

## Migration Steps

1. Implement backend `?layers=` filtering on `/api/live-data/fast` and `/api/live-data/slow`
2. Add demand tracking to scheduler — skip fetchers for inactive layers
3. Update `useDataPolling` to pass active layers and handle per-layer errors
4. Add error badge UI to `WorldviewLeftPanel`
5. Wrap all frontend fetch paths in defensive try/catch
6. Rebuild Shadowbroker (`docker compose up --build`) — picks up CT107 as LISTENER_URL
7. Verify pikud backfill from CT107, verify on-demand fetching works, verify error display

## Files to Modify

- `backend/main.py` — add `layers` query param to fast/slow endpoints, filter response
- `backend/services/data_fetcher.py` — conditional scheduling based on `active_layers`
- `backend/services/fetchers/_store.py` — add `active_layers` dict and helper
- `frontend/src/hooks/useDataPolling.ts` — accept activeLayers, build query string, per-layer error tracking
- `frontend/src/components/WorldviewLeftPanel.tsx` — error badge UI
- `frontend/src/app/page.tsx` — wire `layerErrors` through to panel

## Out of Scope

- Persisting layer preferences across sessions (future: localStorage)
- Rate limiting per-source (future: if API providers complain)
- Backend-side error reporting per fetcher (future: structured error responses)
