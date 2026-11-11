"""Monitoring regions and supported NISAR dataset metadata routes."""

import logging
from typing import List
from fastapi import APIRouter

from app.schemas import DatasetDetailOut, DatasetOut, RegionOut
from app.services import cache
from app.services.hazards import resolve_short_names

logger = logging.getLogger(__name__)

router = APIRouter(tags=["datasets"])


@router.get("/regions", response_model=List[RegionOut], summary="Available monitoring regions")
async def get_regions():
    """Get reference monitoring regions for NISAR data analysis."""
    regions = [
        RegionOut(id="amazon", name="Amazon Basin", country="Brazil", lat=-1.5, lon=-52.0),
        RegionOut(id="mekong", name="Mekong Delta", country="Vietnam", lat=10.0, lon=105.0),
        RegionOut(
            id="sahel",
            name="Sahel Region",
            countries=["Niger", "Nigeria", "Chad"],
            lat=13.5,
            lon=2.1,
        ),
        RegionOut(
            id="andean",
            name="Andean Region",
            countries=["Peru", "Bolivia", "Argentina"],
            lat=-13.0,
            lon=-72.0,
        ),
    ]
    logger.info("Fetched %d regions", len(regions))
    return regions


@router.get("/datasets", response_model=List[DatasetOut], summary="Available NISAR datasets")
async def get_datasets():
    """List supported NISAR products (real CMR short names included)."""
    return [
        DatasetOut(
            id="nisar_l2_gcov",
            short_name="NISAR_L2_GCOV_PROVISIONAL_V1",
            fallback_short_name="NISAR_L2_GCOV_BETA_V1",
            name="NISAR Level-2 Geocoded Polarimetric Covariance (PROVISIONAL)",
            provider="NASA/ISRO via ASF DAAC",
            description=(
                "Calibrated, geocoded polarimetric covariance grids. "
                "Used by TerraPulse for backscatter change indicators."
            ),
            product_type="Geocoded Polarimetric products",
            spatial_resolution="~30 m",
            polarizations=["HH", "HV", "VV"],
        ),
        DatasetOut(
            id="nisar_l2_gcov_beta",
            short_name="NISAR_L2_GCOV_BETA_V1",
            name="NISAR Level-2 Geocoded Polarimetric Covariance (BETA)",
            provider="NASA/ISRO via ASF DAAC",
            description=(
                "Pre-calibration GCOV release. Useful where PROVISIONAL "
                "coverage is unavailable."
            ),
            product_type="Geocoded Polarimetric products",
            spatial_resolution="~30 m",
            polarizations=["HH", "HV", "VV"],
        ),
    ]


@router.get("/datasets/{dataset_id}", response_model=DatasetDetailOut, summary="Get dataset details")
async def get_dataset(dataset_id: str):
    """Get detailed information about a supported dataset."""
    provider = cache.get_provider()
    short_names = resolve_short_names(dataset_id)
    info = provider.get_product_info(short_names[0])
    return DatasetDetailOut(
        id=dataset_id,
        short_name=short_names[0],
        fallback_short_names=short_names[1:],
        name=info["name"],
        provider="NASA/ISRO via ASF DAAC",
        description=info["description"],
        product_type=info["product_type"],
        spatial_resolution=info["spatial_resolution"],
        polarizations=info["polarizations"],
        orbit=info["orbit"],
    )
