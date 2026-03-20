# Cloudflare Radar Integration — Feature Spec

**Branch:** `internet`
**API Reference:** https://developers.cloudflare.com/api/resources/radar/
**Auth:** Bearer token — free for research use, create at dash.cloudflare.com (Account > Radar > Read)
**Env var:** `CLOUDFLARE_RADAR_TOKEN`

---

## Design Principles

All features follow the same bolt-on pattern established by Pikud HaOref and Ukraine Alerts:

- Backend fetcher module in `backend/services/fetchers/` — self-contained, gated on env var
- SQLite persistence at `/app/data/<signal>.db` on the Docker volume
- In-memory ring buffer for fast live delivery via `/api/live-data/fast`
- History and range API endpoints at `/api/<signal>/history` and `/api/<signal>/range`
- Listener collector in `listener/collectors/` — always-on archive on the sensors LXC
- Conflict registry entry in `listener/config/conflicts.yaml`
- Backfill on startup from listener — paginated, no time limit, no-op if unreachable
- Frontend layer in WorldviewLeftPanel with 24h scrubber, play/pause, ARCHIVE drill-down modal
- `CLOUDFLARE_RADAR_TOKEN` wired through `docker-compose.yml` and `.env.example`
- All features degrade gracefully to no-op if token is absent

---

## Feature 1 — BGP Anomalies

**Signal name:** `bgp_anomalies`
**Source endpoints:**
- `GET /radar/bgp/hijacks/events` — BGP prefix hijack events
- `GET /radar/bgp/leaks/events` — BGP route leak events

**What it shows:**
BGP hijacks occur when an ASN fraudulently announces IP prefixes it does not own, redirecting traffic through attacker-controlled infrastructure. Route leaks occur when a BGP peer re-advertises routes it should not, causing traffic to flow through unintended paths. Both are used in state-sponsored operations and infrastructure attacks.

**Data fields to persist:**
- `id` — event ID from CF
- `type` — `hijack` or `leak`
- `ts` — event start Unix timestamp
- `hijacker_asn` / `leaker_asn` — ASN number responsible
- `victim_asn` — ASN whose prefixes were affected
- `hijacker_country` / `victim_country` — ISO country codes (resolved from ASN)
- `hijacker_lat`, `hijacker_lng` / `victim_lat`, `victim_lng` — country centroids for map rendering
- `affected_prefixes` — list of IP prefixes affected (stored as JSON string)
- `confidence_score` — CF confidence 1–10
- `peer_count` — number of BGP peers that observed the event
- `event_type` — for leaks: leak path classification

**Map rendering:**
- Rendered as arcs from hijacker country centroid → victim country centroid
- Hijacks: red arcs (`#ef4444`)
- Leaks: orange arcs (`#f97316`)
- Arc thickness proportional to peer_count
- Dot markers at both endpoints
- Label shows ASN numbers at zoom ≥ 4
- Age decay: events older than 24h fade to 30% opacity

**Frontend layer:**
- Layer ID: `bgp_anomalies`
- Layer name: "BGP Anomalies"
- Source: "Cloudflare Radar"
- Count: number of events in last 24h
- Color accent: red/orange split
- 24h scrubber, play/pause, ARCHIVE drill-down

**Poll cadence:** Every 15 minutes (CF updates BGP data from MRT archives every 2 hours, but polling more frequently catches newly published events sooner)

**Listener:** Yes — BGP hijacks are high-value historical signals. Archive indefinitely.

---

## Feature 2 — Cloudflare Traffic Anomalies

**Signal name:** `cf_anomalies`
**Source endpoint:** `GET /radar/traffic_anomalies`

**What it shows:**
Cloudflare automatically detects significant drops or spikes in traffic volume per country, indicating potential internet shutdowns, infrastructure failures, or censorship events. This is complementary to the existing IODA layer (Georgia Tech) — CF has broader coverage and faster detection due to operating the world's largest CDN.

**Data fields to persist:**
- `id` — derived from `location_code + ts`
- `ts` — anomaly start Unix timestamp
- `location` — ISO country code
- `location_name` — full country name
- `lat`, `lng` — country centroid
- `type` — `ANOMALY` (CF only exposes one type currently)
- `status` — `ONGOING` or `CLOSED`
- `description` — CF-provided description string if available
- `value` — traffic deviation magnitude if provided

**Map rendering:**
- Rendered as pulsing circle markers at country centroid
- Ongoing: bright yellow-orange (`#f59e0b`) with pulse animation
- Closed/historical: muted amber at 50% opacity
- Label shows country name at zoom ≥ 3

**Relationship to existing IODA layer:**
Keep as a separate layer (`cf_anomalies`) rather than merging into `internet_outages`. Both are visible independently — users can compare IODA (academic, BGP+telescope signals) vs CF (commercial CDN traffic). Shared toggle group in the UI under a logical "Internet Health" section is desirable but not required in v1.

**Poll cadence:** Every 5 minutes

**Listener:** Yes — internet shutdown events are high-value. Archive indefinitely.

---

## Feature 3 — Active DDoS Attacks

**Signal name:** `active_ddos`
**Source endpoints:**
- `GET /radar/attacks/layer7/top/attacks` — top L7 (application) attack source→target pairs
- `GET /radar/attacks/layer3/summary/protocol` — L3 (network) attack protocol breakdown

**What it shows:**
The current top DDoS attack flows by source and target country, updated regularly. Useful for observing coordinated cyberattack campaigns, which frequently accompany physical conflict escalation.

**Data fields to persist (L7):**
- `id` — derived from `origin_country + target_country + ts`
- `ts` — timestamp of data retrieval
- `origin_country` — ISO code of attack origin
- `target_country` — ISO code of attack target
- `origin_lat`, `origin_lng` — origin country centroid
- `target_lat`, `target_lng` — target country centroid
- `requests_percent` — share of total attack traffic this pair represents
- `layer` — `L7`

**Data fields to persist (L3):**
- `id` — derived from `ts + protocol`
- `ts`
- `protocol` — `UDP`, `TCP`, `ICMP`, `GRE`
- `percent` — share of L3 attack traffic

**Map rendering:**
- Rendered as animated arcs from origin centroid → target centroid
- Arc color by layer: L7 = `#8b5cf6` (purple), L3 = `#06b6d4` (cyan)
- Arc opacity proportional to `requests_percent`
- Arrowhead or gradient on arc to indicate direction
- Tooltip shows origin → target country names + attack share %
- Note: CF notes L3 location is based on data center, not spoofed source — this is a known limitation, display accordingly

**No historical value:** Ring buffer only — no SQLite persistence, no listener collector. DDoS attack flows are transient and do not benefit from archiving. The scrubber is not applicable for this layer.

**Poll cadence:** Every 5 minutes

**Listener:** No

---

## Feature 4 — Internet Quality Index (IQI)

**Signal name:** `internet_quality`
**Source endpoint:** `GET /radar/quality/iqi/summary`

**What it shows:**
Cloudflare's Internet Quality Index provides per-country baseline metrics for bandwidth, latency, and DNS response time. In isolation this is informational, but deviations from baseline are a leading indicator of infrastructure stress or degradation — useful context alongside the anomaly and outage layers.

**Data fields (not persisted — summary only, no history value):**
- `location` — ISO country code
- `bandwidth_download` — Mbps median download
- `latency` — ms median RTT
- `dns_response_time` — ms median DNS RTT
- `jitter` — ms

**Usage:**
Not a map layer. Expose as a data enrichment source — when a user clicks on a country in the BGP anomalies or CF anomalies layer, the detail panel can include current IQI metrics as context. No separate layer toggle needed.

**Poll cadence:** Every 30 minutes (data is slow-moving)

**No listener, no persistence, no scrubber.**

---

## Implementation Order

1. **BGP Anomalies** — highest geopolitical signal value, most unique data not available elsewhere
2. **CF Traffic Anomalies** — augments existing IODA layer, straightforward implementation
3. **Active DDoS Arcs** — visually impactful, good map layer
4. **IQI enrichment** — lowest effort, adds context to existing click-through panels

---

## Files to Create / Modify

### New files
| File | Purpose |
|------|---------|
| `backend/services/fetchers/cloudflare_radar.py` | All three fetcher functions + DB helpers |
| `listener/collectors/cloudflare_bgp.py` | BGP anomalies listener collector |
| `listener/collectors/cloudflare_anomalies.py` | CF traffic anomalies listener collector |
| `frontend/src/components/BgpDrilldownModal.tsx` | Archive drill-down for BGP anomalies |
| `frontend/src/components/CfAnomalyDrilldownModal.tsx` | Archive drill-down for CF anomalies |
| `docs/todo-cloudflare.md` | This file |

### Modified files
| File | Change |
|------|--------|
| `backend/services/fetchers/_store.py` | Add `bgp_anomalies`, `cf_anomalies`, `active_ddos` keys |
| `backend/services/data_fetcher.py` | Import and schedule new fetchers, init DBs, backfill |
| `backend/main.py` | Add history + range endpoints, add to fast/slow payload |
| `backend/.env.example` | Document `CLOUDFLARE_RADAR_TOKEN` |
| `docker-compose.yml` | Wire `CLOUDFLARE_RADAR_TOKEN` env var |
| `listener/config/conflicts.yaml` | Add bgp and cf_anomalies collector entries |
| `listener/.env.example` | Document `CLOUDFLARE_RADAR_TOKEN` |
| `frontend/src/types/dashboard.ts` | Add `BgpAnomaly`, `CfAnomaly`, `DdosAttack` types + `ActiveLayers` entries |
| `frontend/src/app/page.tsx` | Add scrubber state + history fetch for BGP + CF anomalies |
| `frontend/src/components/MaplibreViewer.tsx` | Add GeoJSON memos + Source/Layer renders for all three layers |
| `frontend/src/components/WorldviewLeftPanel.tsx` | Add layer entries, freshness map, scrubbers, drill-down buttons |

---

## Open Questions

- **Arc rendering:** MapLibre GL JS does not natively support curved arcs. Options: (a) use `turf.greatCircle` to generate arc linestrings, (b) render as straight lines between centroids (simpler, less visually distinct). Decision needed before implementation.
- **Country centroids:** Need a country ISO → lat/lng lookup. Can reuse the same pattern as `OBLAST_GEO` in ukraine_alerts.py, or pull from a static JSON. A full world country centroids file (~250 entries) should be added to `backend/data/` as a shared resource.
- **CF anomaly location granularity:** CF currently reports anomalies at country level only. Sub-national granularity is not available.
- **L3 DDoS location caveat:** Cloudflare explicitly notes L3 source location reflects their data center location, not the true attack origin. UI should display a disclaimer on this layer.
