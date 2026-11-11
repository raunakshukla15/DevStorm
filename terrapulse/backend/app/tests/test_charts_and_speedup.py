"""Tests for comparison charts, 180-day point-insights passes, and HDF5 adapter streaming."""

from datetime import datetime, timedelta
from unittest.mock import patch

from fastapi.testclient import TestClient
import h5py
import numpy as np
import pytest

from app.main import app
from app.services.job_runner import compute_comparison_charts
from app.services.nisar_provider import _H5DatasetAdapter


def test_compute_comparison_charts_stats_and_bins():
    rng = np.random.default_rng(7)
    before = rng.normal(-9.0, 1.2, size=(64, 64))
    after = before.copy()
    after[10:40, 10:40] -= 4.0  # flood drop zone
    diff = after - before

    out = compute_comparison_charts(before, after, diff, spacing_m=[20.0, 20.0], threshold_db=-2.0)
    comp = out["comparison"]
    assert comp is not None
    assert comp["before_mean_db"] == pytest.approx(float(np.mean(before)), abs=0.01)
    assert comp["after_mean_db"] < comp["before_mean_db"]
    assert comp["delta_mean_db"] < -0.5

    bs_sum = sum(b["before_pct"] for b in out["backscatter_histogram"])
    af_sum = sum(b["after_pct"] for b in out["backscatter_histogram"])
    assert 98.0 <= bs_sum <= 102.0
    assert 98.0 <= af_sum <= 102.0

    bd_sum = sum(c["pct"] for c in out["condition_breakdown"])
    assert 99.0 <= bd_sum <= 101.0
    strong_drop = next(c for c in out["condition_breakdown"] if c["key"] == "strong_drop")
    assert strong_drop["pct"] > 15.0
    assert len(out["transect"]) > 10


def test_h5_dataset_adapter_supports_gcov_slicing(tmp_path):
    h5_path = tmp_path / "mock_gcov.h5"
    rows, cols = 48, 48
    x_coords = np.linspace(393000.0, 393000.0 + (cols - 1) * 20.0, cols)
    y_coords = np.linspace(9830000.0, 9830000.0 - (rows - 1) * 20.0, rows)
    hhhh = np.full((rows, cols), 0.12, dtype=np.float32)

    with h5py.File(h5_path, "w") as f:
        grp = f.create_group("/science/LSAR/GCOV/grids/frequencyA")
        grp.create_dataset("HHHH", data=hhhh)
        grp.create_dataset("xCoordinates", data=x_coords)
        grp.create_dataset("yCoordinates", data=y_coords)
        proj = grp.create_dataset("projection", data=np.uint32(32722))
        proj.attrs["epsg_code"] = np.int64(32722)
        grp.create_dataset("xCoordinateSpacing", data=np.float64(20.0))
        grp.create_dataset("yCoordinateSpacing", data=np.float64(-20.0))

    raw = open(h5_path, "rb")
    h5 = h5py.File(raw, "r")
    adapter = _H5DatasetAdapter(h5, raw, "/science/LSAR/GCOV/grids/frequencyA")
    try:
        assert "HHHH" in adapter
        assert "xCoordinates" in adapter
        assert "HHHH" in adapter.data_vars
        assert int(adapter["projection"].attrs["epsg_code"]) == 32722
        sub = adapter["HHHH"].isel({"y": slice(4, 20, 2), "x": slice(2, 18, 2)}).values
        assert sub.shape == (8, 8)
        assert float(sub[0, 0]) == pytest.approx(0.12)
    finally:
        adapter.close()


def test_point_insights_returns_180d_passes_and_sample_has_charts():
    old_95d = (datetime.now() - timedelta(days=95)).strftime("%Y-%m-%dT12:00:00Z")
    recent_5d = (datetime.now() - timedelta(days=5)).strftime("%Y-%m-%dT12:00:00Z")
    mock_granules = [
        {
            "id": "G_NEW",
            "title": "NISAR_L2_PR_GCOV_NEW",
            "short_name": "NISAR_L2_GCOV_PROVISIONAL_V1",
            "acquisition_date": recent_5d,
            "orbit_direction": "descending",
            "bounding_box": [92.0, 25.5, 93.8, 27.0],
        },
        {
            "id": "G_OLD",
            "title": "NISAR_L2_PR_GCOV_OLD",
            "short_name": "NISAR_L2_GCOV_PROVISIONAL_V1",
            "acquisition_date": old_95d,
            "orbit_direction": "descending",
            "bounding_box": [92.0, 25.5, 93.8, 27.0],
        },
    ]

    with patch("app.routers.analysis.cache.get_provider") as m_get_prov:
        prov = m_get_prov.return_value
        prov.is_authenticated.return_value = True
        with patch("app.routers.analysis.cache.cached_search", return_value=mock_granules):
            client = TestClient(app)
            resp = client.get("/api/v1/analysis/point-insights?lat=26.2&lon=92.9")
            assert resp.status_code == 200
            data = resp.json()
            assert data["available"] is True
            assert data["granules_last_90d"] == 1
            assert data["granules_last_180d"] == 2
            assert data["earliest_acquisition"] == old_95d[:10]
            assert data["latest_acquisition"] == recent_5d[:10]
            assert len(data["available_passes"]) == 2
            assert isinstance(data["query_elapsed_ms"], int)

            s_resp = client.get("/api/v1/analysis/sample")
            assert s_resp.status_code == 200
            s_data = s_resp.json()
            assert s_data["is_sample"] is True
            assert s_data["comparison"] is not None
            assert len(s_data["backscatter_histogram"]) > 0
            assert len(s_data["condition_breakdown"]) == 5
            assert len(s_data["transect"]) > 5

