import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import logging
import threading
import time
from typing import Any, Dict, List, Optional, Tuple
import uuid

from cachetools import TTLCache
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
import httpx

from app import db
from app.services.flood_analysis import (
    calculate_backscatter_difference,
    export_geojson,
    validate_observation_compatibility,
)
from app.services.nisar_provider import MAX_WINDOW_PIXELS, NISARDataProvider

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["v1"])

# UI dataset ids -> real CMR short names, tried in order. A raw CMR short
# name is also accepted directly as `dataset_id`.
SHORT_NAME_CANDIDATES: Dict[str, List[str]] = {
    "nisar_l2_gcov": ["NISAR_L2_GCOV_PROVISIONAL_V1", "NISAR_L2_GCOV_BETA_V1"],
    "nisar_l2_gcov_provisional": ["NISAR_L2_GCOV_PROVISIONAL_V1"],
    "nisar_l2_gcov_beta": ["NISAR_L2_GCOV_BETA_V1"],
}

# NISAR revisit is ~12 days, so exact-date searches usually miss. Search
# windows are widened symmetrically around each requested date.
SEARCH_HALF_WINDOW_DAYS = 6

# Backscatter is compared in decibels (standard for SAR change detection).
# A -2 dB drop is a strong, widely used flood-indicator threshold.
FLOOD_DB_THRESHOLD = -2.0

# Per-hazard reading of the SAME live dB-difference pipeline. "decrease" looks
# for darker-after pixels (standing water); "magnitude" looks for strong
# change in EITHER direction (new lava/ash, debris, canopy damage all alter
# roughness either way). Every hazard carries an explicit cannot-say list.
HAZARD_CONFIGS: Dict[str, Dict[str, Any]] = {
    "flood": {
        "label": "Flood / wetland change",
        "mode": "decrease",
        "threshold_db": -2.0,
        "interpretation": "Standing water is a smooth specular surface: L-band "
                          "backscatter drops sharply. Pixels darker by >2 dB are "
                          "flood candidates.",
        "cannot_say": ["Not a validated flood map", "Needs optical/field confirmation"],
    },
    "tsunami": {
        "label": "Tsunami coastal impact",
        "mode": "decrease",
        "threshold_db": -2.0,
        "interpretation": "Tsunami inundation leaves coastal flooding and wet debris: "
                          "look for newly dark pixels along the shoreline. Verify the "
                          "point is coastal and check event timing against the two "
                          "acquisition dates.",
        "cannot_say": ["Cannot confirm a tsunami occurred — any coastal flood looks similar",
                       "Needs tide gauge / eyewitness / optical confirmation"],
    },
    "hurricane": {
        "label": "Hurricane / storm damage",
        "mode": "both",
        "threshold_db": -2.0,
        "magnitude_db": 2.0,
        "interpretation": "Two signals: rainfall flooding (darker, >2 dB drop) plus "
                          "wind damage — stripped/defoliated canopy and debris change "
                          "roughness EITHER way (>2 dB absolute change).",
        "cannot_say": ["Cannot attribute damage to a specific storm without track data",
                       "Cannot estimate wind speed from backscatter"],
    },
    "volcano": {
        "label": "Volcanic eruption disturbance",
        "mode": "magnitude",
        "magnitude_db": 2.0,
        "interpretation": "Fresh lava flows, ash blankets and lahars resurface the "
                          "ground: roughness jumps either way, so strong absolute "
                          "change (>2 dB) flags fresh deposits. Compare against known "
                          "eruption dates for the volcano.",
        "cannot_say": ["Cannot detect eruptions with no surface deposits",
                       "Ash plumes themselves are not visible in this product",
                       "Not a deformation measurement"],
    },
    "earthquake": {
        "label": "Earthquake surface disturbance",
        "mode": "magnitude",
        "magnitude_db": 2.0,
        "interpretation": "Shaking triggers landslides, rockfalls, surface rupture and "
                          "liquefaction: disturbed ground changes roughness either "
                          "way. Strong absolute change (>2 dB) marks candidate "
                          "disturbed zones near the epicenter.",
        "cannot_say": ["NOT a displacement measurement — true ground deformation "
                       "requires InSAR (interferometric) products, not backscatter",
                       "Cannot give magnitude, depth or fault slip"],
    },
}

# Bounded TTL caches (jobs persist in SQLite via app.db).
SEARCH_CACHE_TTL = 600.0
WINDOW_CACHE_TTL = 3600.0
GEOCODE_CACHE_TTL = 3600.0
_cache_lock = threading.Lock()
_search_cache: TTLCache = TTLCache(maxsize=256, ttl=SEARCH_CACHE_TTL)
_window_cache: TTLCache = TTLCache(maxsize=64, ttl=WINDOW_CACHE_TTL)
_geocode_cache: TTLCache = TTLCache(maxsize=256, ttl=GEOCODE_CACHE_TTL)
_geocode_lock = asyncio.Lock()
_last_geocode_ts: float = 0.0

# Initialize data provider (lazy - will authenticate on first use)
_provider: Optional[NISARDataProvider] = None


def get_provider() -> NISARDataProvider:
    """Get or create the NISAR data provider instance."""
    global _provider
    if _provider is None:
        _provider = NISARDataProvider()
    return _provider


def resolve_short_names(dataset_id: str) -> List[str]:
    """Resolve a UI dataset id (or raw CMR short name) to candidates."""
    candidates = list(SHORT_NAME_CANDIDATES.get(dataset_id, []))
    if dataset_id not in SHORT_NAME_CANDIDATES:
        candidates.append(dataset_id)
    return list(dict.fromkeys(candidates))


def parse_granule_date(g: Dict[str, Any]) -> Optional[datetime]:
    raw = g.get("acquisition_date") or (g.get("temporal_begin") or "")[:10]
    try:
        return datetime.strptime(str(raw)[:10], "%Y-%m-%d")
    except (ValueError, TypeError):
        return None


def granule_key(g: Dict[str, Any]) -> Optional[str]:
    return g.get("id") or g.get("https_link")


def _granule_contains_point(
    g: Dict[str, Any], lat: Optional[float], lon: Optional[float]
) -> bool:
    if lat is None or lon is None:
        return True
    bb = g.get("bounding_box")
    if not bb or len(bb) != 4:
        return True
    try:
        w, s, e, n = (float(v) for v in bb)
        return (w <= lon <= e) and (s <= lat <= n)
    except (TypeError, ValueError):
        return True


def pick_pair(
    b_list: List[Dict[str, Any]],
    a_list: List[Dict[str, Any]],
    before_dt: datetime,
    after_dt: datetime,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
):
    """Choose the best before/after granule pair.

    Minimizes total date error while strongly preferring pairs that cover the
    target point and share the same orbit direction.
    """
    best = None  # (score, same_orbit, cb, ca)
    for cb in b_list or []:
        for ca in a_list or []:
            kb, ka = granule_key(cb), granule_key(ca)
            if not kb or kb == ka:
                continue
            db_dt, da_dt = parse_granule_date(cb), parse_granule_date(ca)
            if db_dt is None or da_dt is None:
                continue
            err = abs((db_dt - before_dt).days) + abs((da_dt - after_dt).days)
            ob = (cb.get("orbit_direction") or "unknown").lower()
            oa = (ca.get("orbit_direction") or "unknown").lower()
            same_orbit = ob != "unknown" and ob == oa
            covers = _granule_contains_point(cb, lat, lon) and _granule_contains_point(ca, lat, lon)
            score = err + (0 if same_orbit else 30) + (0 if covers else 1000)
            if best is None or score < best[0]:
                best = (score, same_orbit, cb, ca)
    if best is None:
        return None, None
    return (best[2], best[3]), {"same_orbit": best[1]}


def summarize_granule(g: Dict[str, Any]) -> Dict[str, Any]:
    """JSON-safe subset of granule metadata for API responses."""
    return {
        "id": g.get("id"),
        "title": g.get("title"),
        "short_name": g.get("short_name"),
        "acquisition_date": g.get("acquisition_date"),
        "orbit_direction": g.get("orbit_direction") or "unknown",
        "bounding_box": g.get("bounding_box"),
        "https_url": g.get("https_link"),
        "s3_url": g.get("s3_link"),
        "browse_url": g.get("browse_url"),
    }


def cached_search(provider, short_name, temporal, bbox, count=20):
    key = str((short_name, temporal[0], temporal[1],
               round(bbox[0], 2), round(bbox[1], 2), round(bbox[2], 2), round(bbox[3], 2), count))
    with _cache_lock:
        hit = _search_cache.get(key)
    if hit is not None:
        logger.info("CMR search cache hit for %s", short_name)
        return hit
    results = provider.search_datasets(
        short_name=short_name, temporal=temporal, bbox=bbox, count=count)
    with _cache_lock:
        _search_cache[key] = results
    return results


def cached_window(
    provider,
    granule,
    band,
    window: int = 256,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
):
    key = granule_key(granule) or ""
    lat_k = f"{lat:.4f}" if lat is not None else "center"
    lon_k = f"{lon:.4f}" if lon is not None else "center"
    cache_key = f"{key}:{band}:{window}:{lat_k}:{lon_k}"
    with _cache_lock:
        hit = _window_cache.get(cache_key)
    if hit is not None:
        logger.info("Window cache hit for %s", (granule.get("title") or "")[:40])
        return hit
    values = provider.stream_backscatter_window(
        granule.get("https_link"), band=band, window=window, lat=lat, lon=lon
    )
    with _cache_lock:
        _window_cache[cache_key] = values
    return values


def set_stage(job_id: str, stage: str, progress: int):
    db.update_job(job_id, stage=stage, progress=progress)


def _window_bounds_wgs84(
    x_coords: Any,
    y_coords: Any,
    crs_str: str,
    spacing_m: Optional[List[float]] = None,
) -> Optional[List[List[float]]]:
    """Compute [[south, west], [north, east]] WGS84 bounds for a coordinate window."""
    try:
        import numpy as np
        from pyproj import Transformer

        xs = np.asarray(x_coords, dtype=np.float64)
        ys = np.asarray(y_coords, dtype=np.float64)
        if xs.size == 0 or ys.size == 0:
            return None
        hx = (
            abs(float(spacing_m[0])) / 2.0
            if spacing_m and len(spacing_m) >= 2
            else (abs(float(xs[1] - xs[0])) / 2.0 if xs.size > 1 else 0.0)
        )
        hy = (
            abs(float(spacing_m[1])) / 2.0
            if spacing_m and len(spacing_m) >= 2
            else (abs(float(ys[1] - ys[0])) / 2.0 if ys.size > 1 else 0.0)
        )
        x_min, x_max = float(np.min(xs)) - hx, float(np.max(xs)) + hx
        y_min, y_max = float(np.min(ys)) - hy, float(np.max(ys)) + hy
        if str(crs_str or "EPSG:4326").upper() != "EPSG:4326":
            transformer = Transformer.from_crs(crs_str, "EPSG:4326", always_xy=True)
            lons, lats = transformer.transform(
                [x_min, x_max, x_min, x_max], [y_min, y_min, y_max, y_max]
            )
            return [[min(lats), min(lons)], [max(lats), max(lons)]]
        return [[y_min, x_min], [y_max, x_max]]
    except Exception:
        return None


@router.get("/health", response_model=dict, summary="Health check endpoint")
async def health():
    """Root health check endpoint."""
    return {"status": "healthy", "service": "terrapulse-backend"}


@router.get("/regions", response_model=List[dict], summary="Available monitoring regions")
async def get_regions():
    """Get reference monitoring regions for NISAR data analysis."""
    regions = [
        {"id": "amazon", "name": "Amazon Basin", "country": "Brazil",
         "lat": -1.5, "lon": -52.0},
        {"id": "mekong", "name": "Mekong Delta", "country": "Vietnam",
         "lat": 10.0, "lon": 105.0},
        {"id": "sahel", "name": "Sahel Region", "countries": ["Niger", "Nigeria", "Chad"],
         "lat": 13.5, "lon": 2.1},
        {"id": "andean", "name": "Andean Region", "countries": ["Peru", "Bolivia", "Argentina"],
         "lat": -13.0, "lon": -72.0},
    ]
    logger.info("Fetched %d regions", len(regions))
    return regions


@router.get("/datasets", response_model=List[dict], summary="Available NISAR datasets")
async def get_datasets():
    """List supported NISAR products (real CMR short names included)."""
    return [
        {
            "id": "nisar_l2_gcov",
            "short_name": "NISAR_L2_GCOV_PROVISIONAL_V1",
            "fallback_short_name": "NISAR_L2_GCOV_BETA_V1",
            "name": "NISAR Level-2 Geocoded Polarimetric Covariance (PROVISIONAL)",
            "provider": "NASA/ISRO via ASF DAAC",
            "description": "Calibrated, geocoded polarimetric covariance grids. "
                           "Used by TerraPulse for backscatter change indicators.",
            "product_type": "Geocoded Polarimetric products",
            "spatial_resolution": "~30 m",
            "polarizations": ["HH", "HV", "VV"],
        },
        {
            "id": "nisar_l2_gcov_beta",
            "short_name": "NISAR_L2_GCOV_BETA_V1",
            "name": "NISAR Level-2 Geocoded Polarimetric Covariance (BETA)",
            "provider": "NASA/ISRO via ASF DAAC",
            "description": "Pre-calibration GCOV release. Useful where PROVISIONAL "
                           "coverage is unavailable.",
            "product_type": "Geocoded Polarimetric products",
            "spatial_resolution": "~30 m",
            "polarizations": ["HH", "HV", "VV"],
        },
    ]


@router.get("/datasets/{dataset_id}", response_model=dict, summary="Get dataset details")
async def get_dataset(dataset_id: str):
    """Get detailed information about a supported dataset."""
    provider = get_provider()
    short_names = resolve_short_names(dataset_id)
    info = provider.get_product_info(short_names[0])
    return {
        "id": dataset_id,
        "short_name": short_names[0],
        "fallback_short_names": short_names[1:],
        "name": info["name"],
        "provider": "NASA/ISRO via ASF DAAC",
        "description": info["description"],
        "product_type": info["product_type"],
        "spatial_resolution": info["spatial_resolution"],
        "polarizations": info["polarizations"],
        "orbit": info["orbit"],
    }


@router.get("/observations", response_model=List[dict], summary="Search live NISAR observations")
async def get_observations(
    dataset_id: Optional[str] = Query(None, description="Dataset id or CMR short name"),
    lat: Optional[float] = Query(None, description="Latitude filter"),
    lon: Optional[float] = Query(None, description="Longitude filter"),
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
):
    """Search live NISAR granules via CMR. No query parameters returns [].

    Every returned entry is a real granule with its real acquisition date,
    bounding box and download URLs. Nothing is fabricated.
    """
    if dataset_id is None or lat is None or lon is None:
        return []

    provider = get_provider()
    if not provider.is_authenticated():
        if not provider.authenticate():
            raise HTTPException(
                status_code=401,
                detail="NASA Earthdata authentication required: set "
                "NASA_EARTHDATA_USERNAME and NASA_EARTHDATA_PASSWORD in backend/.env.",
            )

    window = 60.0 / 111.0  # ~60 km box
    bbox = [lon - window, lat - window, lon + window, lat + window]
    temporal = None
    if start_date and end_date:
        temporal = (start_date, end_date)

    found: List[dict] = []
    errors: List[str] = []
    for sn in resolve_short_names(dataset_id):
        try:
            for g in cached_search(provider, sn, temporal or ("2026-01-01", "2026-12-31"),
                                   bbox, count=20):
                found.append({
                    "id": g.get("id"),
                    "title": g.get("title"),
                    "short_name": g.get("short_name"),
                    "dataset_id": dataset_id,
                    "acquisition_date": g.get("acquisition_date"),
                    "orbit_direction": g.get("orbit_direction") or "unknown",
                    "location": {"lat": lat, "lon": lon},
                    "bounding_box": g.get("bounding_box"),
                    "https_url": g.get("https_link"),
                    "s3_url": g.get("s3_link"),
                })
            if found:
                break
        except Exception as e:
            errors.append(f"{sn}: {e}")
    if not found and errors:
        raise HTTPException(status_code=502, detail="CMR search failed: " + "; ".join(errors))
    logger.info("Found %d live observations for %s", len(found), dataset_id)
    return found


@router.get("/observations/availability", summary="Check live NISAR data availability")
async def check_availability(
    lat: float = Query(..., description="Latitude"),
    lon: float = Query(..., description="Longitude"),
    start_date: str = Query(..., description="Start date (YYYY-MM-DD)"),
    end_date: str = Query(..., description="End date (YYYY-MM-DD)"),
    dataset_id: Optional[str] = Query("nisar_l2_gcov", description="Dataset id or CMR short name"),
):
    """Check live NISAR granule availability for an area and time range."""
    provider = get_provider()
    if not provider.is_authenticated():
        if not provider.authenticate():
            raise HTTPException(
                status_code=401,
                detail="NASA Earthdata authentication required: set "
                "NASA_EARTHDATA_USERNAME and NASA_EARTHDATA_PASSWORD in backend/.env.",
            )

    for sn in resolve_short_names(dataset_id or "nisar_l2_gcov"):
        try:
            result = provider.check_availability(
                lat=lat, lon=lon,
                start_date=start_date, end_date=end_date,
                short_name=sn,
            )
        except Exception as e:
            logger.warning("Availability check failed for %s: %s", sn, e)
            continue
        if result.get("available"):
            result["short_name"] = sn
            result["datasets"] = [summarize_granule(g) for g in result.get("datasets", [])]
            return result

    return {
        "available": False,
        "short_names_searched": resolve_short_names(dataset_id or "nisar_l2_gcov"),
        "note": "No NISAR granules found for this location and time range. "
                "NISAR science operations began in late 2025 — dates before that "
                "have no data. Orbital coverage, data gaps, or swath geometry "
                "can also leave an area uncovered. Try a wider date range.",
    }


@router.get("/observations/{observation_id}", response_model=dict, summary="How to fetch one granule")
async def get_observation(observation_id: str):
    """Explain how to retrieve a specific granule (no fabricated metadata)."""
    return {
        "id": observation_id,
        "note": "Use GET /api/v1/observations?dataset_id=...&lat=...&lon=... "
                "to obtain real granule ids, acquisition dates and HTTPS/S3 "
                "download URLs. No metadata is invented for unknown ids.",
        "https_search": "https://search.earthdata.nasa.gov/search",
    }


@router.get("/geocode", summary="Geocode a place name via OpenStreetMap Nominatim")
async def geocode_place(
    q: str = Query(..., min_length=1, max_length=200, description="Place name or query"),
    limit: int = Query(1, ge=1, le=5, description="Max results"),
):
    """Server-side geocoding proxy with User-Agent, caching, and 1 req/s rate limit."""
    query = q.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query cannot be empty.")
    cache_key = f"{query.lower()}:{limit}"
    with _cache_lock:
        cached = _geocode_cache.get(cache_key)
    if cached is not None:
        return cached

    global _last_geocode_ts
    async with _geocode_lock:
        with _cache_lock:
            cached = _geocode_cache.get(cache_key)
        if cached is not None:
            return cached
        elapsed = time.monotonic() - _last_geocode_ts
        if _last_geocode_ts > 0 and elapsed < 1.0:
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
            _last_geocode_ts = time.monotonic()

    with _cache_lock:
        _geocode_cache[cache_key] = data
    return data


def _run_analysis_job(job_id: str, params: Dict[str, Any]):
    """Background worker: live granule discovery + windowed change detection."""
    import numpy as np
    import xarray as xr

    def fail(message: str, extra: Optional[Dict[str, Any]] = None):
        full_msg = message
        if extra and extra.get("warnings"):
            full_msg = f"{message} ({'; '.join(str(w) for w in extra['warnings'])})"
        db.update_job(job_id, status="failed", error=full_msg)
        logger.warning("Job %s failed: %s", job_id, full_msg)

    hazard = (params.get("hazard") or "flood").lower()
    config = HAZARD_CONFIGS.get(hazard)
    if config is None:
        fail(f"Unknown hazard '{hazard}'. Supported: {sorted(HAZARD_CONFIGS)}.")
        return
    before_date = params.get("before_date")
    after_date = params.get("after_date")
    auto_dates = not before_date or not after_date
    lat, lon = float(params["lat"]), float(params["lon"])
    dataset_id, band = params["dataset_id"], params["band"]
    req_window = max(64, min(int(params.get("window") or 256), MAX_WINDOW_PIXELS))
    before_dt = after_dt = None
    if not auto_dates:
        try:
            before_dt = datetime.strptime(before_date, "%Y-%m-%d")
            after_dt = datetime.strptime(after_date, "%Y-%m-%d")
        except (ValueError, TypeError):
            fail("Invalid date format. Use YYYY-MM-DD for both dates, or omit both for auto.")
            return
        if after_dt <= before_dt:
            fail("After date must be after before date.")
            return

    try:
        set_stage(job_id, "authenticating", 5)
        provider = get_provider()
        if not provider.is_authenticated() and not provider.authenticate():
            fail("NASA Earthdata authentication required: set "
                 "NASA_EARTHDATA_USERNAME and NASA_EARTHDATA_PASSWORD in backend/.env.")
            return

        set_stage(job_id, "searching CMR catalogs", 20)
        half = timedelta(days=SEARCH_HALF_WINDOW_DAYS)
        bbox = [lon - 1.0, lat - 1.0, lon + 1.0, lat + 1.0]
        before_g = after_g = None
        pair_info: Dict[str, Any] = {}
        used_short_name = None
        notes: List[str] = []

        def _search(sn: str, start: str, end: str):
            return cached_search(provider, sn, (start, end), bbox, count=50)

        if auto_dates:
            # Newest granule covering point in the last 90 days + newest one >=12 days older.
            end = datetime.now().strftime("%Y-%m-%d")
            start = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
            for sn in resolve_short_names(dataset_id):
                try:
                    all_g = _search(sn, start, end)
                except Exception as e:
                    notes.append(f"{sn}: search error ({e})")
                    continue
                dated = [(g, parse_granule_date(g)) for g in all_g]
                dated = [(g, d) for g, d in dated if d is not None]
                dated.sort(key=lambda t: t[1], reverse=True)
                notes.append(f"{sn}: {len(dated)} granules in last 90 days")
                if not dated:
                    continue
                covering = [(g, d) for g, d in dated if _granule_contains_point(g, lat, lon)]
                pool_dated = covering if len(covering) >= 2 else dated
                ca, da = pool_dated[0]
                best = None
                for g, d in pool_dated[1:]:
                    if (da - d).days < 12 or granule_key(g) == granule_key(ca):
                        continue
                    ob = (g.get("orbit_direction") or "unknown").lower()
                    oa = (ca.get("orbit_direction") or "unknown").lower()
                    same = ob != "unknown" and ob == oa
                    if best is None or (same and not best[2]):
                        best = (g, d, same)
                        if same:
                            break
                if best is None:
                    notes.append(f"{sn}: no second pass >= 12 days older")
                    continue
                before_g, b_dt = best[0], best[1]
                after_g, a_dt = ca, da
                before_date, after_date = b_dt.strftime("%Y-%m-%d"), da.strftime("%Y-%m-%d")
                before_dt, after_dt = b_dt, da
                pair_info = {"same_orbit": best[2], "auto": True}
                used_short_name = sn
                break
        else:
            for sn in resolve_short_names(dataset_id):
                try:
                    b_list = cached_search(
                        provider, sn,
                        ((before_dt - half).strftime("%Y-%m-%d"),
                         (before_dt + half).strftime("%Y-%m-%d")),
                        bbox)
                    a_list = cached_search(
                        provider, sn,
                        ((after_dt - half).strftime("%Y-%m-%d"),
                         (after_dt + half).strftime("%Y-%m-%d")),
                        bbox)
                except Exception as e:
                    notes.append(f"{sn}: search error ({e})")
                    continue
                notes.append(f"{sn}: {len(b_list)} before-window, {len(a_list)} after-window granules")
                # pick_pair returns ((cb, ca), info) or (None, None)
                picked, info = pick_pair(b_list, a_list, before_dt, after_dt, lat=lat, lon=lon)
                if picked is not None:
                    before_g, after_g = picked
                    pair_info = info or {}
                    used_short_name = sn
                    break
        if before_g is None or after_g is None:
            fail("No pair of distinct NISAR granules found near "
                 f"({lat}, {lon}) for {before_date} / {after_date}. " + " ".join(notes) +
                 " NISAR science operations began in late 2025. Try dates >= 12 days "
                 "apart within the last 12 months.")
            return

        set_stage(job_id, "streaming granule windows (1/2)", 45)
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                fb = pool.submit(cached_window, provider, before_g, band, req_window, lat, lon)
                set_stage(job_id, "streaming granule windows (2/2)", 60)
                fa = pool.submit(cached_window, provider, after_g, band, req_window, lat, lon)
                b_win, a_win = fb.result(), fa.result()
        except ValueError as e:
            fail(str(e))
            return
        except RuntimeError as e:
            db.save_job_result(job_id, {
                "success": True,
                "status": "metadata_only",
                "method": "backscatter_difference_flood_indicator",
                "data_source": "NASA-ISRO NISAR via NASA Earthdata (live CMR metadata)",
                "requested_dates": {"before": before_date, "after": after_date},
                "location": {"lat": lat, "lon": lon},
                "short_name": used_short_name,
                "before_granule": summarize_granule(before_g),
                "after_granule": summarize_granule(after_g),
                "processing_note": f"Granules found, but windowed pixel streaming "
                                   f"failed ({e}). Download the products via the "
                                   f"https_url links (Earthdata Login) for full analysis.",
                "caveats_and_limitations": [
                    "Pixel-level comparison was not performed for this pair.",
                    "Use the provided HTTPS/S3 URLs to download the real products.",
                ],
                "produced_at": datetime.now().isoformat() + "Z",
            })
            return

        set_stage(job_id, "computing backscatter difference", 85)

        # Convert linear power to decibels (standard SAR change-detection units)
        # BEFORE differencing: dB_after - dB_before.
        eps = 1e-9
        b_db = 10.0 * np.log10(np.maximum(np.asarray(b_win["values"],
                                                     dtype=np.float64), eps))
        a_db = 10.0 * np.log10(np.maximum(np.asarray(a_win["values"],
                                                     dtype=np.float64), eps))
        bx = np.asarray(
            b_win.get("x_coords") if b_win.get("x_coords") is not None else np.arange(b_db.shape[1]),
            dtype=np.float64,
        )
        by = np.asarray(
            b_win.get("y_coords") if b_win.get("y_coords") is not None else np.arange(b_db.shape[0]),
            dtype=np.float64,
        )
        ax = np.asarray(
            a_win.get("x_coords") if a_win.get("x_coords") is not None else np.arange(a_db.shape[1]),
            dtype=np.float64,
        )
        ay = np.asarray(
            a_win.get("y_coords") if a_win.get("y_coords") is not None else np.arange(a_db.shape[0]),
            dtype=np.float64,
        )
        ob = (before_g.get("orbit_direction") or "unknown").lower()
        oa = (after_g.get("orbit_direction") or "unknown").lower()
        before_ds = xr.Dataset({"sigma0_db": (["y", "x"], b_db)}, coords={"y": by, "x": bx})
        before_ds.attrs = {"polarizations": band, "orbit_direction": ob,
                           "acquisition_date": before_g.get("acquisition_date") or before_date,
                           "source_layer": b_win["variable"],
                           "source_granule": before_g.get("id"),
                           "crs": b_win.get("crs", "EPSG:4326")}
        after_ds = xr.Dataset({"sigma0_db": (["y", "x"], a_db)}, coords={"y": ay, "x": ax})
        after_ds.attrs = {"polarizations": band, "orbit_direction": oa,
                          "acquisition_date": after_g.get("acquisition_date") or after_date,
                          "source_layer": a_win["variable"],
                          "source_granule": after_g.get("id"),
                          "crs": a_win.get("crs", "EPSG:4326")}

        if b_win.get("epsg") == a_win.get("epsg") and (
            bx.shape != ax.shape
            or by.shape != ay.shape
            or not np.allclose(bx, ax)
            or not np.allclose(by, ay)
        ):
            sp_align = b_win.get("spacing_m") or a_win.get("spacing_m") or [20.0, 20.0]
            tol = max(abs(float(sp_align[0])), abs(float(sp_align[1]))) * 1.5
            after_ds = after_ds.reindex_like(before_ds, method="nearest", tolerance=tol)

        n = int(b_db.shape[0])
        compatibility = validate_observation_compatibility(before_ds, after_ds)
        if not compatibility.get("compatible", False):
            fail("Retrieved windows are not compatible for change detection.",
                 {"warnings": compatibility.get("warnings", []),
                  "checks": compatibility.get("checks", {}),
                  "before_granule": summarize_granule(before_g),
                  "after_granule": summarize_granule(after_g)})
            return

        difference_result = calculate_backscatter_difference(before_ds, after_ds, band=band)
        if "error" in difference_result:
            fail(f"Backscatter computation failed: {difference_result['error']}")
            return
        difference_mask = difference_result.pop("difference", None)
        difference_result.pop("before_backscatter", None)
        difference_result.pop("after_backscatter", None)

        # Hazard-specific reading of the same dB-difference array.
        mode = config.get("mode", "decrease")
        mag_db = float(config.get("magnitude_db", abs(FLOOD_DB_THRESHOLD)))
        thr_db = float(config.get("threshold_db", FLOOD_DB_THRESHOLD))
        valid = int(difference_result.get("valid_pixels") or 0)
        if difference_mask is not None and valid > 0:
            disturbed_pct = float(np.sum(np.abs(difference_mask) > mag_db) / valid * 100)
        else:
            disturbed_pct = 0.0
        if mode == "magnitude":
            outline_mask = -np.abs(difference_mask) if difference_mask is not None else None
            outline_thr = -mag_db
            outline_label = "disturbance_outlines"
        else:
            outline_mask = difference_mask
            outline_thr = thr_db
            outline_label = "flood_outlines"

        sp = b_win.get("spacing_m") or a_win.get("spacing_m")
        crs_str = b_win.get("crs", "EPSG:4326")
        geojson_result = export_geojson(
            difference_mask=outline_mask,
            crs=crs_str,
            threshold=outline_thr,
            x_coords=bx,
            y_coords=by,
            spacing_m=sp,
        )
        bounds_wgs84 = _window_bounds_wgs84(bx, by, crs_str, sp)

        # Real affected area: outline pixel counts x ground spacing.
        # Omitted (null) when spacing metadata is unavailable — never guessed.
        affected_area_km2 = None
        try:
            if sp:
                px = sum(int(f.get("properties", {}).get("pixel_count", 0))
                         for f in geojson_result.get("features", []))
                affected_area_km2 = px * abs(float(sp[0])) * abs(float(sp[1])) / 1e6
        except Exception:
            affected_area_km2 = None

        result_payload = {
            "success": True,
            "status": "analyzed",
            "method": "backscatter_difference_indicator (dB units)",
            "hazard": hazard,
            "hazard_label": config["label"],
            "interpretation": config["interpretation"],
            "data_source": "NASA-ISRO NISAR via NASA Earthdata (live granules, windowed streaming)",
            "requested_dates": {"before": before_date, "after": after_date},
            "auto_dates": auto_dates,
            "actual_granule_dates": {
                "before": before_g.get("acquisition_date"),
                "after": after_g.get("acquisition_date"),
            },
            "same_orbit_pair": pair_info.get("same_orbit", False),
            "location": {"lat": lat, "lon": lon},
            "short_name": used_short_name,
            "polarization_band": band,
            "threshold_db": thr_db if mode == "decrease" else mag_db,
            "detection_mode": mode,
            "windows": {
                "size": n,
                "requested_window": req_window,
                "before_layer": b_win["variable"],
                "after_layer": a_win["variable"],
                "before_origin": b_win["window_origin"],
                "before_shape": list(b_win["shape"]),
                "after_origin": a_win["window_origin"],
                "after_shape": list(a_win["shape"]),
                "crs": crs_str,
                "epsg": b_win.get("epsg"),
                "bounds": bounds_wgs84,
                "note": "Location-centered window comparison in dB, not full-swath analysis.",
            },
            "before_granule": summarize_granule(before_g),
            "after_granule": summarize_granule(after_g),
            "compatibility_check": {
                "compatible": compatibility.get("compatible", False),
                "warnings": compatibility.get("warnings", []),
            },
            "analysis": {
                "mean_backscatter_difference_db": difference_result.get("mean_difference"),
                "std_difference_db": difference_result.get("std_difference"),
                "percentage_decrease": difference_result.get("percentage_decrease"),
                "percentage_disturbed": disturbed_pct,
                "affected_area_km2": affected_area_km2,
                "area_basis": ("outline pixels x product ground spacing"
                               if affected_area_km2 is not None else
                               "unavailable (no spacing metadata in product)"),
                "valid_pixels": difference_result.get("valid_pixels"),
                "total_pixels": difference_result.get("total_pixels"),
            },
            "results": {outline_label: geojson_result},
            "caveats_and_limitations": [
                f"This is a change INDICATOR only, not a validated {hazard} map",
                "Comparison covers a location-centered window of each granule in dB units",
                "Backscatter changes can be caused by: vegetation condition, "
                "soil moisture, terrain — not just the target hazard",
                "NISAR L-band radar may miss changes under dense canopy",
                "Single-pair comparison cannot attribute change to a specific event",
                "Validate with field observations and auxiliary data",
            ] + [f"CANNOT conclude: {c}" for c in config.get("cannot_say", [])],
            "confidence": {
                "based_on": f"dB backscatter difference ({mode} mode) on live granule windows",
                "quality": "indicator-level",
                "requires_validation": "Field validation and auxiliary data recommended",
            },
            "produced_at": datetime.now().isoformat() + "Z",
        }
        db.save_job_result(job_id, result_payload)
        logger.info("Job %s complete [%s]: mean diff=%.3f dB, %.1f%% decrease, %.1f%% disturbed",
                    job_id, hazard, difference_result.get("mean_difference") or 0.0,
                    difference_result.get("percentage_decrease"), disturbed_pct)
    except Exception as e:
        logger.error("Job %s crashed: %s", job_id, e, exc_info=True)
        fail(f"Unexpected error: {e}")


@router.post("/analysis/change-detection", summary="Start live change detection job",
             status_code=202)
async def change_detection(
    background_tasks: BackgroundTasks,
    before_date: str = Query(..., description="Target before date (YYYY-MM-DD)"),
    after_date: str = Query(..., description="Target after date (YYYY-MM-DD)"),
    lat: float = Query(..., ge=-90, le=90, description="Center latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Center longitude"),
    dataset_id: str = Query("nisar_l2_gcov", description="Dataset id or CMR short name"),
    band: str = Query("HH", description="Polarization band"),
    window: int = Query(256, ge=64, le=MAX_WINDOW_PIXELS, description="Window size in pixels"),
) -> Dict[str, Any]:
    """Start a live NISAR flood-indicator analysis as a background job.

    Returns immediately with a job id — poll
    GET /api/v1/analysis/jobs/{job_id} for stage progress and the result.
    No synthetic or placeholder data is used anywhere in this pipeline.
    """
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
    background_tasks.add_task(_run_analysis_job, job_id, params)
    logger.info("Started flood analysis job %s for (%s, %s)", job_id, lat, lon)
    return {"job_id": job_id, "status": "running",
            "status_url": f"/api/v1/analysis/jobs/{job_id}",
            "message": "Analysis running in background — poll status_url for progress."}


@router.post("/analysis/hazard", summary="Start a multi-hazard live analysis job",
              status_code=202)
async def hazard_analysis(
    background_tasks: BackgroundTasks,
    hazard: str = Query(..., description="flood | tsunami | hurricane | volcano | earthquake"),
    lat: float = Query(..., ge=-90, le=90, description="Center latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Center longitude"),
    before_date: Optional[str] = Query(None, description="Target before date (YYYY-MM-DD); omit both for auto latest pair"),
    after_date: Optional[str] = Query(None, description="Target after date (YYYY-MM-DD)"),
    dataset_id: str = Query("nisar_l2_gcov", description="Dataset id or CMR short name"),
    band: str = Query("HH", description="Polarization band"),
    window: int = Query(256, ge=64, le=MAX_WINDOW_PIXELS, description="Window size in pixels"),
) -> Dict[str, Any]:
    """Start a hazard-specific live NISAR analysis as a background job.

    Omit both dates to auto-select the newest suitable granule pair.
    Poll GET /api/v1/analysis/jobs/{job_id} for progress and results.
    """
    hazard = (hazard or "").lower()
    if hazard not in HAZARD_CONFIGS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown hazard '{hazard}'. Supported: {sorted(HAZARD_CONFIGS)}.")
    if bool(before_date) != bool(after_date):
        raise HTTPException(
            status_code=400,
            detail="Provide both dates or neither (neither = auto latest pair).")
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
    background_tasks.add_task(_run_analysis_job, job_id, params)
    logger.info("Started %s job %s for (%s, %s)", hazard, job_id, lat, lon)
    return {"job_id": job_id, "status": "running",
            "status_url": f"/api/v1/analysis/jobs/{job_id}",
            "hazard": hazard,
            "message": "Analysis running in background — poll status_url for progress."}


@router.get("/analysis/point-insights", summary="Instant NISAR insights for a map point")
async def point_insights(
    lat: float = Query(..., description="Clicked latitude"),
    lon: float = Query(..., description="Clicked longitude"),
    dataset_id: str = Query("nisar_l2_gcov", description="Dataset id or CMR short name"),
):
    """Fast, pixel-free insights for a clicked map point: live coverage,
    granule count and the latest acquisition. Used for the map-click panel;
    full analysis runs via /analysis/hazard."""
    provider = get_provider()
    if not provider.is_authenticated():
        if not provider.authenticate():
            raise HTTPException(
                status_code=401,
                detail="NASA Earthdata authentication required: set "
                "NASA_EARTHDATA_USERNAME and NASA_EARTHDATA_PASSWORD in backend/.env.",
            )
    end = datetime.now().strftime("%Y-%m-%d")
    start = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
    window = 60.0 / 111.0
    bbox = [lon - window, lat - window, lon + window, lat + window]
    for sn in resolve_short_names(dataset_id):
        try:
            granules = cached_search(provider, sn, (start, end), bbox, count=20)
        except Exception as e:
            logger.warning("point-insights search failed for %s: %s", sn, e)
            continue
        dated = [(g, parse_granule_date(g)) for g in granules]
        dated = [(g, d) for g, d in dated if d is not None]
        dated.sort(key=lambda t: t[1], reverse=True)
        if dated:
            latest = dated[0][0]
            return {
                "available": True,
                "location": {"lat": lat, "lon": lon},
                "short_name": sn,
                "granules_last_90d": len(dated),
                "latest_acquisition": dated[0][1].strftime("%Y-%m-%d"),
                "latest_granule": summarize_granule(latest),
                "recent_acquisitions": [d.strftime("%Y-%m-%d") for _, d in dated[:6]],
                "supported_hazards": sorted(HAZARD_CONFIGS),
                "note": "Pixel analysis runs as a background job via /analysis/hazard.",
            }
    return {
        "available": False,
        "location": {"lat": lat, "lon": lon},
        "short_names_searched": resolve_short_names(dataset_id),
        "note": "No NISAR granules near this point in the last 90 days. "
                "Try another location or a wider area.",
    }


@router.get("/analysis/jobs", summary="List recent analysis jobs")
async def list_jobs(limit: int = Query(20, description="Max jobs, newest first")):
    """Job history for dashboards, event lists, alerts and reports.

    Only jobs actually run on this backend are listed — nothing is invented.
    """
    ordered = db.list_jobs(limit=limit)
    out = []
    for job in ordered:
        p = job.get("params", {}) or {}
        res = job.get("result") or {}
        an = res.get("analysis") or {}
        out.append({
            "job_id": job.get("job_id"),
            "status": job.get("status"),
            "stage": job.get("stage"),
            "progress": job.get("progress"),
            "hazard": p.get("hazard", "flood"),
            "location": {"lat": p.get("lat"), "lon": p.get("lon")},
            "requested_dates": {"before": p.get("before_date"), "after": p.get("after_date")},
            "actual_granule_dates": res.get("actual_granule_dates"),
            "auto_dates": res.get("auto_dates", False),
            "mean_db": an.get("mean_backscatter_difference_db"),
            "percentage_decrease": an.get("percentage_decrease"),
            "percentage_disturbed": an.get("percentage_disturbed"),
            "affected_area_km2": an.get("affected_area_km2"),
            "outlines": len(((res.get("results") or {}).get("flood_outlines")
                             or (res.get("results") or {}).get("disturbance_outlines") or {}).get("features", [])),
            "error": job.get("error"),
            "created_at": job.get("created_at"),
        })
    return out


@router.get("/analysis/jobs/{job_id}", summary="Get background job status/result")
async def get_job(job_id: str):
    """Poll a change-detection job: stage, progress %, and result when done."""
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job id '{job_id}'.")
    return job


@router.get("/analysis/{analysis_id}", summary="Get analysis result by ID")
async def get_analysis_result(analysis_id: str):
    """Get analysis result by analysis ID."""
    return {
        "analysis_id": analysis_id,
        "status": "completed",
        "message": "Analysis result retrieval - implementation pending persistent storage",
        "produced_at": None,
    }


@router.get("/auth/status", summary="Live Earthdata connection check")
async def auth_status():
    """Actually attempts authentication and reports the real outcome.

    Powers the Settings 'Test Connection' button. No credentials are returned.
    """
    provider = get_provider()
    ok = provider.is_authenticated() or provider.authenticate()
    return {
        "connected": bool(ok),
        "timestamp": datetime.now().isoformat() + "Z",
        "note": ("Authenticated with NASA Earthdata."
                 if ok else "Not authenticated — set NASA_EARTHDATA_USERNAME and "
                 "NASA_EARTHDATA_PASSWORD in backend/.env, then restart the backend."),
    }


@router.get("/metadata", summary="Get system metadata")
async def get_metadata():
    """Get system metadata including data sources and processing status."""
    return {
        "version": "0.2.0",
        "service": "TerraPulse Backend",
        "mode": "live-only (no synthetic data)",
        "data_sources": {
            "nisar": "NASA-ISRO Synthetic Aperture Radar mission",
            "earthdata": "NASA Earthdata Search / Earthaccess (CMR + authenticated HTTPS streaming)",
        },
        "supported_phenomena": [
            "flood monitoring (live dB backscatter change detection on GCOV windows)",
        ],
        "status": "operational",
        "data_provider": "NISAR via NASA Earthdata",
        "access_methods": ["authenticated HTTPS streaming (windowed)", "S3 URLs reported per granule"],
        "authentication": "Earthdata Login (EDL) required via backend/.env",
    }
