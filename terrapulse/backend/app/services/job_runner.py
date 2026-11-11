"""Background job execution, granule pair selection, and change analysis pipeline."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import logging
import os
import threading
import time
from typing import Any, Dict, List, Optional

import numpy as np
import xarray as xr

from app import db
from app.services import cache, masks, renders
from app.services.flood_analysis import (
    CONFIDENCE_FORMULA,
    SEVERITY_RULE,
    apply_speckle_filter,
    calculate_backscatter_difference,
    compute_otsu_threshold,
    compute_polygon_confidence,
    compute_severity_area_confidence,
    export_geojson,
    validate_observation_compatibility,
)
from app.services.hazards import (
    FLOOD_DB_THRESHOLD,
    HAZARD_CONFIGS,
    SEARCH_HALF_WINDOW_DAYS,
    resolve_short_names,
)
from app.services.nisar_provider import MAX_WINDOW_PIXELS

logger = logging.getLogger(__name__)

_JOB_SEMAPHORE_LOCK = threading.Lock()
_JOB_SEMAPHORE_CAP: Optional[int] = None
_JOB_SEMAPHORE: Optional[threading.Semaphore] = None


def _get_job_semaphore() -> threading.Semaphore:
    """Return process-wide job concurrency cap semaphore (configurable via MAX_CONCURRENT_JOBS)."""
    global _JOB_SEMAPHORE_CAP, _JOB_SEMAPHORE
    cap = max(1, int(os.getenv("MAX_CONCURRENT_JOBS", "2")))
    with _JOB_SEMAPHORE_LOCK:
        if _JOB_SEMAPHORE is None or _JOB_SEMAPHORE_CAP != cap:
            _JOB_SEMAPHORE_CAP = cap
            _JOB_SEMAPHORE = threading.Semaphore(cap)
        return _JOB_SEMAPHORE


def parse_granule_date(g: Dict[str, Any]) -> Optional[datetime]:
    raw = g.get("acquisition_date") or (g.get("temporal_begin") or "")[:10]
    try:
        return datetime.strptime(str(raw)[:10], "%Y-%m-%d")
    except (ValueError, TypeError):
        return None


def _granule_contains_point(g: Dict[str, Any], lat: Optional[float], lon: Optional[float]) -> bool:
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
    target point, share the same orbit direction, and center closer to (lat, lon).
    """
    best = None
    for cb in b_list or []:
        for ca in a_list or []:
            kb, ka = cache.granule_key(cb), cache.granule_key(ca)
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
            center_penalty = 0.0
            if lat is not None and lon is not None:
                for cg in (cb, ca):
                    bb = cg.get("bounding_box")
                    if bb and len(bb) == 4:
                        cx = 0.5 * (bb[0] + bb[2])
                        cy = 0.5 * (bb[1] + bb[3])
                        center_penalty += min(abs(cx - lon) + abs(cy - lat), 5.0) * 0.05
            score = err + (0 if same_orbit else 30) + (0 if covers else 1000) + center_penalty
            if best is None or score < best[0]:
                best = (score, same_orbit, cb, ca)
    if best is None:
        return None, None
    return (best[2], best[3]), {"same_orbit": best[1]}


def compute_comparison_charts(
    before_db: np.ndarray,
    after_db: np.ndarray,
    diff_db: Optional[np.ndarray],
    spacing_m: Optional[List[float]] = None,
    threshold_db: float = -2.0,
) -> Dict[str, Any]:
    """Compute Before-vs-After distributions, class breakdowns, and transect strictly from raster pixels."""
    b_arr = np.asarray(before_db, dtype=np.float64)
    a_arr = np.asarray(after_db, dtype=np.float64)
    d_arr = np.asarray(diff_db, dtype=np.float64) if diff_db is not None else (a_arr - b_arr)
    valid_mask = np.isfinite(b_arr) & np.isfinite(a_arr) & np.isfinite(d_arr)
    n_valid = int(np.sum(valid_mask))
    if n_valid == 0:
        return {
            "comparison": None,
            "backscatter_histogram": [],
            "delta_histogram": [],
            "condition_breakdown": [],
            "transect": [],
        }

    bv = b_arr[valid_mask]
    av = a_arr[valid_mask]
    dv = d_arr[valid_mask]

    comparison = {
        "before_mean_db": round(float(np.mean(bv)), 3),
        "before_median_db": round(float(np.median(bv)), 3),
        "before_std_db": round(float(np.std(bv)), 3),
        "before_p10_db": round(float(np.percentile(bv, 10)), 3),
        "before_p90_db": round(float(np.percentile(bv, 90)), 3),
        "after_mean_db": round(float(np.mean(av)), 3),
        "after_median_db": round(float(np.median(av)), 3),
        "after_std_db": round(float(np.std(av)), 3),
        "after_p10_db": round(float(np.percentile(av, 10)), 3),
        "after_p90_db": round(float(np.percentile(av, 90)), 3),
        "delta_mean_db": round(float(np.mean(dv)), 3),
        "delta_median_db": round(float(np.median(dv)), 3),
        "threshold_db": round(float(threshold_db), 3),
    }

    # Backscatter distribution histogram across [-27.5, +2.5] dB in 2.5 dB bins
    bs_edges = np.linspace(-27.5, 2.5, 13)
    b_hist, _ = np.histogram(np.clip(bv, bs_edges[0], bs_edges[-1] - 1e-6), bins=bs_edges)
    a_hist, _ = np.histogram(np.clip(av, bs_edges[0], bs_edges[-1] - 1e-6), bins=bs_edges)
    backscatter_histogram: List[Dict[str, Any]] = []
    for i in range(len(bs_edges) - 1):
        lo, hi = float(bs_edges[i]), float(bs_edges[i + 1])
        label = f"{lo:.1f}" if i == 0 else f"{lo:.1f}..{hi:.1f}"
        backscatter_histogram.append(
            {
                "bin": label,
                "mid_db": round(0.5 * (lo + hi), 2),
                "before_pct": round(float(b_hist[i]) / n_valid * 100.0, 2),
                "after_pct": round(float(a_hist[i]) / n_valid * 100.0, 2),
            }
        )

    # Delta dB histogram across [-6, +6] dB in 1 dB bins
    d_edges = np.linspace(-6.0, 6.0, 13)
    d_hist, _ = np.histogram(np.clip(dv, d_edges[0], d_edges[-1] - 1e-6), bins=d_edges)
    delta_histogram: List[Dict[str, Any]] = []
    for i in range(len(d_edges) - 1):
        lo, hi = float(d_edges[i]), float(d_edges[i + 1])
        mid = 0.5 * (lo + hi)
        if i == 0:
            lbl = "< -5 dB"
        elif i == len(d_edges) - 2:
            lbl = "> +5 dB"
        else:
            lbl = f"{lo:+.0f}..{hi:+.0f}"
        cls = (
            "drop"
            if mid <= -abs(threshold_db) or hi <= -1.5
            else ("gain" if lo >= 1.5 else "stable")
        )
        delta_histogram.append(
            {
                "bin": lbl,
                "mid_db": round(mid, 2),
                "pct": round(float(d_hist[i]) / n_valid * 100.0, 2),
                "direction": cls,
            }
        )

    # 5-bucket physical backscatter change breakdown
    c_strong_drop = int(np.sum(dv < -3.0))
    c_mod_drop = int(np.sum((dv >= -3.0) & (dv < -1.5)))
    c_stable = int(np.sum((dv >= -1.5) & (dv <= 1.5)))
    c_mod_gain = int(np.sum((dv > 1.5) & (dv <= 3.0)))
    c_strong_gain = int(np.sum(dv > 3.0))
    condition_breakdown = [
        {
            "key": "strong_drop",
            "label": "Strong drop (< -3 dB)",
            "pixels": c_strong_drop,
            "pct": round(c_strong_drop / n_valid * 100.0, 2),
            "color": "#22d3ee",
        },
        {
            "key": "moderate_drop",
            "label": "Moderate drop (-3..-1.5 dB)",
            "pixels": c_mod_drop,
            "pct": round(c_mod_drop / n_valid * 100.0, 2),
            "color": "#38bdf8",
        },
        {
            "key": "stable",
            "label": "Stable (-1.5..+1.5 dB)",
            "pixels": c_stable,
            "pct": round(c_stable / n_valid * 100.0, 2),
            "color": "#64748b",
        },
        {
            "key": "moderate_gain",
            "label": "Moderate gain (+1.5..+3 dB)",
            "pixels": c_mod_gain,
            "pct": round(c_mod_gain / n_valid * 100.0, 2),
            "color": "#fbbf24",
        },
        {
            "key": "strong_gain",
            "label": "Strong gain (> +3 dB)",
            "pixels": c_strong_gain,
            "pct": round(c_strong_gain / n_valid * 100.0, 2),
            "color": "#f97316",
        },
    ]

    # Center-row horizontal backscatter transect (up to 24 spatial samples)
    transect: List[Dict[str, Any]] = []
    if b_arr.ndim == 2 and b_arr.shape[0] > 0 and b_arr.shape[1] > 0:
        row_valid_counts = np.sum(valid_mask, axis=1)
        mid_r = (
            int(np.argmax(row_valid_counts))
            if np.max(row_valid_counts) > 0
            else b_arr.shape[0] // 2
        )
        cols = b_arr.shape[1]
        dx_m = abs(float(spacing_m[0])) if spacing_m and len(spacing_m) >= 1 else 20.0
        n_samples = min(24, cols)
        sample_cols = np.unique(np.linspace(0, cols - 1, n_samples, dtype=int))
        for ci in sample_cols:
            if valid_mask[mid_r, ci]:
                bv_pt = float(b_arr[mid_r, ci])
                av_pt = float(a_arr[mid_r, ci])
                transect.append(
                    {
                        "step": int(ci),
                        "offset_km": round(float(ci) * dx_m / 1000.0, 2),
                        "before_db": round(bv_pt, 2),
                        "after_db": round(av_pt, 2),
                        "delta_db": round(av_pt - bv_pt, 2),
                    }
                )

    return {
        "comparison": comparison,
        "backscatter_histogram": backscatter_histogram,
        "delta_histogram": delta_histogram,
        "condition_breakdown": condition_breakdown,
        "transect": transect,
    }


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


def set_stage(job_id: str, stage: str, progress: int) -> None:
    db.update_job(job_id, stage=stage, progress=progress)


def _window_bounds_wgs84(
    x_coords: Any,
    y_coords: Any,
    crs_str: str,
    spacing_m: Optional[List[float]] = None,
) -> Optional[List[List[float]]]:
    """Compute [[south, west], [north, east]] WGS84 bounds for a coordinate window."""
    try:
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


def _run_insar_deformation_job(
    job_id: str,
    provider: Any,
    config: Dict[str, Any],
    params: Dict[str, Any],
    fail,
) -> None:
    """Execute a NISAR L2 GUNW interferometric LOS displacement job."""
    lat, lon = float(params["lat"]), float(params["lon"])
    aoi_bbox = params.get("bbox")
    req_window = max(64, min(int(params.get("window") or 256), MAX_WINDOW_PIXELS))
    dataset_id = params.get("dataset_id") or config.get("dataset_id", "nisar_l2_gunw")
    if dataset_id == "nisar_l2_gcov":
        dataset_id = "nisar_l2_gunw"

    set_stage(job_id, "searching GUNW interferograms", 25)
    search_bbox = (
        [
            min(float(aoi_bbox[0]), lon - 0.5),
            min(float(aoi_bbox[1]), lat - 0.5),
            max(float(aoi_bbox[2]), lon + 0.5),
            max(float(aoi_bbox[3]), lat + 0.5),
        ]
        if aoi_bbox and len(aoi_bbox) == 4
        else [lon - 1.0, lat - 1.0, lon + 1.0, lat + 1.0]
    )
    end_dt = datetime.now()
    start_dt = end_dt - timedelta(days=180)
    before_date = params.get("before_date") or start_dt.strftime("%Y-%m-%d")
    after_date = params.get("after_date") or end_dt.strftime("%Y-%m-%d")

    granules: List[Dict[str, Any]] = []
    used_sn = None
    for sn in resolve_short_names(dataset_id):
        try:
            found = cache.cached_search(
                provider, sn, (before_date, after_date), search_bbox, count=20
            )
            if found:
                granules = found
                used_sn = sn
                break
        except Exception as e:
            logger.warning("GUNW CMR search error for %s: %s", sn, e)

    if not granules:
        fail(
            f"No NISAR L2 GUNW interferometric granules found near ({lat}, {lon}) "
            f"in {before_date}..{after_date}. Ground displacement cannot be computed from GCOV backscatter alone."
        )
        return

    granule = granules[0]
    set_stage(job_id, "streaming GUNW phase & coherence", 60)
    try:
        gunw = provider.stream_gunw_window(
            granule.get("https_link"), lat=lat, lon=lon, window=req_window, bbox=aoi_bbox
        )
    except Exception as e:
        db.save_job_result(
            job_id,
            {
                "success": True,
                "status": "metadata_only",
                "method": "insar_unwrapped_phase_los",
                "hazard": "deformation",
                "hazard_label": config["label"],
                "location": {"lat": lat, "lon": lon},
                "short_name": used_sn,
                "after_granule": summarize_granule(granule),
                "processing_note": (
                    f"GUNW interferogram found, but HTTPS group streaming failed ({e}). "
                    "Use the product link for external ISCE3/HDF5 inspection."
                ),
                "caveats_and_limitations": [
                    f"CANNOT conclude: {c}" for c in config.get("cannot_say", [])
                ],
                "produced_at": datetime.now().isoformat() + "Z",
            },
        )
        return

    set_stage(job_id, "analyzing LOS displacement", 85)
    los_cm = np.asarray(gunw["los_displacement_cm"], dtype=np.float64)
    coh = gunw.get("coherence")
    valid = np.isfinite(los_cm)
    if coh is not None:
        coh_arr = np.asarray(coh, dtype=np.float64)
        valid = valid & np.isfinite(coh_arr) & (coh_arr >= 0.35)
        mean_coh = float(np.nanmean(coh_arr))
    else:
        coh_arr = np.ones_like(los_cm)
        mean_coh = 0.5

    los_masked = np.where(valid, los_cm, np.nan)
    thr_cm = float(config.get("threshold_cm", 2.5))
    valid_px = int(np.sum(valid))
    deformed_px = int(np.sum(np.abs(los_masked[valid]) > thr_cm)) if valid_px > 0 else 0
    pct_def = float(deformed_px / valid_px * 100.0) if valid_px > 0 else 0.0
    sp = gunw.get("spacing_m") or [80.0, 80.0]
    area_km2 = deformed_px * abs(float(sp[0])) * abs(float(sp[1])) / 1e6

    gj = export_geojson(
        difference_mask=los_masked,
        crs=gunw.get("crs", "EPSG:4326"),
        threshold=thr_cm,
        x_coords=gunw["x_coords"],
        y_coords=gunw["y_coords"],
        spacing_m=sp,
        mode="magnitude",
        same_orbit=True,
        valid_fraction=valid_px / max(los_cm.size, 1),
    )
    images = renders.save_job_visuals(
        job_id,
        coh_arr,
        los_cm,
        los_masked,
        gunw["x_coords"],
        gunw["y_coords"],
        gunw.get("crs", "EPSG:4326"),
    )
    bounds_wgs84 = _window_bounds_wgs84(
        gunw["x_coords"], gunw["y_coords"], gunw.get("crs", "EPSG:4326"), sp
    )
    conf_score, conf_level = compute_polygon_confidence(
        mean_diff_db=-abs(float(np.nanmean(np.abs(los_masked)))) if valid_px else 0.0,
        threshold_db=-thr_cm,
        pixel_count=max(deformed_px, 1),
        same_orbit=True,
        valid_fraction=valid_px / max(los_cm.size, 1),
    )
    sev_level, _ = compute_severity_area_confidence(area_km2, conf_score)

    db.save_job_result(
        job_id,
        {
            "success": True,
            "status": "analyzed",
            "method": "insar_unwrapped_phase_los (cm)",
            "hazard": "deformation",
            "hazard_label": config["label"],
            "interpretation": config["interpretation"],
            "data_source": "NASA-ISRO NISAR L2 GUNW via NASA Earthdata",
            "requested_dates": {"before": before_date, "after": after_date},
            "actual_granule_dates": {"before": None, "after": granule.get("acquisition_date")},
            "same_orbit_pair": True,
            "location": {"lat": lat, "lon": lon},
            "short_name": used_sn,
            "polarization_band": "HH",
            "threshold_db": thr_cm,
            "detection_mode": "insar_phase",
            "severity": sev_level,
            "severity_rule": SEVERITY_RULE,
            "windows": {
                "size": max(los_cm.shape),
                "requested_window": req_window,
                "before_layer": "coherenceMagnitude",
                "after_layer": gunw["variable"],
                "before_origin": gunw["window_origin"],
                "before_shape": list(gunw["shape"]),
                "after_origin": gunw["window_origin"],
                "after_shape": list(gunw["shape"]),
                "crs": gunw.get("crs", "EPSG:4326"),
                "epsg": gunw.get("epsg"),
                "bounds": bounds_wgs84,
                "stride": gunw.get("stride", 1),
                "downsampled": int(gunw.get("stride", 1)) > 1,
                "note": "LOS interferometric displacement (cm) filtered at coherence >= 0.35.",
            },
            "after_granule": summarize_granule(granule),
            "images": images,
            "analysis": {
                "mean_backscatter_difference_db": (
                    round(float(np.nanmean(los_masked)), 3) if valid_px else None
                ),
                "std_difference_db": round(float(np.nanstd(los_masked)), 3) if valid_px else None,
                "percentage_decrease": round(pct_def, 2),
                "percentage_disturbed": round(pct_def, 2),
                "affected_area_km2": round(area_km2, 4),
                "mean_coherence": round(mean_coh, 3),
                "area_basis": "coherent pixels |LOS| > threshold x product spacing",
                "valid_pixels": valid_px,
                "total_pixels": int(los_cm.size),
            },
            "results": {"deformation_outlines": gj},
            "caveats_and_limitations": [
                "InSAR LOS phase requires phase unwrapping verification and orbital ramp removal",
            ]
            + [f"CANNOT conclude: {c}" for c in config.get("cannot_say", [])],
            "confidence": {
                "score": conf_score,
                "level": conf_level,
                "formula": CONFIDENCE_FORMULA,
                "based_on": "GUNW unwrapped phase + coherenceMagnitude >= 0.35",
                "quality": "insar-indicator",
                "requires_validation": "Cross-check GNSS stations and coherence maps",
            },
            "produced_at": datetime.now().isoformat() + "Z",
        },
    )


def run_analysis_job(job_id: str, params: Dict[str, Any]) -> None:
    """Background worker: live granule discovery + windowed change detection."""

    def fail(message: str, extra: Optional[Dict[str, Any]] = None) -> None:
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
    aoi_bbox = params.get("bbox")
    dataset_id = params.get("dataset_id") or config.get("dataset_id") or "nisar_l2_gcov"
    band = (params.get("band") or config.get("default_band") or "HH").upper()
    speckle_filter = (params.get("speckle_filter") or "none").lower()
    threshold_mode = (params.get("threshold_mode") or "fixed").lower()
    water_mask = bool(params.get("water_mask", False))
    slope_mask = bool(params.get("slope_mask", False))
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

    with _get_job_semaphore():
        _execute_analysis_job(
            job_id=job_id,
            hazard=hazard,
            config=config,
            params=params,
            before_date=before_date,
            after_date=after_date,
            before_dt=before_dt,
            after_dt=after_dt,
            auto_dates=auto_dates,
            lat=lat,
            lon=lon,
            aoi_bbox=aoi_bbox,
            dataset_id=dataset_id,
            band=band,
            speckle_filter=speckle_filter,
            threshold_mode=threshold_mode,
            water_mask=water_mask,
            slope_mask=slope_mask,
            req_window=req_window,
            fail=fail,
        )


def _execute_analysis_job(
    *,
    job_id: str,
    hazard: str,
    config: Dict[str, Any],
    params: Dict[str, Any],
    before_date: Optional[str],
    after_date: Optional[str],
    before_dt: Optional[datetime],
    after_dt: Optional[datetime],
    auto_dates: bool,
    lat: float,
    lon: float,
    aoi_bbox: Any,
    dataset_id: str,
    band: str,
    speckle_filter: str,
    threshold_mode: str,
    water_mask: bool,
    slope_mask: bool,
    req_window: int,
    fail: Any,
) -> None:
    try:
        set_stage(job_id, "authenticating", 5)
        provider = cache.get_provider()
        if not provider.is_authenticated() and not provider.authenticate():
            fail(
                "NASA Earthdata authentication required: set "
                "NASA_EARTHDATA_USERNAME and NASA_EARTHDATA_PASSWORD in backend/.env."
            )
            return

        if config.get("mode") == "insar_phase":
            _run_insar_deformation_job(job_id, provider, config, params, fail)
            return

        t_job_start = time.perf_counter()
        set_stage(job_id, "searching CMR catalogs", 20)
        t_cmr_start = time.perf_counter()
        half = timedelta(days=SEARCH_HALF_WINDOW_DAYS)
        if aoi_bbox and len(aoi_bbox) == 4:
            bbox = [
                min(float(aoi_bbox[0]), lon - 0.5),
                min(float(aoi_bbox[1]), lat - 0.5),
                max(float(aoi_bbox[2]), lon + 0.5),
                max(float(aoi_bbox[3]), lat + 0.5),
            ]
            fallback_bbox = bbox
        else:
            # Tight point bbox first matches rotated GPolygons actually covering (lat, lon)
            bbox = [lon - 0.04, lat - 0.04, lon + 0.04, lat + 0.04]
            fallback_bbox = [lon - 1.0, lat - 1.0, lon + 1.0, lat + 1.0]
        before_g = after_g = None
        pair_info: Dict[str, Any] = {}
        used_short_name = None
        notes: List[str] = []

        if auto_dates:
            end = datetime.now().strftime("%Y-%m-%d")
            start = (datetime.now() - timedelta(days=180)).strftime("%Y-%m-%d")
            for sn in resolve_short_names(dataset_id):
                try:
                    all_g = cache.cached_search(provider, sn, (start, end), bbox, count=60)
                    if not all_g and fallback_bbox != bbox:
                        all_g = cache.cached_search(
                            provider, sn, (start, end), fallback_bbox, count=60
                        )
                except Exception as e:
                    notes.append(f"{sn}: search error ({e})")
                    continue
                dated = [(g, parse_granule_date(g)) for g in all_g]
                dated = [(g, d) for g, d in dated if d is not None]
                dated.sort(key=lambda t: t[1], reverse=True)
                notes.append(f"{sn}: {len(dated)} granules in last 180 days")
                if not dated:
                    continue
                covering = [(g, d) for g, d in dated if _granule_contains_point(g, lat, lon)]
                pool_dated = covering if len(covering) >= 2 else dated
                ca, da = pool_dated[0]
                best = None
                for g, d in pool_dated[1:]:
                    if (da - d).days < 12 or cache.granule_key(g) == cache.granule_key(ca):
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
                after_g = ca
                before_date, after_date = b_dt.strftime("%Y-%m-%d"), da.strftime("%Y-%m-%d")
                pair_info = {"same_orbit": best[2], "auto": True}
                used_short_name = sn
                break
        else:
            assert before_dt is not None and after_dt is not None
            b_win_t = (
                (before_dt - half).strftime("%Y-%m-%d"),
                (before_dt + half).strftime("%Y-%m-%d"),
            )
            a_win_t = (
                (after_dt - half).strftime("%Y-%m-%d"),
                (after_dt + half).strftime("%Y-%m-%d"),
            )
            for sn in resolve_short_names(dataset_id):
                try:
                    b_list = cache.cached_search(provider, sn, b_win_t, bbox)
                    if not b_list and fallback_bbox != bbox:
                        b_list = cache.cached_search(provider, sn, b_win_t, fallback_bbox)
                    a_list = cache.cached_search(provider, sn, a_win_t, bbox)
                    if not a_list and fallback_bbox != bbox:
                        a_list = cache.cached_search(provider, sn, a_win_t, fallback_bbox)
                except Exception as e:
                    notes.append(f"{sn}: search error ({e})")
                    continue
                notes.append(
                    f"{sn}: {len(b_list)} before-window, {len(a_list)} after-window granules"
                )
                picked, info = pick_pair(b_list, a_list, before_dt, after_dt, lat=lat, lon=lon)
                if picked is not None:
                    before_g, after_g = picked
                    pair_info = info or {}
                    used_short_name = sn
                    break

        cmr_search_s = round(time.perf_counter() - t_cmr_start, 2)

        if before_g is None or after_g is None:
            avail_hint = ""
            try:
                end_h = datetime.now().strftime("%Y-%m-%d")
                start_h = (datetime.now() - timedelta(days=180)).strftime("%Y-%m-%d")
                sn0 = resolve_short_names(dataset_id)[0]
                recent = cache.cached_search(provider, sn0, (start_h, end_h), bbox, count=40)
                recent_dates = sorted(
                    {d.strftime("%Y-%m-%d") for d in (parse_granule_date(g) for g in recent) if d},
                    reverse=True,
                )
                if recent_dates:
                    avail_hint = (
                        f" Available pass dates near ({lat:.2f}, {lon:.2f}): "
                        + ", ".join(recent_dates[:8])
                        + "."
                    )
            except Exception:
                pass
            fail(
                "No pair of distinct NISAR granules found near "
                f"({lat}, {lon}) for {before_date} / {after_date}. "
                + " ".join(notes)
                + avail_hint
                + " NISAR science operations began in late 2025. Try dates >= 12 days "
                "apart within available passes."
            )
            return

        t_stream_start = time.perf_counter()
        set_stage(job_id, "streaming granule windows (1/2)", 45)
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                fb = pool.submit(
                    cache.cached_window, provider, before_g, band, req_window, lat, lon, aoi_bbox
                )
                set_stage(job_id, "streaming granule windows (2/2)", 60)
                fa = pool.submit(
                    cache.cached_window, provider, after_g, band, req_window, lat, lon, aoi_bbox
                )
                b_win, a_win = fb.result(), fa.result()
        except ValueError as e:
            fail(str(e))
            return
        except RuntimeError as e:
            db.save_job_result(
                job_id,
                {
                    "success": True,
                    "status": "metadata_only",
                    "method": "backscatter_difference_flood_indicator",
                    "data_source": "NASA-ISRO NISAR via NASA Earthdata (live CMR metadata)",
                    "requested_dates": {"before": before_date, "after": after_date},
                    "location": {"lat": lat, "lon": lon},
                    "short_name": used_short_name,
                    "before_granule": summarize_granule(before_g),
                    "after_granule": summarize_granule(after_g),
                    "processing_note": (
                        f"Granules found, but windowed pixel streaming failed ({e}). "
                        "Download the products via the https_url links (Earthdata Login) for full analysis."
                    ),
                    "caveats_and_limitations": [
                        "Pixel-level comparison was not performed for this pair.",
                        "Use the provided HTTPS/S3 URLs to download the real products.",
                    ],
                    "produced_at": datetime.now().isoformat() + "Z",
                },
            )
            return

        stream_s = round(time.perf_counter() - t_stream_start, 2)
        t_compute_start = time.perf_counter()
        set_stage(job_id, f"computing backscatter difference ({speckle_filter})", 82)

        eps = 1e-9
        b_raw_vals = np.asarray(b_win["values"], dtype=np.float64)
        a_raw_vals = np.asarray(a_win["values"], dtype=np.float64)
        b_raw_db = np.where(
            np.isfinite(b_raw_vals) & (b_raw_vals > 0),
            10.0 * np.log10(np.maximum(b_raw_vals, eps)),
            np.nan,
        )
        a_raw_db = np.where(
            np.isfinite(a_raw_vals) & (a_raw_vals > 0),
            10.0 * np.log10(np.maximum(a_raw_vals, eps)),
            np.nan,
        )

        bx = np.asarray(
            (
                b_win.get("x_coords")
                if b_win.get("x_coords") is not None
                else np.arange(b_raw_db.shape[1])
            ),
            dtype=np.float64,
        )
        by = np.asarray(
            (
                b_win.get("y_coords")
                if b_win.get("y_coords") is not None
                else np.arange(b_raw_db.shape[0])
            ),
            dtype=np.float64,
        )
        ax = np.asarray(
            (
                a_win.get("x_coords")
                if a_win.get("x_coords") is not None
                else np.arange(a_raw_db.shape[1])
            ),
            dtype=np.float64,
        )
        ay = np.asarray(
            (
                a_win.get("y_coords")
                if a_win.get("y_coords") is not None
                else np.arange(a_raw_db.shape[0])
            ),
            dtype=np.float64,
        )

        b_db = apply_speckle_filter(b_raw_db, method=speckle_filter, size=5, is_db=True)
        a_db = apply_speckle_filter(a_raw_db, method=speckle_filter, size=5, is_db=True)

        ob = (before_g.get("orbit_direction") or "unknown").lower()
        oa = (after_g.get("orbit_direction") or "unknown").lower()
        before_ds = xr.Dataset({"sigma0_db": (["y", "x"], b_db)}, coords={"y": by, "x": bx})
        before_ds.attrs = {
            "polarizations": band,
            "orbit_direction": ob,
            "acquisition_date": before_g.get("acquisition_date") or before_date,
            "source_layer": b_win["variable"],
            "source_granule": before_g.get("id"),
            "crs": b_win.get("crs", "EPSG:4326"),
        }
        after_ds = xr.Dataset({"sigma0_db": (["y", "x"], a_db)}, coords={"y": ay, "x": ax})
        after_ds.attrs = {
            "polarizations": band,
            "orbit_direction": oa,
            "acquisition_date": after_g.get("acquisition_date") or after_date,
            "source_layer": a_win["variable"],
            "source_granule": after_g.get("id"),
            "crs": a_win.get("crs", "EPSG:4326"),
        }

        if b_win.get("epsg") == a_win.get("epsg") and (
            bx.shape != ax.shape
            or by.shape != ay.shape
            or not np.allclose(bx, ax)
            or not np.allclose(by, ay)
        ):
            sp_align = b_win.get("spacing_m") or a_win.get("spacing_m") or [20.0, 20.0]
            tol = max(abs(float(sp_align[0])), abs(float(sp_align[1]))) * 1.5
            after_ds = after_ds.reindex_like(before_ds, method="nearest", tolerance=tol)
            if a_raw_db.shape == ay.shape + ax.shape:
                raw_after_ds = xr.Dataset(
                    {"sigma0_db": (["y", "x"], a_raw_db)}, coords={"y": ay, "x": ax}
                )
                a_raw_db = np.asarray(
                    raw_after_ds.reindex_like(before_ds, method="nearest", tolerance=tol)[
                        "sigma0_db"
                    ].values,
                    dtype=np.float64,
                )

        n = int(b_db.shape[0])
        compatibility = validate_observation_compatibility(before_ds, after_ds)
        if not compatibility.get("compatible", False):
            fail(
                "Retrieved windows are not compatible for change detection.",
                {
                    "warnings": compatibility.get("warnings", []),
                    "checks": compatibility.get("checks", {}),
                    "before_granule": summarize_granule(before_g),
                    "after_granule": summarize_granule(after_g),
                },
            )
            return

        difference_result = calculate_backscatter_difference(before_ds, after_ds, band=band)
        if "error" in difference_result:
            fail(f"Backscatter computation failed: {difference_result['error']}")
            return
        difference_mask = difference_result.pop("difference", None)
        difference_result.pop("before_backscatter", None)
        difference_result.pop("after_backscatter", None)

        raw_stats = None
        if speckle_filter != "none" and b_raw_db.shape == a_raw_db.shape:
            raw_diff = a_raw_db - b_raw_db
            raw_fin = raw_diff[np.isfinite(raw_diff)]
            if raw_fin.size > 0:
                raw_stats = {
                    "mean_difference_db": round(float(np.mean(raw_fin)), 3),
                    "std_difference_db": round(float(np.std(raw_fin)), 3),
                    "percentage_decrease": round(
                        float(np.sum(raw_fin < -2.0) / raw_fin.size * 100.0), 2
                    ),
                }

        mode = config.get("mode", "decrease")
        mag_db = float(config.get("magnitude_db", abs(FLOOD_DB_THRESHOLD)))
        thr_db = float(config.get("threshold_db", FLOOD_DB_THRESHOLD))
        if difference_mask is not None and threshold_mode == "otsu":
            if mode == "magnitude":
                mag_db = abs(compute_otsu_threshold(difference_mask, direction="magnitude"))
            else:
                thr_db = compute_otsu_threshold(difference_mask, direction="negative")
        elif difference_mask is not None and threshold_mode == "mean_std":
            fin = difference_mask[np.isfinite(difference_mask)]
            if fin.size > 16:
                if mode == "magnitude":
                    mag_db = round(float(np.mean(np.abs(fin)) + 1.5 * np.std(np.abs(fin))), 3)
                else:
                    thr_db = round(float(np.mean(fin) - 1.5 * np.std(fin)), 3)

        valid = int(difference_result.get("valid_pixels") or 0)
        total_px = int(difference_result.get("total_pixels") or max(b_db.size, 1))
        if difference_mask is not None and valid > 0:
            disturbed_pct = float(np.sum(np.abs(difference_mask) > mag_db) / valid * 100)
        else:
            disturbed_pct = 0.0

        outline_thr = -mag_db if mode == "magnitude" else thr_db
        outline_label = "disturbance_outlines" if mode == "magnitude" else "flood_outlines"

        b_dt_p = parse_granule_date(before_g)
        a_dt_p = parse_granule_date(after_g)
        temporal_days = (
            abs((a_dt_p - b_dt_p).days) if b_dt_p is not None and a_dt_p is not None else None
        )
        valid_fraction = float(valid) / max(total_px, 1)
        same_orbit = pair_info.get("same_orbit")

        sp = b_win.get("spacing_m") or a_win.get("spacing_m")
        crs_str = b_win.get("crs", "EPSG:4326")
        geojson_result = export_geojson(
            difference_mask=difference_mask,
            crs=crs_str,
            threshold=outline_thr,
            x_coords=bx,
            y_coords=by,
            spacing_m=sp,
            mode=mode,
            same_orbit=same_orbit,
            temporal_days=temporal_days,
            valid_fraction=valid_fraction,
        )
        bounds_wgs84 = _window_bounds_wgs84(bx, by, crs_str, sp)

        affected_area_km2 = None
        total_outline_px = 0
        try:
            total_outline_px = sum(
                int(f.get("properties", {}).get("pixel_count", 0))
                for f in geojson_result.get("features", [])
            )
            if sp:
                affected_area_km2 = total_outline_px * abs(float(sp[0])) * abs(float(sp[1])) / 1e6
        except Exception:
            affected_area_km2 = None

        a_aligned = np.asarray(after_ds["sigma0_db"].values, dtype=np.float64)

        set_stage(job_id, "rendering visual overlays", 93)
        images = renders.save_job_visuals(
            job_id=job_id,
            before_db=b_db,
            after_db=a_aligned,
            difference_db=difference_mask,
            x_coords=bx,
            y_coords=by,
            crs=crs_str,
        )
        aux_raw = masks.evaluate_auxiliary_masks(
            bounds_wgs84,
            b_db.shape,
            apply_water_mask=water_mask,
            apply_slope_mask=slope_mask,
        )
        aux_notes = (
            [str(aux_raw["note"])] if (water_mask or slope_mask) and aux_raw.get("note") else []
        )
        aux_masks = {
            "water_mask_requested": water_mask,
            "slope_mask_requested": slope_mask,
            "masks_applied": False,
            "masked_pixels": int(aux_raw.get("masked_pixels", 0)),
            "status": "metadata_only" if (water_mask or slope_mask) else "not_requested",
            "notes": aux_notes,
        }

        used_thr_val = thr_db if mode == "decrease" else mag_db
        mean_diff = difference_result.get("mean_difference") or 0.0
        conf_score, conf_level = compute_polygon_confidence(
            mean_diff_db=-abs(float(mean_diff)) if mode == "magnitude" else float(mean_diff),
            threshold_db=-abs(float(used_thr_val)),
            pixel_count=max(total_outline_px, valid // 100, 1),
            same_orbit=same_orbit,
            temporal_days=temporal_days,
            valid_fraction=valid_fraction,
        )
        severity_level, _ = compute_severity_area_confidence(affected_area_km2, conf_score)

        charts = compute_comparison_charts(
            before_db=b_db,
            after_db=a_aligned,
            diff_db=difference_mask,
            spacing_m=sp,
            threshold_db=float(used_thr_val),
        )
        compute_s = round(time.perf_counter() - t_compute_start, 2)
        total_s = round(time.perf_counter() - t_job_start, 2)

        result_payload = {
            "success": True,
            "status": "analyzed",
            "method": f"backscatter_difference_indicator (dB, {speckle_filter} speckle, {threshold_mode} threshold)",
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
            "same_orbit_pair": same_orbit,
            "location": {"lat": lat, "lon": lon},
            "bbox": aoi_bbox,
            "short_name": used_short_name,
            "polarization_band": band,
            "threshold_db": used_thr_val,
            "threshold_mode": threshold_mode,
            "speckle_filter": speckle_filter,
            "detection_mode": mode,
            "severity": severity_level,
            "severity_rule": SEVERITY_RULE,
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
                "stride": b_win.get("stride", 1),
                "downsampled": bool(b_win.get("downsampled", False)),
                "note": "Location/AOI window comparison in dB, not full-swath analysis.",
            },
            "before_granule": summarize_granule(before_g),
            "after_granule": summarize_granule(after_g),
            "compatibility_check": {
                "compatible": compatibility.get("compatible", False),
                "warnings": compatibility.get("warnings", []),
            },
            "images": images,
            "raw_stats": raw_stats,
            "auxiliary_masks": aux_masks,
            "comparison": charts["comparison"],
            "backscatter_histogram": charts["backscatter_histogram"],
            "delta_histogram": charts["delta_histogram"],
            "condition_breakdown": charts["condition_breakdown"],
            "transect": charts["transect"],
            "timing": {
                "cmr_search_s": cmr_search_s,
                "stream_s": stream_s,
                "compute_s": compute_s,
                "total_s": total_s,
            },
            "analysis": {
                "mean_backscatter_difference_db": difference_result.get("mean_difference"),
                "std_difference_db": difference_result.get("std_difference"),
                "percentage_decrease": difference_result.get("percentage_decrease"),
                "percentage_disturbed": disturbed_pct,
                "affected_area_km2": affected_area_km2,
                "area_basis": (
                    "outline pixels x product ground spacing"
                    if affected_area_km2 is not None
                    else "unavailable (no spacing metadata in product)"
                ),
                "valid_pixels": valid,
                "total_pixels": total_px,
            },
            "results": {outline_label: geojson_result},
            "caveats_and_limitations": [
                f"This is a change INDICATOR only, not a validated {hazard} map",
                "Comparison covers a bounded window of each granule in dB units",
                "Backscatter changes can be caused by: vegetation condition, "
                "soil moisture, terrain — not just the target hazard",
                "NISAR L-band radar may miss changes under dense canopy",
                "Single-pair comparison cannot attribute change to a specific event",
                "Validate with field observations and auxiliary data",
            ]
            + ([str(n) for n in aux_masks.get("notes", [])])
            + [f"CANNOT conclude: {c}" for c in config.get("cannot_say", [])],
            "confidence": {
                "score": conf_score,
                "level": conf_level,
                "formula": CONFIDENCE_FORMULA,
                "based_on": f"dB backscatter difference ({mode}, {speckle_filter} filter, {threshold_mode} threshold)",
                "quality": "indicator-level",
                "requires_validation": "Field validation and auxiliary data recommended",
            },
            "produced_at": datetime.now().isoformat() + "Z",
        }
        db.save_job_result(job_id, result_payload)
        logger.info(
            "Job %s complete [%s]: mean diff=%.3f dB, %.1f%% decrease, %.1f%% disturbed (sev=%s)",
            job_id,
            hazard,
            difference_result.get("mean_difference") or 0.0,
            difference_result.get("percentage_decrease"),
            disturbed_pct,
            severity_level,
        )
    except Exception as e:
        logger.error("Job %s crashed: %s", job_id, e, exc_info=True)
        fail(f"Unexpected error: {e}")
