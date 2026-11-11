"""Job history and polling endpoints."""

from typing import List
from fastapi import APIRouter, HTTPException, Query

from app import db
from app.schemas import DatePairOut, JobDetailOut, JobSummaryOut

router = APIRouter(tags=["jobs"])


@router.get("/analysis/jobs", response_model=List[JobSummaryOut], summary="List recent analysis jobs")
async def list_jobs(limit: int = Query(20, description="Max jobs, newest first")):
    """Job history for dashboards, event lists, alerts and reports."""
    ordered = db.list_jobs(limit=limit)
    out: List[JobSummaryOut] = []
    for job in ordered:
        p = job.get("params", {}) or {}
        res = job.get("result") or {}
        an = res.get("analysis") or {}
        actual_dates = res.get("actual_granule_dates")
        out.append(
            JobSummaryOut(
                job_id=job["job_id"],
                status=job["status"],
                stage=job.get("stage"),
                progress=int(job.get("progress") or 0),
                hazard=p.get("hazard", "flood"),
                location={"lat": p.get("lat"), "lon": p.get("lon")},
                requested_dates=DatePairOut(
                    before=p.get("before_date"),
                    after=p.get("after_date"),
                ),
                actual_granule_dates=DatePairOut(**actual_dates) if actual_dates else None,
                auto_dates=bool(res.get("auto_dates", False)),
                mean_db=an.get("mean_backscatter_difference_db"),
                percentage_decrease=an.get("percentage_decrease"),
                percentage_disturbed=an.get("percentage_disturbed"),
                affected_area_km2=an.get("affected_area_km2"),
                outlines=len(
                    (
                        (res.get("results") or {}).get("flood_outlines")
                        or (res.get("results") or {}).get("disturbance_outlines")
                        or {}
                    ).get("features", [])
                ),
                error=job.get("error"),
                created_at=job["created_at"],
            )
        )
    return out


@router.get(
    "/analysis/jobs/{job_id}",
    response_model=JobDetailOut,
    summary="Get background job status/result",
)
async def get_job(job_id: str):
    """Poll a change-detection job: stage, progress %, and result when done."""
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job id '{job_id}'.")
    return JobDetailOut(**job)
