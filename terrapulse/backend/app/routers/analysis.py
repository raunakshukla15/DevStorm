"""Analysis submission and point-insights routes."""

from datetime import datetime, timedelta
import logging
from typing import List, Optional
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request

from app import db
from app.limiter import RATE_LIMIT_ANALYZE, limiter
from app.schemas import (
    AnalysisStubOut,
    GranuleSummaryOut,
    JobStartResponse,
    LocationPoint,
    PointInsightsResponse,
)
from app.services import cache
from app.services.hazards import (
    HAZARD_CONFIGS,
    SPECKLE_METHODS,
    SUPPORTED_BANDS,
    THRESHOLD_MODES,
    resolve_short_names,
)
from app.services.job_runner import parse_granule_date, run_analysis_job, summarize_granule
from app.services.nisar_provider import MAX_WINDOW_PIXELS
from app.services.sample_data import get_sample_nisar_result

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


def _parse_bbox(raw_bbox: Optional[str]) -> Optional[List[float]]:
    if not raw_bbox:
        return None
    parts = [p.strip() for p in raw_bbox.split(",") if p.strip()]
    if len(parts) != 4:
        raise HTTPException(
            status_code=400,
            detail="bbox must have 4 comma-separated floats: west,south,east,north.",
        )
    try:
        w, s, e, n = (float(p) for p in parts)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid bbox number: {exc}")
    if e <= w or n <= s or w < -180 or e > 180 or s < -90 or n > 90:
        raise HTTPException(status_code=400, detail="bbox coordinates out of bounds or inverted.")
    return [w, s, e, n]


@router.post(
    "/analysis/hazard",
    response_model=JobStartResponse,
    summary="Start a multi-hazard live analysis job",
    status_code=202,
)
@limiter.limit(RATE_LIMIT_ANALYZE)
async def hazard_analysis(
    request: Request,
    background_tasks: BackgroundTasks,
    hazard: str = Query(..., description="flood | tsunami | hurricane | volcano | earthquake | forest_disturbance | landslide | agriculture | deformation"),
    lat: float = Query(..., ge=-90, le=90, description="Center latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Center longitude"),
    before_date: Optional[str] = Query(
        None, description="Target before date (YYYY-MM-DD); omit both for auto latest pair"
    ),
    after_date: Optional[str] = Query(None, description="Target after date (YYYY-MM-DD)"),
    dataset_id: Optional[str] = Query(None, description="Dataset id or CMR short name"),
    band: Optional[str] = Query(None, description="Polarization band: HH | HV | VV | HH/HV"),
    window: int = Query(256, ge=64, le=MAX_WINDOW_PIXELS, description="Window size in pixels"),
    bbox: Optional[str] = Query(None, description="Optional AOI bbox 'west,south,east,north'"),
    speckle_filter: str = Query("none", description="Speckle filter: none | boxcar | lee"),
    threshold_mode: str = Query("fixed", description="Threshold mode: fixed | otsu | mean_std"),
    water_mask: bool = Query(False, description="Apply auxiliary permanent water mask metadata check"),
    slope_mask: bool = Query(False, description="Apply auxiliary DEM terrain slope mask metadata check"),
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

    cfg = HAZARD_CONFIGS[hazard]
    chosen_band = (band or cfg.get("default_band") or "HH").upper()
    if chosen_band not in SUPPORTED_BANDS:
        raise HTTPException(status_code=400, detail=f"Unsupported band '{chosen_band}'. Use {SUPPORTED_BANDS}.")
    chosen_filter = (speckle_filter or "none").lower()
    if chosen_filter not in SPECKLE_METHODS:
        raise HTTPException(status_code=400, detail=f"Unsupported speckle_filter '{chosen_filter}'. Use {SPECKLE_METHODS}.")
    chosen_thresh = (threshold_mode or "fixed").lower()
    if chosen_thresh not in THRESHOLD_MODES:
        raise HTTPException(status_code=400, detail=f"Unsupported threshold_mode '{chosen_thresh}'. Use {THRESHOLD_MODES}.")

    parsed_bbox = _parse_bbox(bbox)
    chosen_dataset = dataset_id or cfg.get("dataset_id") or "nisar_l2_gcov"

    job_id = uuid.uuid4().hex[:12]
    params = {
        "hazard": hazard,
        "before_date": before_date,
        "after_date": after_date,
        "lat": lat,
        "lon": lon,
        "dataset_id": chosen_dataset,
        "band": chosen_band,
        "window": window,
        "bbox": parsed_bbox,
        "speckle_filter": chosen_filter,
        "threshold_mode": chosen_thresh,
        "water_mask": water_mask,
        "slope_mask": slope_mask,
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
    "/analysis/sample",
    summary="Guided sample NISAR result payload",
)
async def get_sample_analysis():
    """Return a cached, explicitly labeled sample NISAR L2 GCOV indicator payload."""
    return get_sample_nisar_result()


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
