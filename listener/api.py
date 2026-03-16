"""Backfill API — exposes archived signal data for Shadowbroker to pull.

One endpoint pattern:
  GET /backfill/{signal}?from_ts=<unix>&until_ts=<unix>

  Returns: { signal, count, records: [{id, ts, lat, lng, payload}] }

Shadowbroker calls this at startup (and optionally on reconnect) to fill
gaps that occurred while the main app was offline.
"""
from fastapi import FastAPI, HTTPException, Query
from db import query_events, get_time_range

app = FastAPI(title="Signal Archive API", version="0.1.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/signals")
def list_signals():
    """List all signals that have data in the archive."""
    import os
    from pathlib import Path
    data_dir = Path("/data")
    signals = []
    if data_dir.exists():
        for db_file in data_dir.glob("*.db"):
            signal = db_file.stem
            signals.append({"signal": signal, **get_time_range(signal)})
    return {"signals": signals}


@app.get("/backfill/{signal}")
def backfill(
    signal: str,
    from_ts: float = Query(..., description="Start of range (Unix epoch)"),
    until_ts: float = Query(..., description="End of range (Unix epoch)"),
):
    """Return all archived events for a signal within [from_ts, until_ts]."""
    if until_ts < from_ts:
        raise HTTPException(status_code=400, detail="until_ts must be >= from_ts")
    if until_ts - from_ts > 7 * 24 * 3600:
        raise HTTPException(status_code=400, detail="Range too large (max 7 days)")

    records = query_events(signal, from_ts, until_ts)
    return {"signal": signal, "count": len(records), "records": records}


@app.get("/range/{signal}")
def signal_range(signal: str):
    """Return the time coverage for a signal (earliest, latest, count)."""
    return get_time_range(signal)
