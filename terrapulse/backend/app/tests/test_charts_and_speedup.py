"""Tests for comparison charts, 180-day point-insights passes, and HDF5 adapter streaming."""

from datetime import datetime, timedelta
from unittest.mock import patch

from fastapi.testclient import TestClient
import h5py
import numpy as np
import pytest

from app import db
from app.main import app
from app.services import cache as cache_svc, job_runner
from app.services.job_runner import (
    _build_date_differences,
    compute_comparison_charts,
    pick_before_to_latest_pair,
)
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
            assert s_resp.json().get("status") == "not_found"
            assert "is_sample" not in s_resp.json()


def test_before_to_latest_pair_and_date_differences():
    before_candidates = [
        {
            "id": "G_B1",
            "title": "NISAR_B1",
            "acquisition_date": "2026-08-11T12:30:00Z",
            "orbit_direction": "descending",
            "bounding_box": [92.0, 25.5, 93.8, 27.0],
        },
        {
            "id": "G_B2",
            "title": "NISAR_B2",
            "acquisition_date": "2026-08-15T12:30:00Z",
            "orbit_direction": "ascending",
            "bounding_box": [92.0, 25.5, 93.8, 27.0],
        },
    ]
    recent_candidates = [
        {
            "id": "G_OLDER",
            "title": "NISAR_OCT06",
            "acquisition_date": "2026-10-06T12:30:00Z",
            "orbit_direction": "descending",
            "bounding_box": [92.0, 25.5, 93.8, 27.0],
        },
        {
            "id": "G_NEWEST",
            "title": "NISAR_OCT18",
            "acquisition_date": "2026-10-18T12:30:00Z",
            "orbit_direction": "descending",
            "bounding_box": [92.0, 25.5, 93.8, 27.0],
        },
    ]

    before_dt = datetime(2026, 8, 10)
    picked, info = pick_before_to_latest_pair(
        before_candidates, recent_candidates, before_dt, lat=26.2, lon=92.9
    )
    assert picked is not None
    bg, ag = picked
    assert bg["id"] == "G_B1"
    assert ag["id"] == "G_NEWEST"
    assert info["after_latest"] is True
    assert info["same_orbit"] is True

    dd = _build_date_differences("2026-08-10", "latest (auto)", bg, ag, after_latest=True)
    assert dd["requested_before"] == "2026-08-10"
    assert dd["actual_before"] == "2026-08-11"
    assert dd["before_diff_days"] == 1
    assert dd["before_differs"] is True
    assert dd["requested_after"] == "latest (auto)"
    assert dd["actual_after"] == "2026-10-18"
    assert dd["after_is_latest"] is True
    assert "+1d" in (dd["note"] or "")


def test_hazard_before_with_latest_after_api_and_runner(tmp_path, monkeypatch):
    monkeypatch.setenv("TERRAPULSE_DB_PATH", str(tmp_path / "latest_flow.db"))
    monkeypatch.setenv("DISABLE_SCHEDULER", "1")
    monkeypatch.setattr(job_runner, "_JOB_SEMAPHORE", None)
    db.init_db()
    cache_svc.search_cache.clear()
    cache_svc.window_cache.clear()

    # After-only without before must fail 400; before-only & before+latest must both succeed 202
    with TestClient(app) as client:
        bad = client.post(
            "/api/v1/analysis/hazard",
            params={"hazard": "flood", "lat": 26.2, "lon": 92.9, "after_date": "2026-10-18"},
        )
        assert bad.status_code == 400

        with patch("fastapi.BackgroundTasks.add_task"):
            r_omitted = client.post(
                "/api/v1/analysis/hazard",
                params={"hazard": "flood", "lat": 26.2, "lon": 92.9, "before_date": "2026-08-10"},
            )
            assert r_omitted.status_code == 202
            j1 = db.get_job(r_omitted.json()["job_id"])
            assert j1["params"]["before_date"] == "2026-08-10"
            assert j1["params"]["after_date"] == "latest"

            r_explicit_latest = client.post(
                "/api/v1/analysis/hazard",
                params={
                    "hazard": "flood",
                    "lat": 26.2,
                    "lon": 92.9,
                    "before_date": "2026-08-10",
                    "after_date": "latest",
                },
            )
            assert r_explicit_latest.status_code == 202
            j2 = db.get_job(r_explicit_latest.json()["job_id"])
            assert j2["params"]["before_date"] == "2026-08-10"
            assert j2["params"]["after_date"] == "latest"

    # Also verify runner in before_to_latest mode widens +-6d -> +-12d if needed
    searched_windows = []

    def fake_search(_prov, _sn, date_win, _bbox, count=20):
        searched_windows.append((date_win, count))
        start_s, end_s = date_win
        if count == 60:
            return [
                {
                    "id": "G_LATEST",
                    "title": "NISAR_OCT18",
                    "acquisition_date": "2026-10-18T12:33:47Z",
                    "orbit_direction": "descending",
                    "bounding_box": [92.0, 25.5, 93.8, 27.0],
                    "https_link": "https://x/latest.h5",
                }
            ]
        # Empty on initial +-6d (2026-08-04..2026-08-16), populated when widened to +-12d
        if start_s <= "2026-07-30" and end_s >= "2026-08-21":
            return [
                {
                    "id": "G_BEFORE_WIDENED",
                    "title": "NISAR_AUG19",
                    "acquisition_date": "2026-08-19T12:30:00Z",
                    "orbit_direction": "descending",
                    "bounding_box": [92.0, 25.5, 93.8, 27.0],
                    "https_link": "https://x/before.h5",
                }
            ]
        return []

    def fake_window(_prov, granule, _band, _req_win, _lat, _lon, _aoi_bbox):
        xs = np.linspace(480000.0, 480000.0 + 31 * 20.0, 32)
        ys = np.linspace(2900000.0, 2900000.0 - 31 * 20.0, 32)
        val = 0.25 if granule["id"] == "G_BEFORE_WIDENED" else 0.05
        arr = np.full((32, 32), val, dtype=np.float32)
        return {
            "values": arr,
            "variable": "HH",
            "crs": "EPSG:32646",
            "epsg": 32646,
            "x_coords": xs,
            "y_coords": ys,
            "spacing_m": [20.0, 20.0],
            "window_origin": [0, 0],
            "shape": (32, 32),
            "stride": 1,
            "downsampled": False,
        }

    job_id = "before_latest_job"
    job_params = {
        "hazard": "flood",
        "before_date": "2026-08-10",
        "after_date": "latest",
        "lat": 26.2,
        "lon": 92.9,
        "band": "HH",
        "window": 64,
        "speckle_filter": "none",
        "threshold_mode": "fixed",
    }
    db.create_job(job_id, job_params)
    with (
        patch("app.services.job_runner.cache.get_provider") as m_prov,
        patch("app.services.job_runner.cache.cached_search", side_effect=fake_search),
        patch("app.services.job_runner.cache.cached_window", side_effect=fake_window),
    ):
        m_prov.return_value.is_authenticated.return_value = True
        job_runner.run_analysis_job(job_id, job_params)

    done = db.get_job(job_id)
    assert done["status"] == "complete"
    res = done["result"]
    assert "is_sample" not in res
    assert res["requested_dates"] == {"before": "2026-08-10", "after": "latest (auto)"}
    assert res["actual_granule_dates"]["before"].startswith("2026-08-19")
    assert res["actual_granule_dates"]["after"].startswith("2026-10-18")
    assert res["date_differences"]["before_diff_days"] == 9
    assert res["date_differences"]["after_is_latest"] is True
    assert any(w[0][0] <= "2026-07-30" for w in searched_windows)
