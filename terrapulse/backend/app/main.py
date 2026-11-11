import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load backend/.env automatically so NASA_EARTHDATA_* credentials are
# available via os.getenv without manual `set` commands.
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

from app.db import init_db
from app.routers import api_router
from app.schemas import RootResponse


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="TerraPulse API",
    description="Earth Surface Intelligence - NISAR satellite data analysis platform",
    version="0.2.0",
    lifespan=lifespan,
)

raw_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173")
cors_origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=("*" not in cors_origins),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/", response_model=RootResponse)
async def root():
    return RootResponse(message="TerraPulse API is running", version="0.2.0")
