"""Live NISAR observation discovery, availability, and geocoding proxy routes."""

import asyncio
import logging
import time
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
import httpx

from app.schemas import (
    AvailabilityResponse,
    GeocodeResultOut,
    GranuleSummaryOut,
    LocationPoint,
    ObservationItemOut,
    ObservationNoteOut,
)
from app.services import cache
from app.services.hazards import resolve_short_names
from app.services.job_runner import summarize_granule

logger = logging.getLogger(__name__)

router = APIRouter(tags=["observations"])


@router.get(
    "/observations",
    response_model=List[ObservationItemOut],
    summary="Search live NISAR observations",
)
async def get_observations(
    dataset_id: Optional[str] = Query(None, description="Dataset id or CMR short name"),
    lat: Optional[float] = Query(None, description="Latitude filter"),
    lon: Optional[float] = Query(None, description="Longitude filter"),
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
):
    """Search live NISAR granules via CMR. No query parameters returns []."""
    if dataset_id is None or lat is None or lon is None:
        return []

    provider = cache.get_provider()
    if not provider.is_authenticated() and not provider.authenticate():
        raise HTTPException(
            status_code=401,
            detail=(
                "NASA Earthdata authentication required: set "
                "NASA_EARTHDATA_USERNAME and NASA_EARTHDATA_PASSWORD in backend/.env."
            ),
        )

    window = 60.0 / 111.0
    bbox = [lon - window, lat - window, lon + window, lat + window]
    temporal = (start_date, end_date) if (start_date and end_date) else ("2026-01-01", "2026-12-31")

    found: List[ObservationItemOut] = []
    errors: List[str] = []
    for sn in resolve_short_names(dataset_id):
        try:
            for g in cache.cached_search(provider, sn, temporal, bbox, count=20):
                found.append(
                    ObservationItemOut(
                        id=g.get("id"),
                        title=g.get("title"),
                        short_name=g.get("short_name"),
                        dataset_id=dataset_id,
                        acquisition_date=g.get("acquisition_date"),
                        orbit_direction=g.get("orbit_direction") or "unknown",
                        location=LocationPoint(lat=lat, lon=lon),
                        bounding_box=g.get("bounding_box"),
                        https_url=g.get("https_link"),
                        s3_url=g.get("s3_link"),
                    )
                )
            if found:
                break
        except Exception as e:
            errors.append(f"{sn}: {e}")
    if not found and errors:
        raise HTTPException(status_code=502, detail="CMR search failed: " + "; ".join(errors))
    logger.info("Found %d live observations for %s", len(found), dataset_id)
    return found


@router.get(
    "/observations/availability",
    response_model=AvailabilityResponse,
    summary="Check live NISAR data availability",
)
async def check_availability(
    lat: float = Query(..., description="Latitude"),
    lon: float = Query(..., description="Longitude"),
    start_date: str = Query(..., description="Start date (YYYY-MM-DD)"),
    end_date: str = Query(..., description="End date (YYYY-MM-DD)"),
    dataset_id: Optional[str] = Query("nisar_l2_gcov", description="Dataset id or CMR short name"),
):
    """Check live NISAR granule availability for an area and time range."""
    provider = cache.get_provider()
    if not provider.is_authenticated() and not provider.authenticate():
        raise HTTPException(
            status_code=401,
            detail=(
                "NASA Earthdata authentication required: set "
                "NASA_EARTHDATA_USERNAME and NASA_EARTHDATA_PASSWORD in backend/.env."
            ),
        )

    for sn in resolve_short_names(dataset_id or "nisar_l2_gcov"):
        try:
            result = provider.check_availability(
                lat=lat,
                lon=lon,
                start_date=start_date,
                end_date=end_date,
                short_name=sn,
            )
        except Exception as e:
            logger.warning("Availability check failed for %s: %s", sn, e)
            continue
        if result.get("available"):
            return AvailabilityResponse(
                available=True,
                short_name=sn,
                count=result.get("count"),
                datasets=[
                    GranuleSummaryOut(**summarize_granule(g)) for g in result.get("datasets", [])
                ],
                note=result.get("note"),
            )

    return AvailabilityResponse(
        available=False,
        short_names_searched=resolve_short_names(dataset_id or "nisar_l2_gcov"),
        note=(
            "No NISAR granules found for this location and time range. "
            "NISAR science operations began in late 2025 — dates before that "
            "have no data. Orbital coverage, data gaps, or swath geometry "
            "can also leave an area uncovered. Try a wider date range."
        ),
    )


@router.get(
    "/observations/{observation_id}",
    response_model=ObservationNoteOut,
    summary="How to fetch one granule",
)
async def get_observation(observation_id: str):
    """Explain how to retrieve a specific granule (no fabricated metadata)."""
    return ObservationNoteOut(
        id=observation_id,
        note=(
            "Use GET /api/v1/observations?dataset_id=...&lat=...&lon=... "
            "to obtain real granule ids, acquisition dates and HTTPS/S3 "
            "download URLs. No metadata is invented for unknown ids."
        ),
        https_search="https://search.earthdata.nasa.gov/search",
    )


@router.get(
    "/geocode",
    response_model=List[GeocodeResultOut],
    summary="Geocode a place name via OpenStreetMap Nominatim",
)
async def geocode_place(
    q: str = Query(..., min_length=1, max_length=200, description="Place name or query"),
    limit: int = Query(1, ge=1, le=5, description="Max results"),
):
    """Server-side geocoding proxy with User-Agent, caching, and 1 req/s rate limit."""
    query = q.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query cannot be empty.")
    cache_key = f"{query.lower()}:{limit}"
    with cache.cache_lock:
        cached = cache.geocode_cache.get(cache_key)
    if cached is not None:
        return cached

    async with cache.geocode_lock:
        with cache.cache_lock:
            cached = cache.geocode_cache.get(cache_key)
        if cached is not None:
            return cached
        elapsed = time.monotonic() - cache.last_geocode_ts
        if cache.last_geocode_ts > 0 and elapsed < 1.0:
            await asyncio.sleep(1.0 - elapsed)
        try:
            async with httpx.AsyncClient(
                timeout=10.0,
                headers={"User-Agent": "TerraPulse/0.2 (https://github.com/terrapulse)"},
            ) as client:
                resp = await client.get(
                    "https://nominatim.openstreetmap.org/search",
                    params={"format": "jsonv2", "q": query, "limit": limit},
                )
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Geocoding service error: {e}")
        finally:
            cache.last_geocode_ts = time.monotonic()

    with cache.cache_lock:
        cache.geocode_cache[cache_key] = data
    return data
