"""Backward-compatible re-export shim for app.routers.api_router and services."""

import httpx

from app.routers import api_router as router
from app.services import cache as _cache
from app.services.cache import (
    GEOCODE_CACHE_TTL,
    SEARCH_CACHE_TTL,
    WINDOW_CACHE_TTL,
    cached_search,
    cached_window,
    get_provider,
    granule_key,
)
from app.services.hazards import (
    FLOOD_DB_THRESHOLD,
    HAZARD_CONFIGS,
    SEARCH_HALF_WINDOW_DAYS,
    SHORT_NAME_CANDIDATES,
    resolve_short_names,
)
from app.services.job_runner import (
    _granule_contains_point,
    _window_bounds_wgs84,
    parse_granule_date,
    pick_pair,
    run_analysis_job as _run_analysis_job,
    set_stage,
    summarize_granule,
)

_search_cache = _cache.search_cache
_window_cache = _cache.window_cache
_geocode_cache = _cache.geocode_cache

__all__ = [
    "FLOOD_DB_THRESHOLD",
    "GEOCODE_CACHE_TTL",
    "HAZARD_CONFIGS",
    "SEARCH_CACHE_TTL",
    "SEARCH_HALF_WINDOW_DAYS",
    "SHORT_NAME_CANDIDATES",
    "WINDOW_CACHE_TTL",
    "_geocode_cache",
    "_granule_contains_point",
    "_run_analysis_job",
    "_search_cache",
    "_window_bounds_wgs84",
    "_window_cache",
    "cached_search",
    "cached_window",
    "get_provider",
    "granule_key",
    "httpx",
    "parse_granule_date",
    "pick_pair",
    "resolve_short_names",
    "router",
    "set_stage",
    "summarize_granule",
]
