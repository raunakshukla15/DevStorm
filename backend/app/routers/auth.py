"""Authentication, health, and system metadata routes."""

from datetime import datetime
from fastapi import APIRouter

from app.schemas import AuthStatusResponse, HealthResponse, MetadataResponse
from app.services import cache

router = APIRouter(tags=["auth"])


@router.get("/health", response_model=HealthResponse, summary="Health check endpoint")
async def health():
    """Root health check endpoint."""
    return HealthResponse(status="healthy", service="terrapulse-backend")


@router.get(
    "/auth/status", response_model=AuthStatusResponse, summary="Live Earthdata connection check"
)
async def auth_status():
    """Actually attempts authentication and reports the real outcome.

    Powers the Settings 'Test Connection' button. No credentials are returned.
    """
    provider = cache.get_provider()
    ok = provider.is_authenticated() or provider.authenticate()
    return AuthStatusResponse(
        connected=bool(ok),
        timestamp=datetime.now().isoformat() + "Z",
        note=(
            "Authenticated with NASA Earthdata."
            if ok
            else "Not authenticated — set NASA_EARTHDATA_USERNAME and "
            "NASA_EARTHDATA_PASSWORD in backend/.env, then restart the backend."
        ),
    )


@router.get("/metadata", response_model=MetadataResponse, summary="Get system metadata")
async def get_metadata():
    """Get system metadata including data sources and processing status."""
    return MetadataResponse(
        version="0.2.0",
        service="TerraPulse Backend",
        mode="live-only (no synthetic data)",
        data_sources={
            "nisar": "NASA-ISRO Synthetic Aperture Radar mission",
            "earthdata": "NASA Earthdata Search / Earthaccess (CMR + authenticated HTTPS streaming)",
        },
        supported_phenomena=[
            "flood monitoring (live dB backscatter change detection on GCOV windows)",
        ],
        status="operational",
        data_provider="NISAR via NASA Earthdata",
        access_methods=[
            "authenticated HTTPS streaming (windowed)",
            "S3 URLs reported per granule",
        ],
        authentication="Earthdata Login (EDL) required via backend/.env",
    )
