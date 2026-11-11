from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load backend/.env automatically so NASA_EARTHDATA_* credentials are
# available via os.getenv without manual `set` commands.
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

from app.api.v1.router import router

app = FastAPI(
    title="TerraPulse API",
    description="Earth Surface Intelligence - NISAR satellite data analysis platform",
    version="0.1.0",
)

# CORS - will be configured with specific origins in production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API router (router already carries the /api/v1 prefix)
app.include_router(router)

@app.get("/")
async def root():
    return {"message": "TerraPulse API is running", "version": "0.1.0"}

@app.get("/api/health")
async def health():
    return {"status": "healthy", "service": "terrapulse-backend"}