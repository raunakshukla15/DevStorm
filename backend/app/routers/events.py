"""Live natural disaster event feeds (USGS + NASA EONET) & NISAR pass matching."""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query

from app.schemas import GranuleSummaryOut, LiveEventsResponse
from app.services import cache
from app.services.event_feeds import fetch_live_events
from app.services.hazards import resolve_short_names
from app.services.job_runner import parse_granule_date, summarize_granule

router = APIRouter(tags=["events"])


@router.get(
    "/events/live", response_model=LiveEventsResponse, summary="Live USGS & NASA EONET events"
)
async def get_live_events(
    hazard: Optional[str] = Query(
        None, description="Optional hazard filter (earthquake, flood, wildfire, volcano, storm)"
    ),
):
    events, warnings = await fetch_live_events(hazard=hazard)
    return LiveEventsResponse(events=events, warnings=warnings)


@router.get("/events/match-nisar", summary="Find nearest pre/post NISAR granules for an event date")
async def match_nisar_for_event(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    event_date: str = Query(..., description="Event date YYYY-MM-DD"),
    dataset_id: str = Query("nisar_l2_gcov"),
):
    try:
        ev_dt = datetime.strptime(event_date[:10], "%Y-%m-%d")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid event_date: {e}")

    provider = cache.get_provider()
    if not provider.is_authenticated() and not provider.authenticate():
        raise HTTPException(status_code=401, detail="NASA Earthdata authentication required.")

    start = (ev_dt - timedelta(days=30)).strftime("%Y-%m-%d")
    end = min(datetime.now(), ev_dt + timedelta(days=30)).strftime("%Y-%m-%d")
    bbox = [lon - 0.8, lat - 0.8, lon + 0.8, lat + 0.8]

    granules: List[Dict[str, Any]] = []
    used_sn = None
    for sn in resolve_short_names(dataset_id):
        try:
            found = cache.cached_search(provider, sn, (start, end), bbox, count=25)
            if found:
                granules = found
                used_sn = sn
                break
        except Exception:
            continue

    before_cands: List[Any] = []
    after_cands: List[Any] = []
    for g in granules:
        dt = parse_granule_date(g)
        if dt is None:
            continue
        if dt <= ev_dt:
            before_cands.append((dt, g))
        else:
            after_cands.append((dt, g))

    before_cands.sort(key=lambda t: t[0], reverse=True)
    after_cands.sort(key=lambda t: t[0])

    pre = summarize_granule(before_cands[0][1]) if before_cands else None
    post = summarize_granule(after_cands[0][1]) if after_cands else None

    return {
        "event_date": event_date[:10],
        "location": {"lat": lat, "lon": lon},
        "short_name": used_sn,
        "pre_event_granule": GranuleSummaryOut(**pre) if pre else None,
        "post_event_granule": GranuleSummaryOut(**post) if post else None,
        "suggested_before_date": (
            pre.get("acquisition_date")
            if pre
            else (ev_dt - timedelta(days=12)).strftime("%Y-%m-%d")
        ),
        "suggested_after_date": (
            post.get("acquisition_date") if post else datetime.now().strftime("%Y-%m-%d")
        ),
        "has_both_passes": bool(pre and post),
    }
