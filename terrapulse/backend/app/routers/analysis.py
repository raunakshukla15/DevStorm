"""Analysis submission and point-insights routes."""

from datetime import datetime, timedelta
import logging
from typing import Optional
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from app import db
from app.schemas import (
    AnalysisStubOut,
    GranuleSummaryOut,
    JobStartResponse,
    LocationPoint,
    PointInsightsResponse,
)
from app.services import cache
from app.services.hazards import HAZARD_CONFIGS, resolve_short_names
from app.services.job_runner import parse_granule_date, run_analysis_job, summarize_granule
from app.services.nisar_provider import MAX_WINDOW_PIXELS

logger = logging.getLogger(__name__)

router = APIRouter(tags=["analysis"])


@router.post(
    "/analysis/change-detection",
    response_model=JobStartResponse,
    summary="Start live change detection job",
    status_code=202,
)
async def change_detection(
    background_tasks: BackgroundTasks,
    before_date: str = Query(..., description="Target before date (YYYY-MM-DD)"),
    after_date: str = Query(..., description="Target after date (YYYY-MM-DD)"),
    lat: float = Query(..., ge=-90, le=90, description="Center latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Center longitude"),
    dataset_id: str = Query("nisar_l2_gcov", description="Dataset id or CMR short name"),
    band: str = Query("HH", description="Polarization band"),
    window: int = Query(256, ge=64, le=MAX_WINDOW_PIXELS, description="Window size in pixels"),
):
    """Start a live NISAR flood-indicator analysis as a background job."""
    try:
        before_dt = datetime.strptime(before_date, "%Y-%m-%d")
        after_dt = datetime.strptime(after_date, "%Y-%m-%d")
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid date format: {e}. Use YYYY-MM-DD format.",
        )
    if after_dt <= before_dt:
        raise HTTPException(status_code=400, detail="After date must be after before date.")

    job_id = uuid.uuid4().hex[:12]
    params = {
        "hazard": "flood",
        "before_date": before_date,
        "after_date": after_date,
        "lat": lat,
        "lon": lon,
        "dataset_id": dataset_id,
        "band": band,
        "window": window,
    }
    db.create_job(job_id, params)
    background_tasks.add_task(run_analysis_job, job_id, params)
    logger.info("Started flood analysis job %s for (%s, %s)", job_id, lat, lon)
    return JobStartResponse(
        job_id=job_id,
        status="running",
        status_url=f"/api/v1/analysis/jobs/{job_id}",
        hazard="flood",
        message="Analysis running in background — poll status_url for progress.",
    )


@router.post(
    "/analysis/hazard",
    response_model=JobStartResponse,
    summary="Start a multi-hazard live analysis job",
    status_code=202,
)
async def hazard_analysis(
    background_tasks: BackgroundTasks,
    hazard: str = Query(..., description="flood | tsunami | hurricane | volcano | earthquake"),
    lat: float = Query(..., ge=-90, le=90, description="Center latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Center longitude"),
    before_date: Optional[str] = Query(
        None, description="Target before date (YYYY-MM-DD); omit both for auto latest pair"
    ),
    after_date: Optional[str] = Query(None, description="Target after date (YYYY-MM-DD)"),
    dataset_id: str = Query("nisar_l2_gcov", description="Dataset id or CMR short name"),
    band: str = Query("HH", description="Polarization band"),
    window: int = Query(256, ge=64, le=MAX_WINDOW_PIXELS, description="Window size in pixels"),
):
    """Start a hazard-specific live NISAR analysis as a background job."""
    hazard = (hazard or "").lower()
    if hazard not in HAZARD_CONFIGS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown hazard '{hazard}'. Supported: {sorted(HAZARD_CONFIGS)}.",
        )
    if bool(before_date) != bool(after_date):
        raise HTTPException(
            status_code=400,
            detail="Provide both dates or neither (neither = auto latest pair).",
        )
    if before_date and after_date:
        try:
            b = datetime.strptime(before_date, "%Y-%m-%d")
            a = datetime.strptime(after_date, "%Y-%m-%d")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Invalid date format: {e}.")
        if a <= b:
            raise HTTPException(status_code=400, detail="After date must be after before date.")

    job_id = uuid.uuid4().hex[:12]
    params = {
        "hazard": hazard,
        "before_date": before_date,
        "after_date": after_date,
        "lat": lat,
        "lon": lon,
        "dataset_id": dataset_id,
        "band": band,
        "window": window,
    }
    db.create_job(job_id, params)
    background_tasks.add_task(run_analysis_job, job_id, params)
    logger.info("Started %s job %s for (%s, %s)", hazard, job_id, lat, lon)
    return JobStartResponse(
        job_id=job_id,
        status="running",
        status_url=f"/api/v1/analysis/jobs/{job_id}",
        hazard=hazard,
        message="Analysis running in background — poll status_url for progress.",
    )


@router.get(
    "/analysis/point-insights",
    response_model=PointInsightsResponse,
    summary="Instant NISAR insights for a map point",
)
async def point_insights(
    lat: float = Query(..., ge=-90, le=90, description="Clicked latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Clicked longitude"),
    dataset_id: str = Query("nisar_l2_gcov", description="Dataset id or CMR short name"),
):
    """Fast, pixel-free insights for a clicked map point."""
    provider = cache.get_provider()
    if not provider.is_authenticated() and not provider.authenticate():
        raise HTTPException(
            status_code=401,
            detail=(
                "NASA Earthdata authentication required: set "
                "NASA_EARTHDATA_USERNAME and NASA_EARTHDATA_PASSWORD in backend/.env."
            ),
        )
    end = datetime.now().strftime("%Y-%m-%d")
    start = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
    window_deg = 60.0 / 111.0
    bbox = [lon - window_deg, lat - window_deg, lon + window_deg, lat + window_deg]
    for sn in resolve_short_names(dataset_id):
        try:
            granules = cache.cached_search(provider, sn, (start, end), bbox, count=20)
        except Exception as e:
            logger.warning("point-insights search failed for %s: %s", sn, e)
            continue
        dated = [(g, parse_granule_date(g)) for g in granules]
        dated = [(g, d) for g, d in dated if d is not None]
        dated.sort(key=lambda t: t[1], reverse=True)
        if dated:
            latest = dated[0][0]
            return PointInsightsResponse(
                available=True,
                location=LocationPoint(lat=lat, lon=lon),
                short_name=sn,
                granules_last_90d=len(dated),
                latest_acquisition=dated[0][1].strftime("%Y-%m-%d"),
                latest_granule=GranuleSummaryOut(**summarize_granule(latest)),
                recent_acquisitions=[d.strftime("%Y-%m-%d") for _, d in dated[:6]],
                supported_hazards=sorted(HAZARD_CONFIGS),
                note="Pixel analysis runs as a background job via /analysis/hazard.",
            )
    return PointInsightsResponse(
        available=False,
        location=LocationPoint(lat=lat, lon=lon),
        short_names_searched=resolve_short_names(dataset_id),
        note="No NISAR granules near this point in the last 90 days. Try another location or a wider area.",
    )


@router.get(
    "/analysis/{analysis_id}",
    response_model=AnalysisStubOut,
    summary="Get analysis result by ID",
)
async def get_analysis_result(analysis_id: str):
    """Look up job result by analysis/job id cleanly if present in SQLite."""
    job = db.get_job(analysis_id)
    if job is not None:
        return AnalysisStubOut(
            analysis_id=analysis_id,
            status=job["status"],
            message=job.get("error") or job.get("stage") or "loaded",
            produced_at=(job.get("result") or {}).get("produced_at"),
        )
    return AnalysisStubOut(
        analysis_id=analysis_id,
        status="not_found",
        message="Use GET /api/v1/analysis/jobs/{job_id} to retrieve background job results.",
        produced_at=None,
    )
