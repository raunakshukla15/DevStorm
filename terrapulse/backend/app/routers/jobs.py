"""Job history, polling, SSE progress stream, visuals, and multi-format export endpoints."""

import asyncio
import json
from pathlib import Path
from typing import List
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse

from app import db
from app.schemas import DatePairOut, JobDetailOut, JobSummaryOut
from app.services import renders
from app.services.export_report import build_job_csv, build_job_pdf
from app.services.flood_analysis import build_affine_from_coords, export_geotiff

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
                confidence_score=(res.get("confidence") or {}).get("score"),
                severity=res.get("severity"),
                outlines=len(
                    (
                        (res.get("results") or {}).get("flood_outlines")
                        or (res.get("results") or {}).get("disturbance_outlines")
                        or (res.get("results") or {}).get("deformation_outlines")
                        or {}
                    ).get("features", [])
                ),
                error=job.get("error"),
                created_at=job["created_at"],
            )
        )
    return out


@router.get(
    "/analysis/jobs/{job_id}/stream",
    summary="Stream job progress via Server-Sent Events (SSE)",
)
async def stream_job_progress(job_id: str):
    if db.get_job(job_id) is None:
        raise HTTPException(status_code=404, detail=f"Unknown job id '{job_id}'.")

    async def event_gen():
        for _ in range(240):
            job = db.get_job(job_id)
            if job is None:
                yield f"data: {json.dumps({'job_id': job_id, 'status': 'not_found'})}\n\n"
                break
            payload = {
                "job_id": job_id,
                "status": job["status"],
                "stage": job.get("stage"),
                "progress": int(job.get("progress") or 0),
                "error": job.get("error"),
            }
            yield f"data: {json.dumps(payload)}\n\n"
            if job["status"] in {"complete", "completed", "failed"}:
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get(
    "/analysis/jobs/{job_id}/image/{name}.png",
    summary="Fetch rendered analysis raster PNG (before, after, difference, rgb)",
)
async def get_job_image(job_id: str, name: str):
    path = renders.load_job_image(job_id, name)
    if path is None:
        raise HTTPException(status_code=404, detail=f"Image '{name}.png' not available for job '{job_id}'.")
    return FileResponse(str(path), media_type="image/png")


@router.get(
    "/analysis/jobs/{job_id}/export",
    summary="Export analysis output in GeoJSON, GeoTIFF, CSV, PNG, or PDF format",
)
async def export_job(
    job_id: str,
    format: str = Query("geojson", description="geojson | tif | csv | png | pdf"),
):
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job id '{job_id}'.")
    fmt = (format or "geojson").lower().strip()
    res = job.get("result") or {}

    if fmt == "geojson":
        results_obj = res.get("results") or {}
        gj = (
            results_obj.get("flood_outlines")
            or results_obj.get("disturbance_outlines")
            or results_obj.get("deformation_outlines")
            or {"type": "FeatureCollection", "features": []}
        )
        return JSONResponse(
            content=gj,
            headers={"Content-Disposition": f'attachment; filename="terrapulse-{job_id}.geojson"'},
        )

    if fmt in {"tif", "tiff", "geotiff"}:
        arrays = renders.load_job_arrays(job_id)
        if arrays is None:
            raise HTTPException(
                status_code=404,
                detail=f"No raster window saved for job '{job_id}' to export as GeoTIFF.",
            )
        tif_path = Path(renders.get_job_dir(job_id)) / f"terrapulse-{job_id}.tif"
        transform = build_affine_from_coords(arrays["x_coords"], arrays["y_coords"])
        out = export_geotiff(
            arrays["difference"],
            transform=transform,
            crs=arrays["crs"],
            filename=str(tif_path),
            compress="LZW",
        )
        if not out.get("success"):
            raise HTTPException(status_code=500, detail=out.get("error") or "GeoTIFF export failed.")
        return FileResponse(
            str(tif_path),
            media_type="image/tiff",
            filename=f"terrapulse-{job_id}.tif",
        )

    if fmt == "csv":
        csv_text = build_job_csv(job)
        return Response(
            content=csv_text,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="terrapulse-{job_id}.csv"'},
        )

    if fmt == "png":
        png_path = renders.load_job_image(job_id, "difference")
        if png_path is None:
            raise HTTPException(status_code=404, detail=f"No PNG image rendered for job '{job_id}'.")
        return FileResponse(
            str(png_path),
            media_type="image/png",
            filename=f"terrapulse-{job_id}.png",
        )

    if fmt == "pdf":
        pdf_bytes = build_job_pdf(job)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="terrapulse-{job_id}-report.pdf"'},
        )

    raise HTTPException(status_code=400, detail=f"Unsupported export format '{format}'.")


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
