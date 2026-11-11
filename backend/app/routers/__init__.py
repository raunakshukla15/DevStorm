"""Aggregated API v1 router combining domain sub-routers."""

from fastapi import APIRouter

from app.routers import (
    analysis,
    aois,
    auth,
    datasets,
    events,
    jobs,
    observations,
    timeseries,
    watchlist,
)

api_router = APIRouter(prefix="/api/v1")

# Note: jobs.router MUST come before analysis.router so /analysis/jobs
# is never shadowed by /analysis/{analysis_id}.
api_router.include_router(auth.router)
api_router.include_router(datasets.router)
api_router.include_router(observations.router)
api_router.include_router(aois.router)
api_router.include_router(events.router)
api_router.include_router(timeseries.router)
api_router.include_router(watchlist.router)
api_router.include_router(jobs.router)
api_router.include_router(analysis.router)
