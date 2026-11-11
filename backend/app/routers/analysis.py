"""Analysis submission and point-insights routes."""

import asyncio
from datetime import datetime, timedelta
import logging
import time
from typing import List, Optional, Tuple
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request

from app import db
from app.limiter import RATE_LIMIT_ANALYZE, limiter
from app.schemas import (
    AnalysisStubOut,
    GranuleSummaryOut,
    JobStartResponse,
    LocationPoint,
    PassSummaryOut,
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

logger = logging.getLogger(__name__)

router = APIRouter(tags=["analysis"])


def _normalize_analysis_dates(
    before_date: Optional[str],
    after_date: Optional[str],
) -> Tuple[Optional[str], Optional[str]]:
    """Normalize and validate optional before/after dates (supports before + 'latest' auto)."""
    clean_b = (before_date or "").strip() or None
    if clean_b and clean_b.lower() == "auto":
        clean_b = None

    clean_a = (after_date or "").strip() or None
    if clean_a and clean_a.lower() in {"latest", "auto"}:
        clean_a = None

    if clean_a and not clean_b:
        raise HTTPException(
            status_code=400,
            detail=(
                "Provide both dates, before_date alone (after=latest), "
                "or omit both for auto latest pair."
            ),
        )

    b_dt = a_dt = None
    if clean_b:
        try:
            b_dt = datetime.strptime(clean_b, "%Y-%m-%d")
        except ValueError as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid before_date format: {e}. Use YYYY-MM-DD.",
            )
    if clean_a:
        try:
            a_dt = datetime.strptime(clean_a, "%Y-%m-%d")
        except ValueError as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid after_date format: {e}. Use YYYY-MM-DD.",
            )
    if b_dt and a_dt and a_dt <= b_dt:
        raise HTTPException(status_code=400, detail="After date must be after before date.")
    return clean_b, clean_a


@router.post(
    "/analysis/change-detection",
    response_model=JobStartResponse,
    summary="Start live change detection job",
    status_code=202,
)
async def change_detection(
    background_tasks: BackgroundTasks,
    before_date: Optional[str] = Query(
        None,
        description="Target before date (YYYY-MM-DD); omit both for auto pair",
    ),
    after_date: Optional[str] = Query(
        None,
        description="Target after date (YYYY-MM-DD, or omit/'latest' for newest pass)",
    ),
    lat: float = Query(..., ge=-90, le=90, description="Center latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Center longitude"),
    dataset_id: str = Query("nisar_l2_gcov", description="Dataset id or CMR short name"),
    band: str = Query("HH", description="Polarization band"),
    window: int = Query(256, ge=64, le=MAX_WINDOW_PIXELS, description="Window size in pixels"),
):
    """Start a live NISAR flood-indicator analysis as a background job."""
    clean_b, clean_a = _normalize_analysis_dates(before_date, after_date)
    stored_after = clean_a if clean_a else ("latest" if clean_b else None)

    job_id = uuid.uuid4().hex[:12]
    params = {
        "hazard": "flood",
        "before_date": clean_b,
        "after_date": stored_after,
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
    hazard: str = Query(
        ...,
        description="flood | tsunami | hurricane | volcano | earthquake | forest_disturbance | landslide | agriculture | deformation",
    ),
    lat: float = Query(..., ge=-90, le=90, description="Center latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Center longitude"),
    before_date: Optional[str] = Query(
        None, description="Target before date (YYYY-MM-DD); omit both for auto latest pair"
    ),
    after_date: Optional[str] = Query(
        None,
        description="Target after date (YYYY-MM-DD, or omit/'latest' for newest pass)",
    ),
    dataset_id: Optional[str] = Query(None, description="Dataset id or CMR short name"),
    band: Optional[str] = Query(None, description="Polarization band: HH | HV | VV | HH/HV"),
    window: int = Query(256, ge=64, le=MAX_WINDOW_PIXELS, description="Window size in pixels"),
    bbox: Optional[str] = Query(None, description="Optional AOI bbox 'west,south,east,north'"),
    speckle_filter: str = Query("none", description="Speckle filter: none | boxcar | lee"),
    threshold_mode: str = Query("fixed", description="Threshold mode: fixed | otsu | mean_std"),
    water_mask: bool = Query(
        False, description="Apply auxiliary permanent water mask metadata check"
    ),
    slope_mask: bool = Query(
        False, description="Apply auxiliary DEM terrain slope mask metadata check"
    ),
):
    """Start a hazard-specific live NISAR analysis as a background job."""
    hazard = (hazard or "").lower()
    if hazard not in HAZARD_CONFIGS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown hazard '{hazard}'. Supported: {sorted(HAZARD_CONFIGS)}.",
        )
    clean_b, clean_a = _normalize_analysis_dates(before_date, after_date)
    stored_after = clean_a if clean_a else ("latest" if clean_b else None)

    cfg = HAZARD_CONFIGS[hazard]
    chosen_band = (band or cfg.get("default_band") or "HH").upper()
    if chosen_band not in SUPPORTED_BANDS:
        raise HTTPException(
            status_code=400, detail=f"Unsupported band '{chosen_band}'. Use {SUPPORTED_BANDS}."
        )
    chosen_filter = (speckle_filter or "none").lower()
    if chosen_filter not in SPECKLE_METHODS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported speckle_filter '{chosen_filter}'. Use {SPECKLE_METHODS}.",
        )
    chosen_thresh = (threshold_mode or "fixed").lower()
    if chosen_thresh not in THRESHOLD_MODES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported threshold_mode '{chosen_thresh}'. Use {THRESHOLD_MODES}.",
        )

    parsed_bbox = _parse_bbox(bbox)
    chosen_dataset = dataset_id or cfg.get("dataset_id") or "nisar_l2_gcov"

    job_id = uuid.uuid4().hex[:12]
    params = {
        "hazard": hazard,
        "before_date": clean_b,
        "after_date": stored_after,
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
    """Fast, pixel-free insights + selectable passes for a clicked map point."""
    t0 = time.perf_counter()
    provider = cache.get_provider()
    if not provider.is_authenticated() and not await asyncio.to_thread(provider.authenticate):
        raise HTTPException(
            status_code=401,
            detail=(
                "NASA Earthdata authentication required: set "
                "NASA_EARTHDATA_USERNAME and NASA_EARTHDATA_PASSWORD in backend/.env."
            ),
        )
    now = datetime.now()
    end = now.strftime("%Y-%m-%d")
    start_180 = (now - timedelta(days=180)).strftime("%Y-%m-%d")
    cutoff_90 = now - timedelta(days=90)
    tight_deg = 0.05
    wide_deg = 60.0 / 111.0
    tight_bbox = [lon - tight_deg, lat - tight_deg, lon + tight_deg, lat + tight_deg]
    wide_bbox = [lon - wide_deg, lat - wide_deg, lon + wide_deg, lat + wide_deg]

    def _contains(g: dict) -> bool:
        bb = g.get("bounding_box")
        if not bb or len(bb) != 4:
            return True
        return bb[0] <= lon <= bb[2] and bb[1] <= lat <= bb[3]

    short_names = resolve_short_names(dataset_id)
    for sn in short_names:
        try:
            granules = await asyncio.to_thread(
                cache.cached_search, provider, sn, (start_180, end), tight_bbox, 60
            )
            if not granules:
                granules = await asyncio.to_thread(
                    cache.cached_search, provider, sn, (start_180, end), wide_bbox, 60
                )
        except Exception as e:
            logger.warning("point-insights search failed for %s: %s", sn, e)
            continue
        dated = [(g, parse_granule_date(g)) for g in granules]
        dated = [(g, d) for g, d in dated if d is not None]
        # Prefer passes covering the exact clicked point cleanly, newest first.
        dated.sort(key=lambda t: (1 if _contains(t[0]) else 0, t[1]), reverse=True)
        if dated:
            # Sort strictly newest -> oldest while deduplicating same date+orbit frames.
            by_date_desc = sorted(
                dated,
                key=lambda t: (t[1], 1 if _contains(t[0]) else 0),
                reverse=True,
            )
            seen_keys = set()
            passes: List[PassSummaryOut] = []
            for g, d in by_date_desc:
                d_str = d.strftime("%Y-%m-%d")
                orbit = (g.get("orbit_direction") or "unknown").lower()
                k = (d_str, orbit)
                if k in seen_keys:
                    continue
                seen_keys.add(k)
                passes.append(
                    PassSummaryOut(
                        id=g.get("id"),
                        title=g.get("title"),
                        date=d_str,
                        acquisition_date=g.get("acquisition_date"),
                        orbit_direction=orbit,
                        covers_point=_contains(g),
                    )
                )

            dated_only_desc = sorted(dated, key=lambda t: t[1], reverse=True)
            latest = dated_only_desc[0][0]
            earliest_dt = dated_only_desc[-1][1]
            count_90d = sum(1 for _, d in dated if d >= cutoff_90)
            elapsed_ms = int((time.perf_counter() - t0) * 1000)
            return PointInsightsResponse(
                available=True,
                location=LocationPoint(lat=lat, lon=lon),
                short_name=sn,
                granules_last_90d=count_90d,
                granules_last_180d=len(dated),
                earliest_acquisition=earliest_dt.strftime("%Y-%m-%d"),
                latest_acquisition=dated_only_desc[0][1].strftime("%Y-%m-%d"),
                latest_granule=GranuleSummaryOut(**summarize_granule(latest)),
                recent_acquisitions=[p.date for p in passes[:12]],
                available_passes=passes,
                query_elapsed_ms=elapsed_ms,
                supported_hazards=sorted(HAZARD_CONFIGS),
                note=(
                    f"Live NASA CMR metadata ({len(passes)} unique pass dates over 180d) "
                    f"retrieved in {elapsed_ms} ms. Pick Before & After passes to compute radar charts."
                ),
            )
    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    return PointInsightsResponse(
        available=False,
        location=LocationPoint(lat=lat, lon=lon),
        short_names_searched=short_names,
        query_elapsed_ms=elapsed_ms,
        note="No NISAR granules near this point in the last 180 days. Try another location or land area.",
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
