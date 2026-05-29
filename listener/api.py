"""Backfill API — exposes archived signal data for Shadowbroker to pull.

Endpoint patterns:
  GET /backfill/{signal}?from_ts=<unix>&until_ts=<unix>
  GET /backfill/pikud_alerts?from_ts=<unix>&until_ts=<unix>&msg_type=ALERT

  Returns: { signal, count, records: [...] }

Shadowbroker calls this at startup (and optionally on reconnect) to fill
gaps that occurred while the main app was offline.
"""
from fastapi import FastAPI, HTTPException, Query
from db import query_events, get_time_range, query_pikud, get_pikud_time_range

app = FastAPI(title="Signal Archive API", version="0.2.0")


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
            if signal == "pikud_alerts":
                signals.append({"signal": signal, **get_pikud_time_range()})
            else:
                signals.append({"signal": signal, **get_time_range(signal)})
    return {"signals": signals}


# ---------------------------------------------------------------------------
# Unified pikud_alerts endpoints
# ---------------------------------------------------------------------------

@app.get("/backfill/pikud_alerts")
def backfill_pikud(
    from_ts: float = Query(..., description="Start of range (Unix epoch)"),
    until_ts: float = Query(..., description="End of range (Unix epoch)"),
    msg_type: str | None = Query(None, description="Filter by msg_type (ALERT, SYSTEM_MESSAGE)"),
):
    """Return all pikud_alerts rows within [from_ts, until_ts]."""
    if until_ts < from_ts:
        raise HTTPException(status_code=400, detail="until_ts must be >= from_ts")
    records = query_pikud(from_ts, until_ts, msg_type=msg_type)
    return {"signal": "pikud_alerts", "count": len(records), "records": records}


@app.get("/range/pikud_alerts")
def pikud_range(
    msg_type: str | None = Query(None, description="Filter by msg_type"),
):
    """Return the time coverage for pikud_alerts."""
    return get_pikud_time_range(msg_type=msg_type)


# ---------------------------------------------------------------------------
# Generic signal endpoints (used by non-pikud signals like Ukraine)
# ---------------------------------------------------------------------------

@app.get("/backfill/{signal}")
def backfill(
    signal: str,
    from_ts: float = Query(..., description="Start of range (Unix epoch)"),
    until_ts: float = Query(..., description="End of range (Unix epoch)"),
):
    """Return all archived events for a signal within [from_ts, until_ts]."""
    if until_ts < from_ts:
        raise HTTPException(status_code=400, detail="until_ts must be >= from_ts")
    records = query_events(signal, from_ts, until_ts)
    return {"signal": signal, "count": len(records), "records": records}


@app.get("/range/{signal}")
def signal_range(signal: str):
    """Return the time coverage for a signal (earliest, latest, count)."""
    return get_time_range(signal)
