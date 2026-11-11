"""Shared bounded TTL caches and lazy NISAR provider singleton."""

import asyncio
import logging
import threading
from typing import Any, Dict, List, Optional, Tuple

from cachetools import TTLCache

from app.services.nisar_provider import NISARDataProvider

logger = logging.getLogger(__name__)

SEARCH_CACHE_TTL = 600.0
WINDOW_CACHE_TTL = 3600.0
GEOCODE_CACHE_TTL = 3600.0

cache_lock = threading.Lock()
search_cache: TTLCache = TTLCache(maxsize=256, ttl=SEARCH_CACHE_TTL)
collections_cache: TTLCache = TTLCache(maxsize=16, ttl=SEARCH_CACHE_TTL)
window_cache: TTLCache = TTLCache(maxsize=64, ttl=WINDOW_CACHE_TTL)
geocode_cache: TTLCache = TTLCache(maxsize=256, ttl=GEOCODE_CACHE_TTL)
geocode_lock = asyncio.Lock()
last_geocode_ts: float = 0.0

_provider: Optional[NISARDataProvider] = None


def get_provider() -> NISARDataProvider:
    """Get or create the singleton NISAR data provider instance."""
    global _provider
    if _provider is None:
        _provider = NISARDataProvider()
    return _provider


def granule_key(g: Dict[str, Any]) -> Optional[str]:
    return g.get("id") or g.get("https_link")


def cached_search(
    provider: NISARDataProvider,
    short_name: str,
    temporal: Tuple[str, str],
    bbox: List[float],
    count: int = 20,
) -> List[Dict[str, Any]]:
    key = str(
        (
            short_name,
            temporal[0],
            temporal[1],
            round(bbox[0], 2),
            round(bbox[1], 2),
            round(bbox[2], 2),
            round(bbox[3], 2),
            count,
        )
    )
    with cache_lock:
        hit = search_cache.get(key)
    if hit is not None:
        logger.info("CMR search cache hit for %s", short_name)
        return hit
    results = provider.search_datasets(
        short_name=short_name, temporal=temporal, bbox=bbox, count=count
    )
    with cache_lock:
        search_cache[key] = results
    return results


def cached_window(
    provider: NISARDataProvider,
    granule: Dict[str, Any],
    band: str,
    window: int = 256,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    bbox: Optional[List[float]] = None,
) -> Dict[str, Any]:
    key = granule_key(granule) or ""
    if bbox and len(bbox) == 4:
        loc_k = "bbox:" + ",".join(f"{float(v):.4f}" for v in bbox)
    else:
        lat_k = f"{lat:.4f}" if lat is not None else "center"
        lon_k = f"{lon:.4f}" if lon is not None else "center"
        loc_k = f"{lat_k}:{lon_k}"
    cache_key = f"{key}:{band}:{window}:{loc_k}"
    with cache_lock:
        hit = window_cache.get(cache_key)
    if hit is not None:
        logger.info("Window cache hit for %s", (granule.get("title") or "")[:40])
        return hit
    values = provider.stream_backscatter_window(
        granule.get("https_link"),
        band=band,
        window=window,
        lat=lat,
        lon=lon,
        bbox=bbox,
    )
    with cache_lock:
        window_cache[cache_key] = values
    return values


def cached_discover_collections(
    provider: NISARDataProvider,
    keyword: str = "NISAR",
    count: int = 50,
) -> List[Dict[str, Any]]:
    key = f"{keyword}:{count}"
    with cache_lock:
        hit = collections_cache.get(key)
    if hit is not None:
        return hit
    cols = provider.discover_nisar_collections(keyword=keyword, count=count)
    with cache_lock:
        collections_cache[key] = cols
    return cols


def warm_startup_caches() -> None:
    """Authenticate and pre-warm default Data Catalog CMR searches in background."""
    from concurrent.futures import ThreadPoolExecutor

    from app.services.hazards import SHORT_NAME_CANDIDATES

    try:
        provider = get_provider()
        if not provider.is_authenticated() and not provider.authenticate():
            return
        w = 60.0 / 111.0
        amazon_bbox = [-52.0 - w, -1.5 - w, -52.0 + w, -1.5 + w]
        temporal = ("2026-08-01", "2026-11-15")
        warm_sns = list(SHORT_NAME_CANDIDATES.get("nisar_l2_gcov", [])) + list(
            SHORT_NAME_CANDIDATES.get("nisar_l2_gunw", [])
        )
        with ThreadPoolExecutor(max_workers=6) as pool:
            pool.submit(cached_discover_collections, provider, "NISAR", 50)
            for sn in warm_sns:
                pool.submit(cached_search, provider, sn, temporal, amazon_bbox, 20)
        logger.info("Startup CMR catalog warm-up complete.")
    except Exception as e:
        logger.debug("Startup CMR warm-up skipped: %s", e)
