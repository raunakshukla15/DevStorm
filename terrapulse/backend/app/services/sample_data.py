"""Precomputed sample NISAR L2 GCOV change-indicator payload for guided walkthroughs."""

from datetime import datetime
from typing import Any, Dict

import numpy as np

from app.services.flood_analysis import (
    CONFIDENCE_FORMULA,
    SEVERITY_RULE,
    compute_polygon_confidence,
    compute_severity_area_confidence,
    export_geojson,
)


def get_sample_nisar_result() -> Dict[str, Any]:
    """Return an explicitly labeled sample NISAR L2 GCOV indicator payload (Amazon flooded forest).

    Coordinates correspond to EPSG:32722 (UTM 22S) matching real verified
    Amazon Basin NISAR L2 GCOV geometry, with synthetic dB change arrays built
    through the real GeoJSON/confidence pipeline so first-time visitors can explore
    all UI controls without waiting on a download. Clearly marked is_sample=True.
    """
    n = 64
    x_coords = np.linspace(388000.0, 388000.0 + (n - 1) * 20.0, n)
    y_coords = np.linspace(9835000.0, 9835000.0 - (n - 1) * 20.0, n)
    diff = np.full((n, n), -0.3, dtype=np.float64)
    diff[16:42, 18:46] = -4.2

    gj = export_geojson(
        diff,
        crs="EPSG:32722",
        threshold=-2.0,
        x_coords=x_coords,
        y_coords=y_coords,
        spacing_m=[20.0, 20.0],
        min_pixels=4,
        same_orbit=True,
        temporal_days=12.0,
        valid_fraction=1.0,
    )
    px = sum(int(f["properties"]["pixel_count"]) for f in gj["features"])
    area_km2 = round(px * 400.0 / 1e6, 4)
    conf_score, conf_level = compute_polygon_confidence(
        -4.2, -2.0, px, same_orbit=True, temporal_days=12.0
    )
    sev, _ = compute_severity_area_confidence(area_km2, conf_score)

    return {
        "success": True,
        "is_sample": True,
        "status": "analyzed",
        "method": "backscatter_difference_indicator (dB units)",
        "hazard": "flood",
        "hazard_label": "Flood / wetland change (SAMPLE)",
        "interpretation": (
            "Standing water is a smooth specular surface: L-band backscatter drops "
            "sharply. Pixels darker by >2 dB are flood candidates."
        ),
        "data_source": "Sample NISAR L2 GCOV demonstration grid (EPSG:32722 UTM 22S)",
        "requested_dates": {"before": "2026-01-12", "after": "2026-01-24"},
        "auto_dates": False,
        "actual_granule_dates": {"before": "2026-01-12", "after": "2026-01-24"},
        "same_orbit_pair": True,
        "location": {"lat": -1.5, "lon": -52.0},
        "short_name": "NISAR_L2_GCOV_PROVISIONAL_V1",
        "polarization_band": "HH",
        "threshold_db": -2.0,
        "threshold_mode": "fixed",
        "speckle_filter": "lee",
        "detection_mode": "decrease",
        "severity": sev,
        "severity_rule": SEVERITY_RULE,
        "windows": {
            "size": n,
            "requested_window": n,
            "before_layer": "HHHH",
            "after_layer": "HHHH",
            "before_origin": [100, 100],
            "before_shape": [5400, 5400],
            "after_origin": [100, 100],
            "after_shape": [5400, 5400],
            "crs": "EPSG:32722",
            "epsg": 32722,
            "bounds": [[-1.5008, -52.0065], [-1.4892, -51.9950]],
            "note": "Guided sample demonstration matching EPSG:32722 GCOV grid geometry.",
        },
        "before_granule": {
            "id": "SAMPLE_GCOV_BEFORE",
            "title": "NISAR_L2_PR_GCOV_SAMPLE_20260112",
            "short_name": "NISAR_L2_GCOV_PROVISIONAL_V1",
            "acquisition_date": "2026-01-12",
            "orbit_direction": "ascending",
        },
        "after_granule": {
            "id": "SAMPLE_GCOV_AFTER",
            "title": "NISAR_L2_PR_GCOV_SAMPLE_20260124",
            "short_name": "NISAR_L2_GCOV_PROVISIONAL_V1",
            "acquisition_date": "2026-01-24",
            "orbit_direction": "ascending",
        },
        "compatibility_check": {"compatible": True, "warnings": []},
        "analysis": {
            "mean_backscatter_difference_db": -0.99,
            "std_difference_db": 1.48,
            "percentage_decrease": round(px / (n * n) * 100.0, 2),
            "percentage_disturbed": round(px / (n * n) * 100.0, 2),
            "affected_area_km2": area_km2,
            "area_basis": "outline pixels x product ground spacing",
            "valid_pixels": n * n,
            "total_pixels": n * n,
        },
        "results": {"flood_outlines": gj},
        "caveats_and_limitations": [
            "SAMPLE DEMONSTRATION ONLY — run a live job for current Earthdata granules",
            "This is a change INDICATOR only, not a validated flood map",
            "CANNOT conclude: Not a validated flood map",
            "CANNOT conclude: Needs optical/field confirmation",
        ],
        "confidence": {
            "score": conf_score,
            "level": conf_level,
            "formula": CONFIDENCE_FORMULA,
            "based_on": "dB backscatter difference (decrease mode) on sample GCOV window",
            "quality": "sample-demonstration",
            "requires_validation": "Run a live analysis job to fetch actual NASA Earthdata imagery",
        },
        "produced_at": datetime.now().isoformat() + "Z",
    }
