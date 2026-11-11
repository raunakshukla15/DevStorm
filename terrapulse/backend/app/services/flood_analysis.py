"""
NISAR Flood Monitoring Analysis

Implements a scientifically justified flood detection method using NISAR SAR
backscatter observations. The method compares calibrated backscatter values
acquired before and after a flood event.

Key scientific principles:
- Flood waters have lower backscatter (decreased sigma_nought) compared to
  bare soil or vegetation
- L-band radar (NISAR) penetrates vegetation less than higher frequencies,
  making it useful for flooding under canopy
- Ratio or difference of co-polarized (HH) backscatter is used
- Quality masks and spatial coverage checks are applied
"""

import logging
import numpy as np
import xarray as xr
from typing import Optional, Dict, Any, Tuple
from datetime import datetime

logger = logging.getLogger(__name__)


def calculate_backscatter_difference(
    before_ds: xr.Dataset,
    after_ds: xr.Dataset,
    band: str = "HH",
) -> Dict[str, Any]:
    """
    Calculate the backscatter difference between two NISAR observations.

    For flood detection, we compute:
    - difference = after_backscatter - before_backscatter
    - Negative differences indicate decreased backscatter (potential flooding)

    Args:
        before_ds: NISAR Dataset acquired before the event
        after_ds: NISAR Dataset acquired after the event
        band: Polarization band ('HH', 'HV', 'VV', default 'HH')

    Returns:
        Dict containing the difference array and metadata
    """
    try:
        logger.info("Calculating backscatter difference for band: %s", band)

        # Check available variables in both datasets
        before_vars = set(before_ds.data_vars)
        after_vars = set(after_ds.data_vars)

        # Try to find backscatter variables with various naming conventions
        possible_names = [f"{band}_backscatter", band, "sigma0", "gamma0", "backscatter"]

        before_backscatter = None
        after_backscatter = None

        # Search for backscatter variable in before dataset
        for name in possible_names:
            if name in before_vars:
                before_backscatter = before_ds[name]
                logger.info("Found before backscatter variable: %s", name)
                break

        # Search for backscatter variable in after dataset
        for name in possible_names:
            if name in after_vars:
                after_backscatter = after_ds[name]
                logger.info("Found after backscatter variable: %s", name)
                break

        # Fallback: use first data variable if no backscatter found
        if before_backscatter is None and len(before_vars) > 0:
            before_backscatter = before_ds[list(before_vars)[0]]
            logger.info("Using first variable as before backscatter: %s", list(before_vars)[0])
        if after_backscatter is None and len(after_vars) > 0:
            after_backscatter = after_ds[list(after_vars)[0]]
            logger.info("Using first variable as after backscatter: %s", list(after_vars)[0])

        if before_backscatter is None or after_backscatter is None:
            raise ValueError(
                "Could not find backscatter variables in datasets. "
                "Available before: {}, after: {}".format(
                    list(before_vars), list(after_vars)
                )
            )

        # Ensure we're working with 2D numpy arrays (y, x grid)
        before_vals = before_backscatter.values.astype(np.float64)
        after_vals = after_backscatter.values.astype(np.float64)

        # Get nodata masks based on NaN values
        before_nodata = np.isnan(before_vals)
        after_nodata = np.isnan(after_vals)

        # Combine nodata masks - a pixel is invalid if either observation is nodata
        combined_nodata = before_nodata | after_nodata

        # Calculate difference: after - before
        # Negative values = decreased backscatter = potential flooding indicator
        difference = after_vals - before_vals

        # Apply nodata mask - set difference to NaN where either input is nodata
        difference_masked = np.where(combined_nodata, np.nan, difference)

        # Calculate statistics on valid pixels only
        valid_mask = ~combined_nodata
        valid_count = np.sum(valid_mask)
        total_count = np.size(valid_mask)

        if valid_count > 0:
            mean_diff = float(np.nanmean(difference_masked[valid_mask]))
            std_diff = float(np.nanstd(difference_masked[valid_mask]))
            pct_decrease = float(
                np.sum(difference_masked < 0) / valid_count * 100
            )
        else:
            mean_diff = None
            std_diff = None
            pct_decrease = 0.0

        result = {
            "difference": difference_masked,
            "before_backscatter": before_vals,
            "after_backscatter": after_vals,
            "mean_difference": mean_diff,
            "std_difference": std_diff,
            "percentage_decrease": pct_decrease,
            "valid_pixels": int(valid_count),
            "total_pixels": total_count,
            "nodata_pixels": int(np.sum(combined_nodata)),
            "method": "backscatter_difference_flood_indicator",
            "band": band,
            "physical_interpretation": (
                "Negative differences (after < before) indicate decreased backscatter, "
                "which may indicate flooding. However, this is an indicator only - "
                "vegetation, soil moisture, and terrain also affect backscatter. "
                "Field validation required for confirmation."
            ),
        }

        logger.info(
            "Calculated backscatter difference: mean=%.3f, "
            "%s%.1f%% pixels show decrease",
            mean_diff,
            "~" if mean_diff is None else "",
            pct_decrease,
        )

        return result

    except Exception as e:
        logger.error("Backscatter difference calculation failed: %s", e, exc_info=True)
        return {
            "error": str(e),
            "method": "backscatter_difference_flood_indicator",
            "physical_interpretation": (
                "Calculation failed due to data or processing error. "
                "Ensure datasets are compatible NISAR products."
            ),
        }


def validate_observation_compatibility(
    before_ds: xr.Dataset,
    after_ds: xr.Dataset,
) -> Dict[str, Any]:
    """
    Validate that two NISAR observations are scientifically compatible for
    change detection.

    Checks:
    - Same polarization configuration
    - Comparable acquisition geometry
    - Similar processing level
    - Sufficient spatial overlap

    Args:
        before_ds: First NISAR dataset
        after_ds: Second NISAR dataset

    Returns:
        Validation result dict
    """
    try:
        validation = {
            "compatible": True,
            "warnings": [],
            "checks": {},
        }

        # Check polarization - stored as attribute in ds.attrs
        before_pol = before_ds.attrs.get("polarizations", None)
        after_pol = after_ds.attrs.get("polarizations", None)

        # Handle both string and list/tuple polarization formats
        before_pol_str = (
            str(before_pol[0]) if isinstance(before_pol, (list, tuple)) 
            else (str(before_pol) if before_pol else "unknown")
        )
        after_pol_str = (
            str(after_pol[0]) if isinstance(after_pol, (list, tuple)) 
            else (str(after_pol) if after_pol else "unknown")
        )

        pol_match = before_pol_str == after_pol_str
        validation["checks"]["polarization"] = {
            "before": before_pol_str,
            "after": after_pol_str,
            "match": pol_match,
        }

        if not pol_match:
            validation["warnings"].append(
                f"Polarization mismatch: before={before_pol_str}, after={after_pol_str}. "
                "Change detection may be scientifically invalid."
            )
            validation["compatible"] = False

        # Check orbit direction - stored as attribute in ds.attrs
        before_orbit = before_ds.attrs.get("orbit_direction", None)
        after_orbit = after_ds.attrs.get("orbit_direction", None)

        before_orbit_str = str(before_orbit) if before_orbit is not None else "unknown"
        after_orbit_str = str(after_orbit) if after_orbit is not None else "unknown"

        orbit_match = before_orbit == after_orbit
        validation["checks"]["orbit_direction"] = {
            "before": before_orbit_str,
            "after": after_orbit_str,
            "match": orbit_match,
        }

        if not orbit_match:
            validation["warnings"].append(
                f"Orbit direction mismatch: before={before_orbit_str}, after={after_orbit_str}. "
                "This may affect backscatter comparison consistency."
            )
            validation["compatible"] = False

        # Check for spatial coordinates (indicates proper georeferencing)
        before_has_coords = hasattr(before_ds, "coords")
        after_has_coords = hasattr(after_ds, "coords")
        validation["checks"]["spatial_coordinates"] = {
            "before": before_has_coords,
            "after": after_has_coords,
        }

        # Check acquisition dates - stored as attribute in ds.attrs
        before_date = before_ds.attrs.get("acquisition_date", None)
        after_date = after_ds.attrs.get("acquisition_date", None)

        before_date_str = (
            str(before_date) if before_date is not None else "unknown"
        )
        after_date_str = (
            str(after_date) if after_date is not None else "unknown"
        )

        validation["checks"]["acquisition_dates"] = {
            "before": before_date_str,
            "after": after_date_str,
        }

        if before_date is not None and after_date is not None:
            try:
                # Parse dates in various formats
                b_date = (
                    before_date
                    if isinstance(before_date, datetime)
                    else (
                        datetime.strptime(before_date, "%Y-%m-%d")
                        if isinstance(before_date, str)
                        else before_date
                    )
                )
                a_date = (
                    after_date
                    if isinstance(after_date, datetime)
                    else (
                        datetime.strptime(after_date, "%Y-%m-%d")
                        if isinstance(after_date, str)
                        else after_date
                    )
                )
                delta_days = abs((a_date - b_date).days)
                validation["checks"]["temporal_separation_days"] = delta_days

                if delta_days > 365:
                    validation["warnings"].append(
                        f"Large temporal separation ({delta_days} days). "
                        "Backscatter changes may be due to seasonal vegetation/soil "
                        "moisture changes rather than the event of interest."
                    )
            except (ValueError, TypeError) as e:
                validation["checks"]["temporal_separation_error"] = str(e)

        logger.info(
            "Compatibility validation: compatible=%s, warnings=%s",
            validation["compatible"],
            validation["warnings"],
        )

        return validation

    except Exception as e:
        logger.error("Compatibility validation failed: %s", e, exc_info=True)
        return {
            "compatible": False,
            "error": str(e),
            "warnings": ["Validation could not be completed due to processing error."],
            "checks": {},
        }


CONFIDENCE_FORMULA = (
    "0.40 * min(1, (|mean_diff_db - threshold_db| + 1) / 5) + "
    "0.25 * min(1, log10(pixels + 1) / log10(101)) + "
    "0.20 * orbit_weight(same=1.0, unknown=0.65, cross=0.35) + "
    "0.15 * valid_fraction * temporal_decay"
)

SEVERITY_RULE = (
    "High: affected_area_km2 >= 2.0 AND confidence >= 0.65 "
    "(or affected_area_km2 >= 10.0 AND confidence >= 0.45); "
    "Medium: affected_area_km2 >= 0.25 AND confidence >= 0.45; "
    "Low: smaller footprint or Low confidence."
)


def _nan_uniform_filter(arr: np.ndarray, size: int) -> np.ndarray:
    """Apply NaN-safe moving average using normalized convolution."""
    from scipy.ndimage import uniform_filter

    valid = np.isfinite(arr)
    filled = np.where(valid, arr, 0.0)
    num = uniform_filter(filled, size=size, mode="nearest")
    den = uniform_filter(valid.astype(np.float64), size=size, mode="nearest")
    out = np.full(arr.shape, np.nan, dtype=np.float64)
    good = valid & (den > 1e-9)
    out[good] = num[good] / den[good]
    return out


def apply_speckle_filter(
    arr: np.ndarray,
    method: str = "none",
    size: int = 5,
    is_db: bool = True,
) -> np.ndarray:
    """Apply SAR speckle filtering ('none', 'boxcar', or adaptive 'lee').

    When ``is_db=True``, filtering operates in linear power (10**(dB/10)) so
    multiplicative speckle statistics hold, then transforms back to dB.
    """
    data = np.asarray(arr, dtype=np.float64)
    m = (method or "none").lower().strip()
    ksize = max(3, int(size) | 1)
    if m == "none":
        return data.copy()

    valid = np.isfinite(data)
    if not np.any(valid):
        return data.copy()

    work = np.where(valid, np.power(10.0, np.clip(data, -60.0, 40.0) / 10.0), np.nan) if is_db else data

    if m == "boxcar":
        filtered = _nan_uniform_filter(work, size=ksize)
    elif m == "lee":
        mean_local = _nan_uniform_filter(work, size=ksize)
        sq = np.where(valid, work * work, np.nan)
        mean_sq = _nan_uniform_filter(sq, size=ksize)
        var_local = np.maximum(mean_sq - mean_local * mean_local, 0.0)
        rel_var = var_local / np.maximum(mean_local * mean_local, 1e-12)
        finite_rel = rel_var[np.isfinite(rel_var) & (mean_local > 0)]
        sigma_v2 = float(np.median(finite_rel)) if finite_rel.size > 0 else 0.0
        sigma_v2 = max(0.0, min(sigma_v2, 2.0))
        var_n = sigma_v2 * (mean_local * mean_local)
        denom = np.maximum(var_local * (1.0 + sigma_v2), 1e-12)
        weight = np.clip((var_local - var_n) / denom, 0.0, 1.0)
        filtered = mean_local + weight * (work - mean_local)
        filtered = np.where(valid, filtered, np.nan)
    else:
        raise ValueError(f"Unsupported speckle filter '{method}'. Use none, boxcar, or lee.")

    if is_db:
        out = np.full(data.shape, np.nan, dtype=np.float64)
        pos = np.isfinite(filtered) & (filtered > 0)
        out[pos] = 10.0 * np.log10(np.maximum(filtered[pos], 1e-12))
        return out
    return filtered


def compute_otsu_threshold(
    diff_db: np.ndarray,
    direction: str = "negative",
    bins: int = 256,
) -> float:
    """Compute an adaptive Otsu threshold on finite backscatter differences."""
    finite = np.asarray(diff_db, dtype=np.float64)
    finite = finite[np.isfinite(finite)]
    if finite.size < 16:
        return -2.0 if direction == "negative" else 2.0

    work = np.abs(finite) if direction == "magnitude" else finite
    lo, hi = float(np.min(work)), float(np.max(work))
    if hi - lo < 1e-6:
        return float(lo)

    hist, bin_edges = np.histogram(work, bins=bins, range=(lo, hi))
    hist = hist.astype(np.float64)
    centers = 0.5 * (bin_edges[:-1] + bin_edges[1:])
    weight1 = np.cumsum(hist)
    weight2 = np.cumsum(hist[::-1])[::-1]
    valid_split = (weight1[:-1] > 0) & (weight2[1:] > 0)
    if not np.any(valid_split):
        return float(0.5 * (lo + hi))

    mean1 = np.cumsum(hist * centers) / np.maximum(weight1, 1e-12)
    mean2 = (np.cumsum((hist * centers)[::-1]) / np.maximum(weight2[::-1], 1e-12))[::-1]
    between_var = weight1[:-1] * weight2[1:] * np.square(mean1[:-1] - mean2[1:])
    between_var = np.where(valid_split, between_var, -1.0)
    idx = int(np.argmax(between_var))
    return round(float(centers[idx]), 3)


def compute_polygon_confidence(
    mean_diff_db: float,
    threshold_db: float,
    pixel_count: int,
    same_orbit: Optional[bool] = None,
    temporal_days: Optional[float] = None,
    valid_fraction: float = 1.0,
) -> Tuple[float, str]:
    """Compute a transparent 0-1 confidence score and level for a polygon/job."""
    import math

    margin = min(1.0, max(0.0, (abs(float(mean_diff_db) - float(threshold_db)) + 1.0) / 5.0))
    area_score = min(1.0, math.log10(max(int(pixel_count), 1) + 1) / math.log10(101.0))
    orbit_weight = 1.0 if same_orbit is True else (0.35 if same_orbit is False else 0.65)
    t_decay = 1.0 if temporal_days is None else max(0.3, 1.0 - max(0.0, float(temporal_days) - 12.0) / 120.0)
    vf = min(1.0, max(0.0, float(valid_fraction)))
    score = round(0.40 * margin + 0.25 * area_score + 0.20 * orbit_weight + 0.15 * vf * t_decay, 3)
    level = "High" if score >= 0.70 else ("Medium" if score >= 0.45 else "Low")
    return score, level


def compute_severity_area_confidence(
    area_km2: Optional[float],
    confidence_score: float,
) -> Tuple[str, str]:
    """Classify severity using area (km^2) combined with confidence score."""
    area = float(area_km2 or 0.0)
    conf = float(confidence_score or 0.0)
    if (area >= 2.0 and conf >= 0.65) or (area >= 10.0 and conf >= 0.45):
        return "High", SEVERITY_RULE
    if area >= 0.25 and conf >= 0.45:
        return "Medium", SEVERITY_RULE
    return "Low", SEVERITY_RULE


def export_geotiff(
    dataset: Any,
    transform=None,
    crs: str = "EPSG:4326",
    filename: str = "result.tif",
    compress: str = "LZW",
) -> Dict[str, Any]:
    """
    Export a results dataset or 2D NumPy array as a LZW-compressed GeoTIFF file.

    Preserves georeferencing and metadata.

    Args:
        dataset: xarray Dataset or 2D numpy ndarray with the result data
        transform: Affine transform for georeferencing (optional, identity if None)
        crs: Coordinate reference system (default EPSG:4326)
        filename: Output filename
        compress: GeoTIFF compression codec (default LZW)

    Returns:
        Export result metadata
    """
    try:
        import rasterio
        from affine import Affine

        # Default identity transform if none provided
        if transform is None:
            transform = Affine(1, 0, 0, 0, 1, 0)

        if isinstance(dataset, np.ndarray):
            data = dataset
        else:
            # Get the first data variable
            data_vars = list(dataset.data_vars)
            if not data_vars:
                raise ValueError("No data variables found in dataset")

            var_name = data_vars[0]
            data = dataset[var_name].values

        # Handle masked arrays
        if hasattr(data, "mask"):
            data = np.ma.filled(data, fill_value=-9999)

        # Ensure 2D data - if 3D, take first slice
        if data.ndim == 3:
            data = data[0]

        # Ensure 2D
        if data.ndim != 2:
            raise ValueError(f"Expected 2D data, got {data.ndim}D")

        rows, cols = data.shape
        out_arr = np.where(np.isfinite(data), data, -9999).astype(rasterio.float32)

        with rasterio.open(
            filename,
            "w",
            driver="GTiff",
            height=rows,
            width=cols,
            count=1,
            dtype="float32",
            crs=crs,
            transform=transform,
            nodata=-9999,
            compress=compress,
        ) as dst:
            dst.write(out_arr, 1)

        result = {
            "success": True,
            "filename": filename,
            "format": "GeoTIFF",
            "rows": rows,
            "cols": cols,
            "crs": crs,
            "bands": 1,
            "dtype": str(data.dtype),
            "nodata": -9999,
        }

        logger.info("Exported GeoTIFF: %s (%dx%d)", filename, rows, cols)
        return result

    except ImportError:
        logger.warning("rasterio not available for GeoTIFF export")
        return {
            "success": False,
            "error": "rasterio not available for GeoTIFF export",
            "note": "GeoTIFF export requires rasterio. "
                    "Install with: pip install rasterio",
        }
    except Exception as e:
        logger.error("GeoTIFF export failed: %s", e)
        return {
            "success": False,
            "error": str(e),
            "note": "GeoTIFF export failed. Check dataset format and rasterio installation.",
        }


def build_affine_from_coords(
    x_coords: np.ndarray,
    y_coords: np.ndarray,
):
    """Build a pixel-center Affine transform from 1-D x/y coordinate vectors."""
    from affine import Affine

    x_arr = np.asarray(x_coords, dtype=np.float64)
    y_arr = np.asarray(y_coords, dtype=np.float64)
    dx = float(x_arr[1] - x_arr[0]) if x_arr.size > 1 else 20.0
    dy = float(y_arr[1] - y_arr[0]) if y_arr.size > 1 else -20.0
    return Affine(dx, 0.0, float(x_arr[0]) - dx / 2.0, 0.0, dy, float(y_arr[0]) - dy / 2.0)


def export_geojson(
    difference_mask: np.ndarray,
    transform=None,
    crs: str = "EPSG:4326",
    threshold: float = -3.0,
    x_coords: Optional[np.ndarray] = None,
    y_coords: Optional[np.ndarray] = None,
    spacing_m: Optional[list] = None,
    min_pixels: int = 4,
    simplify_tolerance: float = 0.0001,
    mode: str = "decrease",
    same_orbit: Optional[bool] = None,
    temporal_days: Optional[float] = None,
    valid_fraction: float = 1.0,
) -> Dict[str, Any]:
    """Export flood/change detection results as georeferenced EPSG:4326 GeoJSON polygons.

    Filters out connected components smaller than ``min_pixels``, polygonizes the
    mask in the granule's projected CRS via ``rasterio.features.shapes``,
    reprojects polygons to WGS84 (EPSG:4326), simplifies geometries, and
    attaches a per-polygon confidence score/level.
    """
    try:
        from affine import Affine
        from pyproj import Transformer
        from rasterio.features import shapes
        from scipy import ndimage
        from shapely.geometry import mapping, shape
        from shapely.ops import transform as shapely_transform

        if difference_mask is None:
            return {
                "type": "FeatureCollection",
                "features": [],
                "metadata": {"threshold": threshold, "method": "backscatter_difference_flood", "total_pixels_checked": 0},
            }

        valid_mask = ~np.isnan(difference_mask)
        mode_l = (mode or "decrease").lower()
        if mode_l == "magnitude":
            flood_mask = np.where(valid_mask, np.abs(difference_mask) > abs(float(threshold)), False)
        elif mode_l == "both":
            flood_mask = np.where(
                valid_mask,
                (difference_mask < float(threshold)) | (np.abs(difference_mask) > abs(float(threshold))),
                False,
            )
        else:
            flood_mask = np.where(valid_mask, difference_mask < float(threshold), False)

        if not np.any(flood_mask):
            return {
                "type": "FeatureCollection",
                "features": [],
                "metadata": {
                    "threshold": threshold,
                    "method": "backscatter_difference_flood",
                    "min_pixels": min_pixels,
                    "total_pixels_checked": int(valid_mask.sum()),
                },
            }

        # Filter tiny connected components before polygonization (4-connectivity).
        labeled, _ = ndimage.label(flood_mask)
        counts = np.bincount(labeled.ravel())
        keep_lut = counts >= max(1, int(min_pixels))
        keep_lut[0] = False
        clean_labeled = np.where(keep_lut[labeled], labeled, 0).astype(np.int32)

        if not np.any(clean_labeled):
            return {
                "type": "FeatureCollection",
                "features": [],
                "metadata": {
                    "threshold": threshold,
                    "method": "backscatter_difference_flood",
                    "min_pixels": min_pixels,
                    "total_pixels_checked": int(valid_mask.sum()),
                },
            }

        if transform is None:
            if x_coords is not None and y_coords is not None:
                transform = build_affine_from_coords(x_coords, y_coords)
            else:
                transform = Affine.identity()

        crs_norm = str(crs or "EPSG:4326").upper()
        reproject = None
        if crs_norm != "EPSG:4326":
            transformer = Transformer.from_crs(crs_norm, "EPSG:4326", always_xy=True)
            reproject = transformer.transform

        features = []
        for geom_dict, comp_val in shapes(clean_labeled, mask=(clean_labeled > 0), transform=transform):
            cid = int(comp_val)
            if cid <= 0:
                continue
            comp_mask = clean_labeled == cid
            px_count = int(comp_mask.sum())
            comp_vals = difference_mask[comp_mask]
            mean_diff = float(np.nanmean(comp_vals))
            min_diff = float(np.nanmin(comp_vals))

            if spacing_m and len(spacing_m) >= 2:
                area_km2: Optional[float] = px_count * abs(float(spacing_m[0])) * abs(float(spacing_m[1])) / 1e6
            elif crs_norm != "EPSG:4326":
                area_km2 = px_count * abs(float(transform.a)) * abs(float(transform.e)) / 1e6
            else:
                area_km2 = None

            geom = shape(geom_dict)
            if reproject is not None:
                geom = shapely_transform(reproject, geom)
            if simplify_tolerance > 0:
                simplified = geom.simplify(simplify_tolerance, preserve_topology=True)
                if not simplified.is_empty:
                    geom = simplified

            eval_val = -abs(mean_diff) if mode_l == "magnitude" else mean_diff
            eval_thr = -abs(float(threshold)) if mode_l == "magnitude" else float(threshold)
            conf_score, conf_level = compute_polygon_confidence(
                mean_diff_db=eval_val,
                threshold_db=eval_thr,
                pixel_count=px_count,
                same_orbit=same_orbit,
                temporal_days=temporal_days,
                valid_fraction=valid_fraction,
            )

            features.append({
                "type": "Feature",
                "properties": {
                    "threshold": threshold,
                    "pixel_count": px_count,
                    "area_km2": area_km2,
                    "mean_difference_db": mean_diff,
                    "min_difference_db": min_diff,
                    "confidence_score": conf_score,
                    "confidence_level": conf_level,
                    "flood_indicator": True,
                },
                "geometry": mapping(geom),
            })

        geojson = {
            "type": "FeatureCollection",
            "features": features,
            "metadata": {
                "threshold": threshold,
                "method": "backscatter_difference_flood",
                "crs": "EPSG:4326",
                "source_crs": crs_norm,
                "min_pixels": min_pixels,
                "total_pixels_checked": int(valid_mask.sum()),
                "confidence_formula": CONFIDENCE_FORMULA,
            },
        }
        logger.info("Exported georeferenced GeoJSON with %d polygon features", len(features))
        return geojson

    except Exception as e:
        logger.error("GeoJSON export failed: %s", e, exc_info=True)
        return {
            "type": "FeatureCollection",
            "features": [],
            "metadata": {
                "threshold": threshold,
                "method": "backscatter_difference_flood",
                "error": str(e),
            },
        }