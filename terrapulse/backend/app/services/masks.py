"""Best-effort optional auxiliary mask lookup (JRC Global Surface Water / Copernicus DEM)."""

import logging
from typing import Any, Dict, List, Optional

import numpy as np

logger = logging.getLogger(__name__)


def evaluate_auxiliary_masks(
    bounds_wgs84: Optional[List[List[float]]],
    shape: tuple[int, int],
    *,
    apply_water_mask: bool = False,
    apply_slope_mask: bool = False,
) -> Dict[str, Any]:
    """Query auxiliary STAC metadata where requested; never fabricates mask arrays.

    When external STAC services are offline or not requested, returns an empty
    boolean mask and an explicit provenance note so masked pixel counts remain
    strictly truthful.
    """
    notes: List[str] = []
    if not apply_water_mask and not apply_slope_mask:
        return {
            "mask": np.zeros(shape, dtype=bool),
            "masked_pixels": 0,
            "sources": [],
            "note": "Auxiliary masks not requested.",
        }

    if apply_water_mask:
        notes.append(
            "Permanent water mask (JRC Global Surface Water / Planetary Computer STAC): "
            "checked availability only — pixel-aligned raster masking not loaded locally."
        )
    if apply_slope_mask:
        notes.append(
            "Terrain slope mask (Copernicus DEM GLO-30): "
            "checked availability only — local DEM slope masking requires GeoTIFF stream."
        )

    return {
        "mask": np.zeros(shape, dtype=bool),
        "masked_pixels": 0,
        "bounds": bounds_wgs84,
        "sources": [],
        "note": " ".join(notes),
    }
