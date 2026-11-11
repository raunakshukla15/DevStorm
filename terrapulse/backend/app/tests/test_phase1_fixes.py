"""Tests for Phase 1 correctness, persistence, routing, and config fixes."""

from pathlib import Path
import sys
from unittest.mock import MagicMock

from fastapi.testclient import TestClient
import numpy as np
from pyproj import Transformer
import pytest
import xarray as xr

# Allow importing app.* whether pytest is launched from backend/ or repo root
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app import db
from app.main import app
from app.routers import observations as observations_router
from app.services import cache as cache_svc
from app.services.flood_analysis import export_geojson
from app.services.nisar_provider import MAX_WINDOW_PIXELS, NISARDataProvider


def _make_mock_gcov_dataset(epsg: int = 32722, rows: int = 40, cols: int = 50) -> xr.Dataset:
    """Create an xarray Dataset matching real NISAR L2 GCOV structure."""
    x_coords = np.linspace(200000.0, 200000.0 + (cols - 1) * 20.0, cols)
    # NISAR yCoordinates are descending (north -> south) with negative yCoordinateSpacing
    y_coords = np.linspace(9800000.0, 9800000.0 - (rows - 1) * 20.0, rows)
    r_idx, c_idx = np.meshgrid(np.arange(rows), np.arange(cols), indexing="ij")
    hhhh = (r_idx * 100 + c_idx + 1).astype(np.float32)

    proj = xr.DataArray(np.uint32(epsg), attrs={"epsg_code": np.int64(epsg)})
    ds = xr.Dataset(
        {
            "HHHH": (["y", "x"], hhhh),
            "xCoordinateSpacing": np.float64(20.0),
            "yCoordinateSpacing": np.float64(-20.0),
            "projection": proj,
        },
        coords={"xCoordinates": ("x", x_coords), "yCoordinates": ("y", y_coords)},
    )
    return ds


class _CtxDataset:
    def __init__(self, ds: xr.Dataset):
        self._ds = ds

    def __enter__(self) -> xr.Dataset:
        return self._ds

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


def test_stream_window_uses_user_coordinates_and_clamps():
    provider = NISARDataProvider()
    provider._auth = True
    ds = _make_mock_gcov_dataset(epsg=32722, rows=40, cols=50)
    provider._open_gcov_grid = lambda _url: _CtxDataset(ds)  # type: ignore[method-assign]

    to_wgs = Transformer.from_crs("EPSG:32722", "EPSG:4326", always_xy=True)
    x_arr = ds["xCoordinates"].values
    y_arr = ds["yCoordinates"].values

    # Top-left corner point -> should clamp origin to (0, 0)
    tl_lon, tl_lat = to_wgs.transform(float(x_arr[1]), float(y_arr[1]))
    win_tl = provider.stream_backscatter_window(
        "https://example.com/granule.h5", band="HH", window=10, lat=tl_lat, lon=tl_lon
    )
    assert win_tl["window_origin"] == [0, 0]
    assert win_tl["values"].shape == (10, 10)
    assert win_tl["epsg"] == 32722
    assert win_tl["crs"] == "EPSG:32722"
    assert win_tl["spacing_m"] == [20.0, 20.0]
    assert win_tl["values"][0, 0] == pytest.approx(1.0)

    # Bottom-right corner point -> should clamp origin to (30, 40)
    br_lon, br_lat = to_wgs.transform(float(x_arr[-2]), float(y_arr[-2]))
    win_br = provider.stream_backscatter_window(
        "https://example.com/granule.h5", band="HH", window=10, lat=br_lat, lon=br_lon
    )
    assert win_br["window_origin"] == [30, 40]
    assert win_br["values"].shape == (10, 10)
    assert win_br["values"][0, 0] == pytest.approx(30 * 100 + 40 + 1)
    assert len(win_br["x_coords"]) == 10
    assert len(win_br["y_coords"]) == 10


def test_stream_window_rejects_point_outside_footprint():
    provider = NISARDataProvider()
    provider._auth = True
    ds = _make_mock_gcov_dataset(epsg=32722, rows=40, cols=50)
    provider._open_gcov_grid = lambda _url: _CtxDataset(ds)  # type: ignore[method-assign]

    with pytest.raises(ValueError, match="outside granule footprint"):
        provider.stream_backscatter_window(
            "https://example.com/granule.h5", band="HH", window=10, lat=45.0, lon=10.0
        )


def test_export_geojson_outputs_wgs84_polygons_and_filters_specks():
    cols, rows = 20, 20
    x_coords = np.linspace(200000.0, 200000.0 + (cols - 1) * 20.0, cols)
    y_coords = np.linspace(9800000.0, 9800000.0 - (rows - 1) * 20.0, rows)
    diff = np.zeros((rows, cols), dtype=np.float64)
    # 4x4 flooded patch (16 pixels -> should remain)
    diff[2:6, 3:7] = -5.0
    # 2-pixel speck (below min_pixels=4 -> should be filtered out)
    diff[15, 15:17] = -6.0

    fc = export_geojson(
        difference_mask=diff,
        crs="EPSG:32722",
        threshold=-2.0,
        x_coords=x_coords,
        y_coords=y_coords,
        spacing_m=[20.0, 20.0],
        min_pixels=4,
    )
    assert fc["type"] == "FeatureCollection"
    assert len(fc["features"]) == 1
    feat = fc["features"][0]
    assert feat["geometry"]["type"] in ("Polygon", "MultiPolygon")
    props = feat["properties"]
    assert props["pixel_count"] == 16
    assert props["area_km2"] == pytest.approx(16 * 20.0 * 20.0 / 1e6)
    assert props["mean_difference_db"] == pytest.approx(-5.0)
    assert props["min_difference_db"] == pytest.approx(-5.0)

    ring = feat["geometry"]["coordinates"][0]
    # Reprojected UTM Zone 22S (x=200km, y=9800km) -> WGS84 lon~ -53.7, lat~ -1.8
    for pt in ring:
        lon, lat = pt[0], pt[1]
        assert -60.0 < lon < -45.0
        assert -5.0 < lat < 0.0


def test_observations_route_order(monkeypatch):
    fake_provider = MagicMock()
    fake_provider.is_authenticated.return_value = True
    fake_provider.check_availability.return_value = {"available": False, "datasets": []}
    monkeypatch.setattr(cache_svc, "get_provider", lambda: fake_provider)

    client = TestClient(app)
    avail = client.get(
        "/api/v1/observations/availability",
        params={"lat": 10.0, "lon": 105.0, "start_date": "2026-01-01", "end_date": "2026-02-01"},
    )
    assert avail.status_code == 200
    assert "available" in avail.json()
    assert avail.json()["available"] is False

    single = client.get("/api/v1/observations/G123456-ASF")
    assert single.status_code == 200
    assert single.json()["id"] == "G123456-ASF"
    assert "note" in single.json()


def test_sqlite_job_persistence_and_ttl_caches(tmp_path):
    db_file = str(tmp_path / "test_jobs.db")
    db.init_db(db_file)
    db.create_job("abc123", {"hazard": "flood", "lat": -1.5, "lon": -52.0, "window": 256})
    db.update_job("abc123", stage="computing backscatter difference", progress=85)
    db.save_job_result("abc123", {"status": "analyzed", "analysis": {"valid_pixels": 100}})

    # Simulate restart by disposing & reopening database from the same file
    db.init_db(str(tmp_path / "other.db"))
    db.init_db(db_file)

    loaded = db.get_job("abc123")
    assert loaded is not None
    assert loaded["status"] == "complete"
    assert loaded["progress"] == 100
    assert loaded["result"]["status"] == "analyzed"
    assert any(j["job_id"] == "abc123" for j in db.list_jobs(limit=10))

    # Bounded TTL caches
    assert hasattr(cache_svc.search_cache, "maxsize")
    assert hasattr(cache_svc.window_cache, "maxsize")
    assert cache_svc.search_cache.maxsize > 0
    assert cache_svc.window_cache.maxsize > 0


def test_window_validation_health_cors_and_geocode(tmp_path, monkeypatch):
    db.init_db(str(tmp_path / "api.db"))
    client = TestClient(app)

    health = client.get("/api/v1/health", headers={"Origin": "http://localhost:5173"})
    assert health.status_code == 200
    assert health.json()["status"] == "healthy"
    assert health.headers.get("access-control-allow-origin") == "http://localhost:5173"

    # OpenAPI schema exposes concrete Pydantic models
    schema = app.openapi()
    assert "JobSummaryOut" in schema.get("components", {}).get("schemas", {})
    assert "PointInsightsResponse" in schema.get("components", {}).get("schemas", {})

    # Window exceeding hard max should fail validation cleanly
    bad_win = client.post(
        "/api/v1/analysis/hazard",
        params={"hazard": "flood", "lat": -1.5, "lon": -52.0, "window": MAX_WINDOW_PIXELS + 128},
    )
    assert bad_win.status_code == 422

    # Geocode endpoint proxies Nominatim with User-Agent and caches responses
    calls = []

    class _FakeResp:
        def raise_for_status(self):
            return None

        def json(self):
            return [{"lat": "26.2006", "lon": "92.9376", "display_name": "Assam, India"}]

    class _FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            self.headers = kwargs.get("headers", {})

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, params=None):
            calls.append((url, params, self.headers))
            return _FakeResp()

    cache_svc.geocode_cache.clear()
    monkeypatch.setattr(observations_router.httpx, "AsyncClient", _FakeAsyncClient)

    r1 = client.get("/api/v1/geocode", params={"q": "Assam", "limit": 1})
    assert r1.status_code == 200
    assert r1.json()[0]["lat"] == "26.2006"
    assert len(calls) == 1
    assert "TerraPulse" in calls[0][2].get("User-Agent", "")

    # Second identical query should hit cache
    r2 = client.get("/api/v1/geocode", params={"q": "Assam", "limit": 1})
    assert r2.status_code == 200
    assert len(calls) == 1

