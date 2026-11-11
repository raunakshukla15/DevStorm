"""Live public disaster feeds (USGS Earthquakes + NASA EONET v3) with TTL caching."""

import logging
import threading
from typing import Any, Dict, List, Optional, Tuple

from cachetools import TTLCache
import httpx

logger = logging.getLogger(__name__)

_EVENT_FEED_TTL = 300.0
_feed_lock = threading.Lock()
_feed_cache: TTLCache = TTLCache(maxsize=16, ttl=_EVENT_FEED_TTL)

USGS_WEEKLY_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson"
EONET_OPEN_URL = "https://eonet.gsfc.nasa.gov/api/v3/events"

_EONET_CATEGORY_MAP = {
    "floods": "flood",
    "severeStorms": "hurricane",
    "volcanoes": "volcano",
    "earthquakes": "earthquake",
    "landslides": "landslide",
    "wildfires": "forest_disturbance",
}


def _normalize_usgs(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for feat in data.get("features") or []:
        coords = (feat.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        props = feat.get("properties") or {}
        ts_ms = props.get("time")
        date_str = ""
        if isinstance(ts_ms, (int, float)):
            from datetime import datetime, timezone

            date_str = datetime.fromtimestamp(ts_ms / 1000.0, tz=timezone.utc).strftime("%Y-%m-%d")
        mag = props.get("mag")
        out.append({
            "id": f"usgs:{feat.get('id')}",
            "source": "USGS",
            "title": str(props.get("title") or props.get("place") or "USGS Earthquake"),
            "hazard": "earthquake",
            "lat": float(coords[1]),
            "lon": float(coords[0]),
            "date": date_str,
            "magnitude": float(mag) if isinstance(mag, (int, float)) else None,
            "category": "Earthquake",
            "url": props.get("url"),
        })
    return out


def _normalize_eonet(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for ev in data.get("events") or []:
        cats = [c.get("id") for c in (ev.get("categories") or []) if isinstance(c, dict)]
        hazard = next((_EONET_CATEGORY_MAP[c] for c in cats if c in _EONET_CATEGORY_MAP), None)
        if hazard is None:
            continue
        geoms = ev.get("geometry") or []
        if not geoms:
            continue
        latest = geoms[-1]
        coords = latest.get("coordinates") or []
        gtype = latest.get("type")
        lon = lat = None
        if gtype in ("Point", None) and len(coords) >= 2 and isinstance(coords[0], (int, float)):
            lon, lat = float(coords[0]), float(coords[1])
        elif gtype == "Polygon" and coords and coords[0]:
            ring = coords[0]
            lons = [float(p[0]) for p in ring if len(p) >= 2]
            lats = [float(p[1]) for p in ring if len(p) >= 2]
            if lons and lats:
                lon, lat = sum(lons) / len(lons), sum(lats) / len(lats)
        if lat is None or lon is None:
            continue
        raw_date = str(latest.get("date") or "")[:10]
        cat_str = ", ".join(str(c) for c in cats if c) or None
        out.append({
            "id": f"eonet:{ev.get('id')}",
            "source": "EONET",
            "title": str(ev.get("title") or "EONET Event"),
            "hazard": hazard,
            "lat": lat,
            "lon": lon,
            "date": raw_date,
            "magnitude": None,
            "category": cat_str,
            "url": ev.get("link"),
        })
    return out


async def fetch_live_events(hazard: Optional[str] = None) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Fetch USGS + NASA EONET live hazard feeds, cached via TTLCache."""
    norm_hazard = (hazard or "").strip().lower() or None
    if norm_hazard == "all":
        norm_hazard = None

    with _feed_lock:
        cached = _feed_cache.get("all")

    if cached is not None:
        events, errors = cached
    else:
        events = []
        errors = []
        async with httpx.AsyncClient(
            timeout=10.0,
            headers={"User-Agent": "TerraPulse/0.2"},
        ) as client:
            if norm_hazard in (None, "earthquake"):
                try:
                    r = await client.get(USGS_WEEKLY_URL)
                    r.raise_for_status()
                    events.extend(_normalize_usgs(r.json()))
                except Exception as e:
                    logger.warning("USGS feed failed: %s", e)
                    errors.append(f"USGS feed unavailable ({e})")
            try:
                r = await client.get(EONET_OPEN_URL, params={"status": "open", "limit": 40})
                r.raise_for_status()
                events.extend(_normalize_eonet(r.json()))
            except Exception as e:
                logger.warning("EONET feed failed: %s", e)
                errors.append(f"NASA EONET feed unavailable ({e})")

        events.sort(key=lambda item: item.get("date") or "", reverse=True)
        # Only cache clean or full fetches; if hazard was restricted to earthquake don't poison 'all'
        if norm_hazard is None and events:
            with _feed_lock:
                _feed_cache["all"] = (events, errors)

    if norm_hazard:
        events = [e for e in events if e.get("hazard") == norm_hazard]
    return events, errors
