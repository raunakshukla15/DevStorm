"""Multi-date NISAR SAR backscatter time-series endpoints."""

import uuid
from fastapi import APIRouter, BackgroundTasks, HTTPException

from app import db
from app.schemas import TimeseriesCreate, TimeseriesOut
from app.services.hazards import SUPPORTED_BANDS
from app.services.timeseries import run_timeseries_job

router = APIRouter(tags=["timeseries"])


@router.post(
    "/timeseries",
    response_model=TimeseriesOut,
    status_code=202,
    summary="Start time-series backscatter extraction",
)
async def start_timeseries(payload: TimeseriesCreate, background_tasks: BackgroundTasks):
    band = (payload.band or "HH").upper()
    if band not in SUPPORTED_BANDS:
        raise HTTPException(
            status_code=400, detail=f"Unsupported band '{band}'. Use {SUPPORTED_BANDS}."
        )
    series_id = uuid.uuid4().hex[:12]
    job = db.upsert_timeseries_job(
        series_id,
        lat=payload.lat,
        lon=payload.lon,
        band=band,
        months=payload.months,
        status="running",
    )
    background_tasks.add_task(
        run_timeseries_job,
        series_id,
        payload.lat,
        payload.lon,
        band,
        payload.months,
        payload.dataset_id,
    )
    return TimeseriesOut(**job, points=[])


@router.get(
    "/timeseries/{series_id}",
    response_model=TimeseriesOut,
    summary="Poll time-series progress & points",
)
async def get_timeseries(series_id: str):
    job = db.get_timeseries_job(series_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown timeseries id '{series_id}'.")
    points = db.get_timeseries_points(series_id)
    return TimeseriesOut(**job, points=points)
