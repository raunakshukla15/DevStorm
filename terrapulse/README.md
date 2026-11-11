# TerraPulse — Earth Surface Intelligence

**Tagline:** "Observe Earth. Understand Change."

A professional web platform for NASA-ISRO NISAR satellite remote sensing data analysis,
designed to detect, monitor, and visualize changes occurring on Earth's surface.

## ⚠️ Important Notice

This is an independent educational hackathon project. **No official NASA or ISRO endorsement**
is implied or claimed. All scientific analyses are provided with appropriate caveats and
limitations as documented.

## 🎯 Objective

TerraPulse uses synthetic aperture radar (SAR) data from the NISAR mission to help
users understand Earth surface changes that are difficult to observe with ordinary
satellite imagery, including:

- **Flooding and wetland changes** — backscatter difference analysis
- **Ground deformation** — InSAR potential (metadata displayed)
- **Forest disturbance** — backscatter change indicators
- **Agricultural monitoring** — backscatter time series
- **Glacier movement** — observation availability
- **Land subsidence** — deformation monitoring metadata

## 🏗️ Architecture

```
terrapulse/
├── frontend/           # React + Vite + TypeScript + Tailwind CSS
│   ├── src/components/  # Reusable UI components
│   ├── src/pages/      # Page components
│   ├── src/services/   # API service integrations
│   ├── src/hooks/      # Custom React hooks
│   ├── src/types/      # TypeScript type definitions
│   ├── src/utils/      # Utility functions
│   └── public/         # Static assets
├── backend/            # FastAPI + Python geospatial stack
│   ├── app/            # Application source
│   │   ├── main.py     # FastAPI entry point
│   │   ├── api/v1/     # Versioned API endpoints
│   │   └── services/   # Data processing pipelines
│   ├── requirements.txt  # Python dependencies
│   └── .env.example    # Environment configuration
├── docs/               # Documentation files
├── README.md           # This file
└── .gitignore
```

## 🚀 Quick Start

### Prerequisites

- Node.js v20+ (verified: v24.19.0)
- Python 3.12+ (verified: Python 3.14.7)
- npm v11+ (verified: 11.17.0)
- Git v2.55+

### 1. Install Dependencies

**Frontend:**
```powershell
cd C:\Users\rauna\OneDrive\Desktop\Project\terrapulse\frontend
npm install
```

**Backend:**
```powershell
cd C:\Users\rauna\OneDrive\Desktop\Project\terrapulse\backend
pip install -r requirements.txt
```

### 2. Configure Environment

Copy the `.env.example` file and configure your NASA Earthdata credentials:

```powershell
copy C:\Users\rauna\OneDrive\Desktop\Project\terrapulse\backend\.env.example
C:\Users\rauna\OneDrive\Desktop\Project\terrapulse\backend\.env
```

Edit `.env` with your Earthdata Login credentials:
```
NASA_EARTHDATA_USERNAME=your_urs_username
NASA_EARTHDATA_PASSWORD=your_urs_password
```

**Note:** NISAR data access requires NASA Earthdata Login (EDL) credentials.
Register for free at: https://urs.earthdata.nasa.gov/

### 3. Start the Applications

**Backend (FastAPI):**
```powershell
cd C:\Users\rauna\OneDrive\Desktop\Project\terrapulse\backend
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The backend will start at http://localhost:8000

**Frontend (React):**
```powershell
cd C:\Users\rauna\OneDrive\Desktop\Project\terrapulse\frontend
npm run dev
```

The frontend will start at http://localhost:5173

## 🔌 API Endpoints

The backend provides a documented REST API via FastAPI's OpenInterface at
`http://localhost:8000/docs`

### Key Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/regions` | Available monitoring regions |
| `GET` | `/api/datasets` | Available NISAR datasets |
| `GET` | `/api/datasets/{id}` | Dataset details |
| `GET` | `/api/observations` | Available observations |
| `GET` | `/api/observations/availability` | Check data availability |
| `POST` | `/api/analysis/change-detection` | Run flood detection analysis |
| `GET` | `/api/timeline` | Observation timeline |
| `GET` | `/api/metadata` | System metadata |

### Change Detection API

```http
POST /api/analysis/change-detection
Content-Type: application/x-www-form-urlencoded

before_date=2024-01-15&after_date=2024-01-27&lat=-1.5&lon=-52.0&dataset_id=NISAR_L1B_RSLC&band=HH
```

**Response includes:**
- Compatibility validation results
- Backscatter difference statistics
- GeoJSON flood outlines (indicator only)
- GeoTIFF export (preserved georeferencing)
- Full caveats and limitations documentation

## 🛰️ NISAR Data Access

TerraPulse accesses NISAR data through NASA Earthdata services:

### Authentication

- **Required:** Earthdata Login (EDL) account
- **Free registration:** https://urs.earthdata.nasa.gov/
- **Configuration:** Set `NASA_EARTHDATA_USERNAME` and `NASA_EARTHDATA_PASSWORD` in `.env`

### Access Methods

1. **HTTPS (recommended, works everywhere):**
   - via `earthaccess` Python package
   - Authenticated fsspec sessions
   - Works from any location

2. **Direct S3 Access (us-west-2 only):**
   - Temporary AWS credentials from `https://nisar.asf.earthdatacloud.nasa.gov/s3credentials`
   - Requires execution in AWS us-west-2 region
   - Faster for large data volumes

### Supported Products

- `NISAR_L1B_RSLC` — Level-1b Range-Doppler Single Look Complex
- `NISAR_L2_GCOV` — Level-2 Geocoded Polarimetric Covariance

### Data Characteristics

- **Frequency:** L-band (1.25 GHz)
- **Spatial resolution:** ~30 m
- **Polarizations:** HH, HV, VV
- **Swath width:** 240 km
- **Revisit time:** 12 days (day/night coverage)
- **Orbit:** Sun-synchronous, descending/ascending

## 🔬 Scientific Methodology

### Flood Monitoring (Backscatter Difference)

The primary analysis method compares calibrated backscatter (σ⁰) between two NISAR
acquisitions:

1. **Input:** Two SAR acquisitions (before and after event) at same location
2. **Preprocessing:** Calibrated sigma-nought values, nodata masking
3. **Analysis:** `difference = after_backscatter - before_backscatter`
4. **Interpretation:**
   - **Negative differences** (after < before) indicate decreased backscatter
   - Potential flooding: water surfaces act as specular reflectors, reducing backscatter
   - **Important:** Also affected by vegetation change, soil moisture, terrain

5. **Limitations clearly documented:**
   - Not a validated flood map — change indicator only
   - Requires field validation
   - Dense vegetation may mask flooding signal
   - Single-pair comparison cannot distinguish flooding from other changes
   - Speckle noise inherent in SAR imagery

### Compatibility Checks

Before any analysis, observations are validated for:
- Polarization match (HH vs VV vs HV)
- Orbit direction consistency (descending/ascending)
- Sufficient temporal separation
- Spatial overlap and georeferencing

## 📦 Project Structure (as Required)

The project maintains clear separation of responsibilities:

- **Frontend:** React components, maps, UI, user interactions
- **Backend:** FastAPI, data processing, scientific analysis
- **Data Access:** `earthaccess` + `rasterio` + `xarray` for NISAR
- **Processing:** Geospatial preprocessing, change detection, quality checks
- **Tests:** Automated unit tests with mocked network responses

## 📋 Development Workflow

### Phase 1: Environment & Feasibility ✅
- Verified NISAR data access via NASA Earthdata
- Confirmed `earthaccess` Python package works
- Selected flood monitoring as first use case

### Phase 2: Project Foundation ✅
- React + Vite + TypeScript + Tailwind CSS configured
- FastAPI backend with CORS and health checks
- Project directory structure created

### Phase 3: Frontend ✅
- Navigation and page layouts implemented
- Interactive map with Zoom/Pan/Search
- Change detection page with date selectors
- Dataset explorer and metadata panels

### Phase 4: Backend & Data ✅
- NISAR data provider abstraction
- Earthdata authentication handling
- Metadata search and observation discovery
- Availability checking

### Phase 5: Scientific Processing ✅
- Backscatter difference calculation
- Observation compatibility validation
- GeoTIFF and GeoJSON export
- Quality checks and caveats

### Phase 6: Integration & Testing ✅
- All components connected
- 10 automated tests passing
- Backend and frontend both start successfully

### Phase 7: Finalization (In Progress)
- Documentation and README
- Deployment configuration
- Screenshot preparation

## 🧪 Testing

All automated tests pass:

```powershell
cd C:\Users\rauna\OneDrive\Desktop\Project\terrapulse\backend
python -m pytest app/tests/ -v
```

**Results:** 10/10 tests passing

Tests cover:
- Backscatter difference calculation
- Observation compatibility validation
- GeoTIFF export
- GeoJSON export
- Edge cases (nodata, incompatible observations)

## 🚢 Deployment

### Recommended Options

- **Frontend:** Vercel or Netlify (`npm run build` produces production artifacts)
- **Backend:** Any Python-compatible hosting (Render, Railway, Heroku)
- **Environment variables:** Documented in `.env.example`

### Production Build

```powershell
# Frontend production build
cd C:\Users\rauna\OneDrive\Desktop\Project\terrapulse\frontend
npm run build

# Output: frontend/dist/ (servable by any static file server)
```

### CORS Configuration

For production, update `backend/app/main.py` to restrict `allow_origins`
to your frontend domain instead of `["*"]`.

## 📄 License

This project is licensed under the MIT License — see the `LICENSE` file
for details. NASA/ISRO data accessed through Earthdata Login subject to
NASA Terms of Use.

## 📧 Contact

Project built for NASA-ISRO NISAR hackathon demonstration.
Questions and feedback welcome via the project repository.