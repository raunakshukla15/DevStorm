"""Hazard configurations and Earthdata CMR collection short-name mappings."""

from typing import Any, Dict, List

SHORT_NAME_CANDIDATES: Dict[str, List[str]] = {
    "nisar_l2_gcov": ["NISAR_L2_GCOV_PROVISIONAL_V1", "NISAR_L2_GCOV_BETA_V1"],
    "nisar_l2_gcov_provisional": ["NISAR_L2_GCOV_PROVISIONAL_V1"],
    "nisar_l2_gcov_beta": ["NISAR_L2_GCOV_BETA_V1"],
}

# NISAR revisit is ~12 days, so exact-date searches usually miss.
SEARCH_HALF_WINDOW_DAYS = 6

# Standard L-band SAR flooding drop threshold in decibels.
FLOOD_DB_THRESHOLD = -2.0

HAZARD_CONFIGS: Dict[str, Dict[str, Any]] = {
    "flood": {
        "label": "Flood / wetland change",
        "mode": "decrease",
        "threshold_db": -2.0,
        "interpretation": (
            "Standing water is a smooth specular surface: L-band "
            "backscatter drops sharply. Pixels darker by >2 dB are "
            "flood candidates."
        ),
        "cannot_say": ["Not a validated flood map", "Needs optical/field confirmation"],
    },
    "tsunami": {
        "label": "Tsunami coastal impact",
        "mode": "decrease",
        "threshold_db": -2.0,
        "interpretation": (
            "Tsunami inundation leaves coastal flooding and wet debris: "
            "look for newly dark pixels along the shoreline. Verify the "
            "point is coastal and check event timing against the two "
            "acquisition dates."
        ),
        "cannot_say": [
            "Cannot confirm a tsunami occurred — any coastal flood looks similar",
            "Needs tide gauge / eyewitness / optical confirmation",
        ],
    },
    "hurricane": {
        "label": "Hurricane / storm damage",
        "mode": "both",
        "threshold_db": -2.0,
        "magnitude_db": 2.0,
        "interpretation": (
            "Two signals: rainfall flooding (darker, >2 dB drop) plus "
            "wind damage — stripped/defoliated canopy and debris change "
            "roughness EITHER way (>2 dB absolute change)."
        ),
        "cannot_say": [
            "Cannot attribute damage to a specific storm without track data",
            "Cannot estimate wind speed from backscatter",
        ],
    },
    "volcano": {
        "label": "Volcanic eruption disturbance",
        "mode": "magnitude",
        "magnitude_db": 2.0,
        "interpretation": (
            "Fresh lava flows, ash blankets and lahars resurface the "
            "ground: roughness jumps either way, so strong absolute "
            "change (>2 dB) flags fresh deposits. Compare against known "
            "eruption dates for the volcano."
        ),
        "cannot_say": [
            "Cannot detect eruptions with no surface deposits",
            "Ash plumes themselves are not visible in this product",
            "Not a deformation measurement",
        ],
    },
    "earthquake": {
        "label": "Earthquake surface disturbance",
        "mode": "magnitude",
        "magnitude_db": 2.0,
        "interpretation": (
            "Shaking triggers landslides, rockfalls, surface rupture and "
            "liquefaction: disturbed ground changes roughness either "
            "way. Strong absolute change (>2 dB) marks candidate "
            "disturbed zones near the epicenter."
        ),
        "cannot_say": [
            "NOT a displacement measurement — true ground deformation "
            "requires InSAR (interferometric) products, not backscatter",
            "Cannot give magnitude, depth or fault slip",
        ],
    },
}


def resolve_short_names(dataset_id: str) -> List[str]:
    """Resolve a UI dataset id (or raw CMR short name) to candidate CMR short names."""
    candidates = list(SHORT_NAME_CANDIDATES.get(dataset_id, []))
    if dataset_id not in SHORT_NAME_CANDIDATES:
        candidates.append(dataset_id)
    return list(dict.fromkeys(candidates))
