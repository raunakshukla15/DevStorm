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
    key = str((
        short_name,
        temporal[0],
        temporal[1],
        round(bbox[0], 2),
        round(bbox[1], 2),
        round(bbox[2], 2),
        round(bbox[3], 2),
        count,
    ))
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
) -> Dict[str, Any]:
    key = granule_key(granule) or ""
    lat_k = f"{lat:.4f}" if lat is not None else "center"
    lon_k = f"{lon:.4f}" if lon is not None else "center"
    cache_key = f"{key}:{band}:{window}:{lat_k}:{lon_k}"
    with cache_lock:
        hit = window_cache.get(cache_key)
    if hit is not None:
        logger.info("Window cache hit for %s", (granule.get("title") or "")[:40])
        return hit
    values = provider.stream_backscatter_window(
        granule.get("https_link"), band=band, window=window, lat=lat, lon=lon
    )
    with cache_lock:
        window_cache[cache_key] = values
    return values
