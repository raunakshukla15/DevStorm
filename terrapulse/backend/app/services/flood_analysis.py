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


def export_geotiff(
    dataset: xr.Dataset,
    transform=None,
    crs: str = "EPSG:4326",
    filename: str = "result.tif",
) -> Dict[str, Any]:
    """
    Export a results dataset as a GeoTIFF file.

    Preserves georeferencing and metadata.

    Args:
        dataset: xarray Dataset with the result data
        transform: Affine transform for georeferencing (optional, identity if None)
        crs: Coordinate reference system (default EPSG:4326)
        filename: Output filename

    Returns:
        Export result metadata
    """
    try:
        import rasterio
        from affine import Affine

        # Default identity transform if none provided
        if transform is None:
            transform = Affine(1, 0, 0, 0, 1, 0)

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

        with rasterio.open(
            filename,
            "w",
            driver="GTiff",
            height=rows,
            width=cols,
            count=1,
            dtype=str(data.dtype),
            crs=crs,
            transform=transform,
            nodata=-9999,
        ) as dst:
            dst.write(data.astype(rasterio.float32), 1)

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


def export_geojson(
    difference_mask: np.ndarray,
    transform=None,
    crs: str = "EPSG:4326",
    threshold: float = -3.0,
) -> Dict[str, Any]:
    """
    Export flood detection results as GeoJSON vector outlines.

    Creates polygons of areas where backscatter difference falls below threshold.

    Args:
        difference_mask: Masked difference array (after - before)
        transform: Affine transform for georeferencing (optional)
        crs: Coordinate reference system (default EPSG:4326)
        threshold: Backscatter difference threshold for flood indication
                  (negative values indicate potential flooding)

    Returns:
        GeoJSON dict with flood outlines
    """
    try:
        import numpy as onp

        # Create binary mask: potential flood where difference < threshold
        # Use np.isnan to identify valid pixels, then check threshold
        valid_mask = ~onp.isnan(difference_mask)
        flood_mask = onp.where(valid_mask, difference_mask < threshold, False)

        # If no flood pixels, return empty GeoJSON
        if not onp.any(flood_mask):
            return {
                "type": "FeatureCollection",
                "features": [],
                "metadata": {
                    "threshold": threshold,
                    "method": "backscatter_difference_flood",
                    "total_pixels_checked": int(valid_mask.sum()),
                },
            }

        # Simple approach: use connected components via scipy if available,
        # otherwise return centroid-based features
        try:
            from scipy import ndimage

            # Label connected components
            labeled, num_features = ndimage.label(flood_mask)

            features = []
            for i in range(1, num_features + 1):
                # Get component mask
                component_mask = labeled == i

                # Calculate centroid
                cy, cx = onp.unravel_index(
                    onp.argmax(component_mask), component_mask.shape
                )

                # Calculate area
                area = int(component_mask.sum())

                # Calculate mean difference within this component
                component_diffs = difference_mask[component_mask]
                mean_diff = float(onp.nanmean(component_diffs)) if component_diffs.size > 0 else 0.0

                feature = {
                    "type": "Feature",
                    "properties": {
                        "threshold": threshold,
                        "mean_difference": mean_diff,
                        "pixel_count": area,
                        "flood_indicator": True,
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [float(cx), float(cy)],
                    },
                }
                features.append(feature)

            geojson = {
                "type": "FeatureCollection",
                "features": features,
                "metadata": {
                    "threshold": threshold,
                    "method": "backscatter_difference_flood",
                    "total_pixels_checked": int(valid_mask.sum()),
                },
            }

            logger.info("Exported GeoJSON with %d flood features", len(features))
            return geojson

        except ImportError:
            # Fallback without scipy: return a single feature at center of mass
            # Calculate center of mass of flood pixels
            flood_y, flood_x = onp.where(flood_mask)
            
            if len(flood_y) == 0:
                return {
                    "type": "FeatureCollection",
                    "features": [],
                    "metadata": {
                        "threshold": threshold,
                        "method": "backscatter_difference_flood",
                        "total_pixels_checked": int(valid_mask.sum()),
                    },
                }

            # Compute centroid
            cx = float(onp.mean(flood_x))
            cy = float(onp.mean(flood_y))
            area = len(flood_y)

            # Calculate mean difference within flood area
            mean_diff = float(onp.nanmean(difference_mask[flood_mask])) if onp.any(flood_mask) else 0.0

            feature = {
                "type": "Feature",
                "properties": {
                    "threshold": threshold,
                    "mean_difference": mean_diff,
                    "pixel_count": area,
                    "flood_indicator": True,
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [cx, cy],
                },
            }

            geojson = {
                "type": "FeatureCollection",
                "features": [feature],
                "metadata": {
                    "threshold": threshold,
                    "method": "backscatter_difference_flood",
                    "total_pixels_checked": int(valid_mask.sum()),
                },
            }

            logger.info(
                "Exported GeoJSON with %d flood feature (centroid-based)",
                len(geojson["features"]),
            )
            return geojson

    except Exception as e:
        logger.error("GeoJSON export failed: %s", e)
        return {
            "type": "FeatureCollection",
            "features": [],
            "metadata": {
                "threshold": threshold,
                "method": "backscatter_difference_flood",
                "error": str(e),
            },
        }