"""Hazard configurations and Earthdata CMR collection short-name mappings."""

from typing import Any, Dict, List

SHORT_NAME_CANDIDATES: Dict[str, List[str]] = {
    "nisar_l2_gcov": [
        "NISAR_L2_GCOV_PROVISIONAL_V1",
        "NISAR_L2_GCOV_V1",
        "NISAR_L2_GCOV_BETA_V1",
    ],
    "nisar_l2_gcov_provisional": ["NISAR_L2_GCOV_PROVISIONAL_V1"],
    "nisar_l2_gcov_beta": ["NISAR_L2_GCOV_BETA_V1"],
    "nisar_l2_gunw": [
        "NISAR_L2_GUNW_PROVISIONAL_V1",
        "NISAR_L2_GUNW_V1",
        "NISAR_L2_GUNW_BETA_V1",
    ],
    "nisar_l2_gslc": [
        "NISAR_L2_GSLC_PROVISIONAL_V1",
        "NISAR_L2_GSLC_V1",
        "NISAR_L2_GSLC_BETA_V1",
    ],
    "nisar_l3_sme2": [
        "NISAR_L3_SME2_PROVISIONAL_V1",
        "NISAR_L3_SME2_BETA_V1",
    ],
}

SUPPORTED_BANDS = ("HH", "HV", "VV", "HH/HV")
SPECKLE_METHODS = ("none", "boxcar", "lee")
THRESHOLD_MODES = ("fixed", "otsu", "mean_std")

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
    "forest_disturbance": {
        "label": "Forest disturbance / canopy loss",
        "mode": "decrease",
        "threshold_db": -2.0,
        "default_band": "HV",
        "interpretation": (
            "Cross-polarized L-band HV backscatter is dominated by volumetric "
            "branch/canopy scattering. Clearing, blowdown or burn loss causes "
            "a strong HV decrease (>2 dB drop)."
        ),
        "cannot_say": [
            "Cannot distinguish selective logging from windthrow or seasonal leaf drop",
            "Dense tropical forest may partially saturate L-band HV",
        ],
    },
    "landslide": {
        "label": "Landslide / slope failure scar",
        "mode": "magnitude",
        "magnitude_db": 2.0,
        "default_band": "HV",
        "interpretation": (
            "Slope failures expose bare soil/rock and strip vegetation, causing "
            "strong backscatter change (>2 dB magnitude). Cross-check against "
            "terrain slope and optical imagery."
        ),
        "cannot_say": [
            "Cannot separate landslides from forest clearing without DEM slope context",
            "Steep terrain radar layover/shadowing reduces visibility",
        ],
    },
    "agriculture": {
        "label": "Agriculture / crop phenology & harvest",
        "mode": "magnitude",
        "magnitude_db": 2.0,
        "default_band": "HH/HV",
        "interpretation": (
            "HH/HV polarization ratio tracks canopy structure vs. bare soil/flooded "
            "paddy surfaces: harvesting, tillage and crop emergence produce strong "
            "cross-ratio shifts (>2 dB)."
        ),
        "cannot_say": [
            "Cannot identify crop species or yield directly from single-pair SAR",
            "Rainfall wetting and irrigation events alter HH/HV alongside growth",
        ],
    },
    "deformation": {
        "label": "Ground deformation (NISAR GUNW InSAR)",
        "mode": "insar_phase",
        "threshold_cm": 2.5,
        "dataset_id": "nisar_l2_gunw",
        "interpretation": (
            "Streams NISAR L2 GUNW unwrapped interferometric phase (converted to "
            "line-of-sight displacement in cm via L-band lambda ~ 24 cm) alongside "
            "interferometric coherence."
        ),
        "cannot_say": [
            "LOS displacement measures motion along radar line of sight only, not 3D vectors",
            "Requires high coherence (>= 0.35); vegetated/water pixels decorrelate",
            "GUNW products may be absent in early operational coverage; falls back transparently",
        ],
    },
}


def resolve_short_names(dataset_id: str) -> List[str]:
    """Resolve a UI dataset id (or raw CMR short name) to candidate CMR short names."""
    candidates = list(SHORT_NAME_CANDIDATES.get(dataset_id, []))
    if dataset_id not in SHORT_NAME_CANDIDATES:
        candidates.append(dataset_id)
    return list(dict.fromkeys(candidates))
