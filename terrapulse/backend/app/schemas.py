"""Pydantic v2 API schemas for TerraPulse endpoints (/docs OpenAPI support)."""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    service: str


class RootResponse(BaseModel):
    message: str
    version: str


class RegionOut(BaseModel):
    id: str
    name: str
    country: Optional[str] = None
    countries: Optional[List[str]] = None
    lat: float
    lon: float


class DatasetOut(BaseModel):
    id: str
    short_name: str
    fallback_short_name: Optional[str] = None
    name: str
    provider: str
    description: str
    product_type: str
    spatial_resolution: str
    polarizations: List[str]


class DatasetDetailOut(BaseModel):
    id: str
    short_name: str
    fallback_short_names: List[str] = Field(default_factory=list)
    name: str
    provider: str
    description: str
    product_type: str
    spatial_resolution: str
    polarizations: List[str]
    orbit: str


class LocationPoint(BaseModel):
    lat: float
    lon: float


class ObservationItemOut(BaseModel):
    id: Optional[str] = None
    title: Optional[str] = None
    short_name: Optional[str] = None
    dataset_id: str
    acquisition_date: Optional[str] = None
    orbit_direction: str = "unknown"
    location: LocationPoint
    bounding_box: Optional[List[float]] = None
    https_url: Optional[str] = None
    s3_url: Optional[str] = None


class ObservationNoteOut(BaseModel):
    id: str
    note: str
    https_search: str


class GranuleSummaryOut(BaseModel):
    id: Optional[str] = None
    title: Optional[str] = None
    short_name: Optional[str] = None
    acquisition_date: Optional[str] = None
    orbit_direction: str = "unknown"
    bounding_box: Optional[List[float]] = None
    https_url: Optional[str] = None
    s3_url: Optional[str] = None
    browse_url: Optional[str] = None


class AvailabilityResponse(BaseModel):
    available: bool
    short_name: Optional[str] = None
    count: Optional[int] = None
    datasets: List[GranuleSummaryOut] = Field(default_factory=list)
    short_names_searched: List[str] = Field(default_factory=list)
    note: Optional[str] = None


class GeocodeResultOut(BaseModel):
    lat: str
    lon: str
    display_name: str
    type: Optional[str] = None
    importance: Optional[float] = None


class DatePairOut(BaseModel):
    before: Optional[str] = None
    after: Optional[str] = None


class JobStartResponse(BaseModel):
    job_id: str
    status: str
    status_url: str
    hazard: Optional[str] = None
    message: str


class JobSummaryOut(BaseModel):
    job_id: str
    status: str
    stage: Optional[str] = None
    progress: int = 0
    hazard: str = "flood"
    location: Dict[str, Optional[float]]
    requested_dates: DatePairOut
    actual_granule_dates: Optional[DatePairOut] = None
    auto_dates: bool = False
    mean_db: Optional[float] = None
    percentage_decrease: Optional[float] = None
    percentage_disturbed: Optional[float] = None
    affected_area_km2: Optional[float] = None
    outlines: int = 0
    error: Optional[str] = None
    created_at: str


class JobDetailOut(BaseModel):
    job_id: str
    status: str
    stage: str
    progress: int
    params: Dict[str, Any] = Field(default_factory=dict)
    created_at: str
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class PointInsightsResponse(BaseModel):
    available: bool
    location: LocationPoint
    short_name: Optional[str] = None
    granules_last_90d: Optional[int] = None
    latest_acquisition: Optional[str] = None
    latest_granule: Optional[GranuleSummaryOut] = None
    recent_acquisitions: List[str] = Field(default_factory=list)
    supported_hazards: List[str] = Field(default_factory=list)
    short_names_searched: List[str] = Field(default_factory=list)
    note: str


class AnalysisStubOut(BaseModel):
    analysis_id: str
    status: str
    message: str
    produced_at: Optional[str] = None


class AuthStatusResponse(BaseModel):
    connected: bool
    timestamp: str
    note: str


class MetadataResponse(BaseModel):
    version: str
    service: str
    mode: str
    data_sources: Dict[str, str]
    supported_phenomena: List[str]
    status: str
    data_provider: str
    access_methods: List[str]
    authentication: str
