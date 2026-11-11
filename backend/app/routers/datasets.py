"""Monitoring regions and supported NISAR dataset metadata routes."""

import asyncio
import logging
from typing import List
from fastapi import APIRouter

from app.schemas import DatasetDetailOut, DatasetOut, DiscoveredCollectionOut, RegionOut
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
            fallback_short_name="NISAR_L2_GCOV_V1",
            name="NISAR Level-2 Geocoded Polarimetric Covariance (PROVISIONAL)",
            provider="NASA/ISRO via ASF DAAC",
            description=(
                "Calibrated, geocoded polarimetric covariance grids (~20-30 m). "
                "Used by TerraPulse for HH/HV/VV backscatter change indicators."
            ),
            product_type="Geocoded Polarimetric products",
            spatial_resolution="~20-30 m",
            polarizations=["HH", "HV", "VV"],
        ),
        DatasetOut(
            id="nisar_l2_gunw",
            short_name="NISAR_L2_GUNW_PROVISIONAL_V1",
            fallback_short_name="NISAR_L2_GUNW_BETA_V1",
            name="NISAR Level-2 Geocoded Unwrapped Interferogram (GUNW)",
            provider="NASA/ISRO via ASF DAAC",
            description=(
                "L-band interferometric unwrapped phase & coherence (~80 m) for "
                "surface deformation / ground motion indicators."
            ),
            product_type="Geocoded InSAR Interferogram",
            spatial_resolution="~80 m",
            polarizations=["HH", "VV"],
        ),
        DatasetOut(
            id="nisar_l2_gslc",
            short_name="NISAR_L2_GSLC_PROVISIONAL_V1",
            fallback_short_name="NISAR_L2_GSLC_BETA_V1",
            name="NISAR Level-2 Geocoded Single-Look Complex (GSLC)",
            provider="NASA/ISRO via ASF DAAC",
            description="Geocoded complex SAR amplitude & phase imagery.",
            product_type="Geocoded Complex SAR",
            spatial_resolution="~5-10 m",
            polarizations=["HH", "HV", "VV"],
        ),
        DatasetOut(
            id="nisar_l3_sme2",
            short_name="NISAR_L3_SME2_PROVISIONAL_V1",
            fallback_short_name="NISAR_L3_SME2_BETA_V1",
            name="NISAR Level-3 Soil Moisture (SME2)",
            provider="NASA/ISRO via ASF DAAC",
            description="200 m L-band soil moisture product for agricultural and drought context.",
            product_type="Level-3 Soil Moisture",
            spatial_resolution="~200 m",
            polarizations=["HH", "HV"],
        ),
    ]


@router.get(
    "/datasets/discover",
    response_model=List[DiscoveredCollectionOut],
    summary="Discover all live NISAR collections in NASA CMR",
)
async def discover_datasets():
    """Query NASA Earthdata CMR dynamically for published NISAR collections."""
    provider = cache.get_provider()
    try:
        cols = await asyncio.to_thread(cache.cached_discover_collections, provider, "NISAR", 50)
    except Exception as e:
        logger.warning("CMR discovery failed: %s", e)
        return []
    return [DiscoveredCollectionOut(**c) for c in cols]


@router.get(
    "/datasets/{dataset_id}", response_model=DatasetDetailOut, summary="Get dataset details"
)
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
