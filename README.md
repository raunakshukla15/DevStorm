# TerraPulse — Earth Surface Intelligence

**Tagline:** *Observe Earth. Understand Change.*

TerraPulse is a full-stack geospatial intelligence platform for detecting and analyzing Earth-surface change (floods, tsunamis, hurricanes, earthquakes, landslides, volcanic activity, forest disturbance, agriculture, and InSAR ground deformation) from **NASA–ISRO NISAR** L-band SAR data streamed directly from NASA Earthdata CMR.

> [!IMPORTANT]
> Independent educational and engineering project — **not an official NASA or ISRO product**. Every result is an **indicator only** (never a validated hazard map) and preserves explicit scientific caveats and `"CANNOT conclude"` boundaries.

## Key Features

- **Location-Exact & AOI BBox Streaming (`GCOV` & `GUNW`):** Reads NISAR HDF5 1-D projection coordinate vectors (`xCoordinates` / `yCoordinates` + EPSG), transforms WGS84 targets via `pyproj`, crops exact spatial windows or user-drawn polygon/rectangle AOIs, and applies integer stride downsampling above 512 px.
- **Georeferenced Vector & Raster Overlays:** Polygonizes detected change masks using `affine` + `rasterio.features.shapes`, reprojects polygons to EPSG:4326 GeoJSON with per-polygon `confidence_score` and `area_km2`, and renders aligned RGBA overlays (`before.png`, `after.png`, `difference.png`) with an interactive Before/After opacity swipe viewer.
- **SAR Processing Controls:** Optional `boxcar` / `lee` adaptive speckle filtering, fixed dB or automated Otsu histogram thresholding, `HH` / `HV` / `VV` / `HH/HV` ratio support, L2 `GUNW` unwrapped-phase LOS displacement (`coherence >= 0.35`), and explicit status reporting for auxiliary water/DEM masks.
- **Multi-Date Time Series & Event Feeds:** Live USGS Earthquakes + NASA EONET v3 hazard overlays with NISAR granule matching, SQLite-backed backscatter time series (`/timeseries`), and an APScheduler watchlist daemon with deduplicated alerts and optional SMTP email notifications.
- **Server-Side Persistence & Exports:** SQLite (`jobs`, `job_results`, `aois`, `timeseries_*`, `watchlist`, `alerts`) with TTLCache caching, SSE live job streaming, GeoTIFF (LZW), GeoJSON, CSV, and printable PDF reports.

## Architecture

```text
terrapulse/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app, lifespan, CORS, slowapi rate limiting
│   │   ├── db.py                # SQLAlchemy ORM (jobs, AOIs, timeseries, watchlist, alerts)
│   │   ├── schemas.py           # Pydantic v2 request/response contracts
│   │   ├── routers/             # health, datasets, observations, analysis, jobs, aois, events, timeseries, watchlist
│   │   ├── services/            # nisar_provider, flood_analysis, job_runner, hazards, event_feeds,
│   │   │                        # timeseries, alerts_worker, renders, masks, export_report, sample_data, cache
│   │   └── tests/               # Pytest + FastAPI TestClient suites
│   ├── Dockerfile
│   ├── pyproject.toml           # Ruff, Black, Pytest configuration
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── api/                 # Typed fetch clients (VITE_API_BASE)
│   │   ├── components/          # Layout, MapBase, ResultMapOverlay, AoiDrawControl, GlobeHero, AnalysisResult
│   │   ├── pages/               # Dashboard, ExploreMap, ChangeAnalysis, ResultDetail, CompareJobs,
│   │   │                        # TimeSeries, Events, Catalog, Reports, Alerts, Settings, Methodology
│   │   ├── store/               # Zustand persisted units, threshold & dark/light theme preferences
│   │   ├── hooks/               # useJobs, useJobPolling (SSE + React Query fallback)
│   │   └── utils/               # Severity classification, formatters (km2/ha, dB/linear), geo helpers
│   ├── e2e/                     # Playwright mocked-API smoke spec
│   ├── Dockerfile
│   ├── nginx.conf
│   └── vitest.config.ts
├── docker-compose.yml
├── .pre-commit-config.yaml
└── .github/workflows/ci.yml
```

## Quick Start (Local Development)

### Prerequisites

- Python 3.12+
- Node.js 20+ and npm

### 1. Backend Setup

```powershell
cd terrapulse\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
# Add NASA_EARTHDATA_USERNAME and NASA_EARTHDATA_PASSWORD inside backend/.env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Interactive OpenAPI docs run at `http://localhost:8000/docs`.

### 2. Frontend Setup

```powershell
cd terrapulse\frontend
npm install
Copy-Item .env.example .env   # defaults VITE_API_BASE=http://localhost:8000/api/v1
npm run dev
```

Open `http://localhost:5173`.

## Docker Deployment

```bash
cd terrapulse
# Ensure backend/.env contains NASA_EARTHDATA_USERNAME and NASA_EARTHDATA_PASSWORD
docker compose up --build -d
```

- Frontend (Nginx SPA + `/api` reverse proxy with SSE unbuffering): `http://localhost:8080`
- Backend API: `http://localhost:8000`
- Persistent SQLite DB & job PNG artifacts stored in named volume `terrapulse_data:/app/data`.

### Managed Cloud Hosting

- **Frontend (Static/SPA):** Vercel or Netlify (`npm run build` -> `frontend/dist/`, set `VITE_API_BASE=https://your-api-host/api/v1`).
- **Backend (Container):** Render, Railway, or Fly.io using `terrapulse/backend/Dockerfile` with `NASA_EARTHDATA_USERNAME`, `NASA_EARTHDATA_PASSWORD`, `CORS_ORIGINS=https://your-frontend-domain`, and a mounted volume at `/app/data`.

## Key API Endpoints (`/api/v1`)

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/health` | Health check |
| `GET` | `/api/v1/auth/status` | Earthdata authentication status |
| `GET` | `/api/v1/datasets` / `/datasets/discover` | Catalog metadata & live CMR NISAR product discovery |
| `GET` | `/api/v1/observations/availability` | Check NISAR granule availability for point/dates |
| `POST` | `/api/v1/analysis/hazard` | Launch background SAR/InSAR change job |
| `GET` | `/api/v1/analysis/sample` | Precomputed real-geometry sample analysis |
| `GET` | `/api/v1/analysis/jobs` | List persisted jobs |
| `GET` | `/api/v1/analysis/jobs/{id}/stream` | Server-Sent Events progress stream |
| `GET` | `/api/v1/analysis/jobs/{id}/image/{kind}` | Georeferenced PNG overlay (`before.png`, `after.png`, `difference.png`) |
| `GET` | `/api/v1/analysis/jobs/{id}/export` | Export `geojson`, `tif`, `csv`, or `pdf` |
| `GET/POST/DELETE` | `/api/v1/aois` | Saved polygon/rectangle AOIs |
| `GET` | `/api/v1/events/live` & `/events/match-nisar` | Live USGS + NASA EONET events & NISAR pass matcher |
| `POST/GET` | `/api/v1/timeseries` | Multi-date backscatter trajectory jobs |
| `GET/POST/DELETE` | `/api/v1/watchlist` & `/watchlist/check-now` & `/alerts` | Watchlist monitoring, SMTP trigger, alert history |

## Scientific Honesty & Methodology

- **Confidence score (0.05–0.98):** weighted combination of signal-to-threshold ratio, cluster pixel count, orbit match (`same_orbit`), valid pixel fraction, and temporal separation penalty (`> 48` days).
- **Severity tiers:**
  - `High`: `affected_area >= 2.0 km²` and `confidence >= 0.65` (or `>= 10.0 km²` and `confidence >= 0.45`)
  - `Medium`: `affected_area >= 0.25 km²` and `confidence >= 0.45`
  - `Low`: smaller footprints or low confidence
- **Credentials & Security:** NASA Earthdata and optional SMTP credentials stay strictly in `backend/.env` (git-ignored) and are never sent to the browser. Analysis concurrency is capped by `MAX_CONCURRENT_JOBS`, requests are rate-limited (`slowapi`), and expired jobs are pruned via `JOB_TTL_DAYS`.

## Testing & Verification

```powershell
# Backend tests + coverage gate (>= 80% on app/services)
cd terrapulse\backend
.\.venv\Scripts\python.exe -m pytest app/tests -v --cov=app.services --cov-report=term-missing
.\.venv\Scripts\ruff.exe check app
.\.venv\Scripts\black.exe --check app

# Frontend lint, unit tests, and production build
cd ..\frontend
npm run lint
npm run test
npm run build
```
