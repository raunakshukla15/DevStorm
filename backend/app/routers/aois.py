"""Saved Area of Interest (AOI) routes with geodesic area measurement."""

from typing import List
from fastapi import APIRouter, HTTPException
from pyproj import Geod

from app import db
from app.schemas import AoiCreate, AoiOut

router = APIRouter(tags=["aois"])

_GEOD = Geod(ellps="WGS84")
MAX_AOI_KM2 = 25000.0


def compute_bbox_area_km2(bbox: List[float]) -> float:
    """Compute exact WGS84 geodesic area in km^2 for [west, south, east, north]."""
    w, s, e, n = (float(v) for v in bbox)
    if e <= w or n <= s:
        raise ValueError("Bounding box must satisfy east > west and north > south.")
    if w < -180 or e > 180 or s < -90 or n > 90:
        raise ValueError("Bounding box coordinates out of valid WGS84 bounds.")
    area_m2, _ = _GEOD.polygon_area_perimeter([w, e, e, w], [s, s, n, n])
    return round(abs(float(area_m2)) / 1e6, 4)


@router.get("/aois", response_model=List[AoiOut], summary="List saved AOIs")
async def list_aois():
    return [AoiOut(**a) for a in db.list_aois()]


@router.post("/aois", response_model=AoiOut, status_code=201, summary="Save a drawn AOI")
async def create_aoi(payload: AoiCreate):
    try:
        area_km2 = compute_bbox_area_km2(payload.bbox)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if area_km2 > MAX_AOI_KM2:
        raise HTTPException(
            status_code=400,
            detail=f"AOI area ({area_km2:.1f} km^2) exceeds max {MAX_AOI_KM2:.0f} km^2.",
        )
    row = db.create_aoi(payload.name.strip(), [float(v) for v in payload.bbox], area_km2)
    return AoiOut(**row)


@router.delete("/aois/{aoi_id}", summary="Delete a saved AOI")
async def delete_aoi(aoi_id: int):
    if not db.delete_aoi(aoi_id):
        raise HTTPException(status_code=404, detail=f"Unknown AOI id {aoi_id}.")
    return {"deleted": True, "id": aoi_id}
