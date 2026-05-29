# Plan: ACLED Conflict Event Collector

## What

Add an ACLED (Armed Conflict Location & Event Data) collector to the signal-archive system. ACLED provides geolocated, categorized conflict events across the entire Iran-Israel regional war — strikes on Iran, Iranian retaliation across 9+ countries, proxy actions by Hezbollah/Houthis/Iraqi militias, and civilian impact.

This fills a gap: Pikud HaOref only covers alerts *in Israel*. ACLED covers the full theater.

## Data Source

- **API**: `https://acleddata.com/api/acled/read` (REST, JSON)
- **Python package**: `pip install acled` (wraps the API)
- **Auth**: Free account + API key (email + key pair)
- **Rate limits**: 5,000 rows per request (paginate for more), no documented daily cap
- **Update frequency**: Daily (data published ~9am EST / 3pm CET)
- **Coverage**: Feb 28, 2026 onward for the current conflict; historical data available back years
- **Dedicated curated file**: `acleddata.com/curated/data-us-iran-regional-conflict-daily` — pre-filtered to the regional war

## Data Schema (ACLED fields we care about)

| Field | Description |
|-------|-------------|
| `event_id_cnty` | Unique event ID |
| `event_date` | Date (YYYY-MM-DD) |
| `event_type` | Battles, Explosions/Remote violence, Violence against civilians, Protests, Riots, Strategic developments |
| `sub_event_type` | e.g., Air/drone strike, Shelling/artillery, Missile attack |
| `actor1` | Who did it (e.g., "Military Forces of Iran", "Hezbollah") |
| `actor2` | Target/opponent |
| `country` | Where it happened |
| `admin1` | Province/state |
| `admin2` | District |
| `admin3` | Sub-district |
| `location` | Place name |
| `latitude` | Geo |
| `longitude` | Geo |
| `fatalities` | Reported fatalities |
| `notes` | Free-text description |
| `source` | Reporting source |
| `tags` | ACLED-assigned tags |

## Architecture

### Where it runs

**CT107** (signal-archive) — alongside the Pikud WebSocket collector. One container, two conflict signals.

### Collector design

- New file: `collectors/acled.py` — subclass of `BaseCollector`
- Signal name: `acled_events`
- Poll interval: Once daily (data only updates daily)
- On each poll: query ACLED API for events since last collected date
- Startup backfill: fetch all events from 2026-02-28 to present
- Store in `/data/acled_events.db` (generic events schema or dedicated table)

### API query strategy

```
# Daily incremental — fetch events since last collected date
GET /api/acled/read?
  country=Iran|Israel|Iraq|Yemen|Lebanon|UAE|Bahrain|Kuwait|Saudi Arabia|Oman|Qatar|Syria
  &event_type=Explosions/Remote violence|Battles|Violence against civilians
  &event_date={last_date}|{today}
  &event_date_where=BETWEEN
  &limit=5000
```

Filter to the regional theater (12 countries) and violent event types only. Skip protests/riots/strategic developments to keep the dataset focused on kinetic events.

### Backfill API endpoint

Expose via the existing signal-archive FastAPI on :7654:
```
GET /backfill/acled_events?from_ts=X&until_ts=Y
GET /range/acled_events
```

Shadowbroker backend can pull from this on startup, same pattern as Pikud backfill.

## Shadowbroker Integration

### Backend

- New fetcher module or extend existing geo fetcher
- On startup: backfill from CT107 signal-archive (`LISTENER_URL/backfill/acled_events`)
- Store in local SQLite for time-scrubber history queries
- Expose via `/api/live-data/slow` payload (new key: `acled_events`)

### Frontend

- New layer: "Regional Conflict Events" (or "ACLED Conflict")
- Render as colored markers on map: red for strikes, orange for battles, etc.
- Time scrubber for historical playback (same pattern as Pikud/Ukraine/BGP)
- Click for detail popup: date, actors, location, fatalities, description

## Configuration

Add to `conflicts.yaml` on CT107:
```yaml
acled_regional:
  enabled: true
  name: "Iran-Israel Regional Conflict (ACLED)"
  signal: "acled_events"
  collector: "acled"
  description: "Geolocated conflict events across the Iran-Israel regional war"
  poll_seconds: 86400  # once daily
  notes: "Requires ACLED_API_KEY and ACLED_EMAIL env vars"
```

Add to CT107 Docker environment:
```
ACLED_API_KEY=<key>
ACLED_EMAIL=<registered email>
```

## Dependencies

- `pip install acled` (add to requirements.txt)
- Free ACLED account with API key (pending)

## Implementation Order

1. Add `acled` to requirements.txt, rebuild CT107 Docker image
2. Write `collectors/acled.py` — BaseCollector subclass, daily poll + startup backfill
3. Add DB table/schema for acled_events in `db.py`
4. Add backfill API endpoints in `api.py`
5. Add to `conflicts.yaml`, set env vars
6. Test: verify data flows into DB, API serves it
7. Wire into Shadowbroker backend (new fetcher, backfill from listener)
8. Wire into Shadowbroker frontend (new layer, map markers, time scrubber)

## Out of Scope (for now)

- Protests/riots/strategic developments (non-kinetic events)
- Historical data before Feb 28, 2026
- Cross-referencing ACLED events with Pikud alerts (dedup overlap)
- Push notifications on new events (daily is fine)
