"""Multi-date NISAR SAR backscatter time-series background worker."""

from datetime import datetime, timedelta
import logging
from typing import Any, Dict, List, Optional

import numpy as np

from app import db
from app.services import cache
from app.services.hazards import resolve_short_names
from app.services.job_runner import parse_granule_date

logger = logging.getLogger(__name__)


def run_timeseries_job(
    series_id: str,
    lat: float,
    lon: float,
    band: str = "HH",
    months: int = 6,
    dataset_id: str = "nisar_l2_gcov",
    window: int = 64,
) -> None:
    """Query CMR for recent NISAR granules and stream 64x64 stats into SQLite."""
    db.upsert_timeseries_job(series_id, lat, lon, band, months, status="running")
    try:
        provider = cache.get_provider()
        if not provider.is_authenticated() and not provider.authenticate():
            db.upsert_timeseries_job(
                series_id,
                lat,
                lon,
                band,
                months,
                status="failed",
                error="NASA Earthdata authentication required (set credentials in backend/.env).",
            )
            return

        end_dt = datetime.now()
        start_dt = end_dt - timedelta(days=max(1, int(months)) * 30)
        bbox = [lon - 0.5, lat - 0.5, lon + 0.5, lat + 0.5]

        granules: List[Dict[str, Any]] = []
        for sn in resolve_short_names(dataset_id):
            try:
                found = cache.cached_search(
                    provider,
                    sn,
                    (start_dt.strftime("%Y-%m-%d"), end_dt.strftime("%Y-%m-%d")),
                    bbox,
                    count=40,
                )
                if found:
                    granules = found
                    break
            except Exception as e:
                logger.warning("Timeseries CMR search failed for %s: %s", sn, e)

        # Deduplicate by granule id / title and sort chronologically ascending
        dedup: Dict[str, Dict[str, Any]] = {}
        for g in granules:
            gid = str(cache.granule_key(g) or g.get("title") or "")
            dt = parse_granule_date(g)
            if gid and dt is not None and gid not in dedup:
                dedup[gid] = {**g, "_dt": dt}
        ordered = sorted(dedup.values(), key=lambda item: item["_dt"])

        existing = {
            p["granule_id"] for p in db.get_timeseries_points(series_id) if p.get("granule_id")
        }
        total = len(ordered)
        db.upsert_timeseries_job(
            series_id,
            lat,
            lon,
            band,
            months,
            status="running",
            total_granules=total,
            processed_granules=len(existing),
        )

        eps = 1e-9
        processed = len(existing)
        for g in ordered:
            gid = str(cache.granule_key(g) or g.get("title") or "")
            if gid in existing:
                continue
            try:
                win = cache.cached_window(provider, g, band=band, window=window, lat=lat, lon=lon)
                vals = np.asarray(win["values"], dtype=np.float64)
                pos = np.isfinite(vals) & (vals > 0)
                if not np.any(pos):
                    processed += 1
                    db.upsert_timeseries_job(
                        series_id, lat, lon, band, months,
                        status="running", total_granules=total, processed_granules=processed,
                    )
                    continue
                db_vals = 10.0 * np.log10(np.maximum(vals[pos], eps))
                db.add_timeseries_point(
                    series_id=series_id,
                    granule_id=gid,
                    acquisition_date=g["_dt"].strftime("%Y-%m-%d"),
                    mean_db=round(float(np.mean(db_vals)), 3),
                    std_db=round(float(np.std(db_vals)), 3),
                    orbit_direction=str(g.get("orbit_direction") or "unknown"),
                    valid_pixels=int(pos.sum()),
                )
            except Exception as e:
                logger.info("Skipping granule %s in timeseries %s: %s", gid, series_id, e)
            processed += 1
            db.upsert_timeseries_job(
                series_id,
                lat,
                lon,
                band,
                months,
                status="running",
                total_granules=total,
                processed_granules=processed,
            )

        db.upsert_timeseries_job(
            series_id,
            lat,
            lon,
            band,
            months,
            status="completed",
            total_granules=total,
            processed_granules=processed,
        )
    except Exception as e:
        logger.error("Timeseries job %s failed: %s", series_id, e, exc_info=True)
        db.upsert_timeseries_job(
            series_id, lat, lon, band, months, status="failed", error=str(e)
        )
