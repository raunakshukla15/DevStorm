"""Phase 3 tests: speckle/Otsu/HH-HV, AOI bbox+stride, renders/exports, feeds, timeseries, watchlist."""

from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
import numpy as np
import xarray as xr

from app import db
from app.main import app
from app.services import alerts_worker, renders, timeseries
from app.services.flood_analysis import (
    apply_speckle_filter,
    compute_otsu_threshold,
    compute_severity_area_confidence,
    export_geojson,
)
from app.services.nisar_provider import MAX_WINDOW_PIXELS, NISARDataProvider


def _fake_gcov_ds(rows=1024, cols=1024):
    rng = np.random.default_rng(7)
    x_coords = np.linspace(380000.0, 380000.0 + (cols - 1) * 20.0, cols)
    y_coords = np.linspace(9840000.0, 9840000.0 - (rows - 1) * 20.0, rows)
    hh = 0.04 + 0.005 * rng.random((rows, cols))
    hv = 0.01 + 0.001 * rng.random((rows, cols))
    ds = xr.Dataset(
        {
            "HHHH": (["y", "x"], hh),
            "HVHV": (["y", "x"], hv),
            "projection": xr.DataArray(np.uint32(32722), attrs={"epsg_code": 32722}),
            "xCoordinateSpacing": xr.DataArray(20.0),
            "yCoordinateSpacing": xr.DataArray(-20.0),
        },
        coords={"xCoordinates": (["x"], x_coords), "yCoordinates": (["y"], y_coords)},
    )
    return ds


def test_speckle_filter_and_otsu_threshold():
    rng = np.random.default_rng(42)
    base_db = np.zeros((64, 64), dtype=np.float64)
    base_db[32:, :] = -6.0
    noisy_db = base_db + rng.normal(0.0, 1.8, size=(64, 64))

    box = apply_speckle_filter(noisy_db, method="boxcar", size=5, is_db=True)
    lee = apply_speckle_filter(noisy_db, method="lee", size=5, is_db=True)

    # Homogeneous patch std must drop sharply after filtering
    assert np.std(box[:24, :24]) < np.std(noisy_db[:24, :24]) * 0.75
    assert np.std(lee[:24, :24]) < np.std(noisy_db[:24, :24]) * 0.75

    thr = compute_otsu_threshold(lee, direction="negative")
    assert -4.5 < thr < -1.5


def test_geojson_confidence_and_severity_rule():
    diff = np.full((32, 32), 0.1, dtype=np.float64)
    diff[5:20, 5:20] = -4.5
    x = np.linspace(500000.0, 500620.0, 32)
    y = np.linspace(1000620.0, 1000000.0, 32)
    gj = export_geojson(
        diff,
        crs="EPSG:32618",
        threshold=-2.0,
        x_coords=x,
        y_coords=y,
        spacing_m=[20.0, 20.0],
        min_pixels=4,
        same_orbit=True,
        temporal_days=12.0,
    )
    assert len(gj["features"]) == 1
    props = gj["features"][0]["properties"]
    assert 0.5 < props["confidence_score"] <= 1.0
    assert props["confidence_level"] in {"Medium", "High"}

    assert compute_severity_area_confidence(3.0, 0.75)[0] == "High"
    assert compute_severity_area_confidence(3.0, 0.30)[0] == "Low"
    assert compute_severity_area_confidence(0.5, 0.50)[0] == "Medium"


def test_aoi_bbox_stride_and_hh_hv_ratio():
    from pyproj import Transformer

    ds = _fake_gcov_ds(rows=1024, cols=1024)
    x_all = ds["xCoordinates"].values
    y_all = ds["yCoordinates"].values
    to_wgs = Transformer.from_crs("EPSG:32722", "EPSG:4326", always_xy=True)
    lons, lats = to_wgs.transform([x_all[50], x_all[900]], [y_all[900], y_all[50]])
    bbox = [min(lons), min(lats), max(lons), max(lats)]

    prov = NISARDataProvider()
    with patch.object(prov, "_open_gcov_grid", return_value=ds):
        res = prov.stream_backscatter_window(
            "https://example.org/test.h5",
            band="HH/HV",
            window=256,
            bbox=bbox,
        )

    assert res["variable"] == "HHHH/HVHV"
    assert res["downsampled"] is True
    assert res["stride"] >= 2
    assert res["values"].shape[0] <= MAX_WINDOW_PIXELS
    assert res["values"].shape[1] <= MAX_WINDOW_PIXELS
    assert abs(res["spacing_m"][0] - 20.0 * res["stride"]) < 1e-3
    assert np.all((res["values"] > 2.5) & (res["values"] < 6.0))


def test_renders_exports_and_sse(tmp_path, monkeypatch):
    monkeypatch.setenv("TERRAPULSE_DB_PATH", str(tmp_path / "exp.db"))
    monkeypatch.setenv("TERRAPULSE_JOBS_DIR", str(tmp_path / "jobs"))
    monkeypatch.setenv("DISABLE_SCHEDULER", "1")
    db.init_db()

    n = 32
    x = np.linspace(388000.0, 388000.0 + (n - 1) * 20.0, n)
    y = np.linspace(9835000.0, 9835000.0 - (n - 1) * 20.0, n)
    before_db = np.full((n, n), -10.0)
    after_db = np.full((n, n), -10.2)
    after_db[8:20, 8:20] = -15.0
    diff_db = after_db - before_db

    job_id = "jobphase3exp"
    db.create_job(job_id, {"hazard": "flood", "lat": -1.5, "lon": -52.0, "band": "HH"})
    imgs = renders.save_job_visuals(job_id, before_db, after_db, diff_db, x, y, "EPSG:32722")
    gj = export_geojson(
        diff_db, crs="EPSG:32722", threshold=-2.0, x_coords=x, y_coords=y, spacing_m=[20.0, 20.0]
    )
    db.save_job_result(
        job_id,
        {
            "success": True,
            "status": "analyzed",
            "hazard": "flood",
            "hazard_label": "Flood",
            "location": {"lat": -1.5, "lon": -52.0},
            "short_name": "NISAR_L2_GCOV_PROVISIONAL_V1",
            "images": imgs,
            "analysis": {"mean_backscatter_difference_db": -1.2, "affected_area_km2": 0.05},
            "confidence": {"score": 0.72, "level": "High"},
            "results": {"flood_outlines": gj},
            "caveats_and_limitations": ["Indicator only."],
        },
    )

    with TestClient(app) as client:
        png_res = client.get(f"/api/v1/analysis/jobs/{job_id}/image/difference.png")
        assert png_res.status_code == 200
        assert png_res.content[:4] == b"\x89PNG"

        tif_res = client.get(f"/api/v1/analysis/jobs/{job_id}/export?format=tif")
        assert tif_res.status_code == 200
        assert tif_res.content[:2] in {b"II", b"MM"}

        csv_res = client.get(f"/api/v1/analysis/jobs/{job_id}/export?format=csv")
        assert csv_res.status_code == 200
        assert "mean_difference_db" in csv_res.text

        pdf_res = client.get(f"/api/v1/analysis/jobs/{job_id}/export?format=pdf")
        assert pdf_res.status_code == 200
        assert pdf_res.content[:4] == b"%PDF"

        sse_res = client.get(f"/api/v1/analysis/jobs/{job_id}/stream")
        assert sse_res.status_code == 200
        assert "complete" in sse_res.text

        sample_res = client.get("/api/v1/analysis/sample")
        assert sample_res.json().get("status") == "not_found"
        assert "is_sample" not in sample_res.json()


def test_aoi_crud_and_events_live_mocked(tmp_path, monkeypatch):
    monkeypatch.setenv("TERRAPULSE_DB_PATH", str(tmp_path / "aoi.db"))
    monkeypatch.setenv("DISABLE_SCHEDULER", "1")
    db.init_db()

    usgs_mock = {
        "features": [
            {
                "id": "us100",
                "properties": {
                    "title": "M 5.4 - Offshore",
                    "mag": 5.4,
                    "time": 1760000000000,
                    "url": "https://usgs.gov",
                },
                "geometry": {"coordinates": [-72.1, -13.2, 10]},
            }
        ]
    }
    eonet_mock = {
        "events": [
            {
                "id": "EONET_1",
                "title": "Flood Event",
                "categories": [{"id": "floods", "title": "Floods"}],
                "geometry": [{"date": "2026-09-10T00:00:00Z", "coordinates": [105.0, 10.0]}],
            }
        ]
    }

    async def fake_get(self, url, *args, **kwargs):
        if "usgs" in str(url):
            return SimpleNamespace(
                status_code=200, json=lambda: usgs_mock, raise_for_status=lambda: None
            )
        return SimpleNamespace(
            status_code=200, json=lambda: eonet_mock, raise_for_status=lambda: None
        )

    with TestClient(app) as client:
        r_post = client.post(
            "/api/v1/aois", json={"name": "Test Box", "bbox": [-52.1, -1.6, -51.9, -1.4]}
        )
        assert r_post.status_code == 201
        aoi = r_post.json()
        assert 400.0 < aoi["area_km2"] < 600.0

        r_bad = client.post(
            "/api/v1/aois", json={"name": "Bad", "bbox": [-51.0, -1.0, -52.0, -2.0]}
        )
        assert r_bad.status_code == 400

        assert len(client.get("/api/v1/aois").json()) == 1
        assert client.delete(f"/api/v1/aois/{aoi['id']}").status_code == 200

        with patch("httpx.AsyncClient.get", new=fake_get):
            ev_res = client.get("/api/v1/events/live")
            assert ev_res.status_code == 200
            events = ev_res.json()["events"]
            assert len(events) == 2
            assert {e["source"] for e in events} == {"USGS", "EONET"}


def test_timeseries_and_watchlist_no_duplicate_alerts(tmp_path, monkeypatch):
    monkeypatch.setenv("TERRAPULSE_DB_PATH", str(tmp_path / "wl.db"))
    monkeypatch.setenv("DISABLE_SCHEDULER", "1")
    db.init_db()

    d1 = (datetime.now() - timedelta(days=15)).strftime("%Y-%m-%d")
    d2 = (datetime.now() - timedelta(days=3)).strftime("%Y-%m-%d")
    fake_granules = [
        {
            "id": "G1",
            "title": "NISAR_G1",
            "acquisition_date": d1,
            "orbit_direction": "ascending",
            "https_link": "https://x/1.h5",
        },
        {
            "id": "G2",
            "title": "NISAR_G2",
            "acquisition_date": d2,
            "orbit_direction": "ascending",
            "https_link": "https://x/2.h5",
        },
    ]

    class FakeProvider:
        def is_authenticated(self):
            return True

        def authenticate(self):
            return True

        def search_datasets(self, **kwargs):
            return fake_granules

        def stream_backscatter_window(
            self, https_url, band="HH", window=256, lat=None, lon=None, bbox=None
        ):
            val = 0.01 if "1.h5" in https_url else 0.1
            arr = np.full((128, 128), val, dtype=np.float64)
            if "2.h5" in https_url:
                arr[:, :] = 0.002  # sharp -7 dB drop vs 1.h5 over entire 128x128 (6.5 km2)
            x = np.linspace(388000.0, 388000.0 + 127 * 20.0, 128)
            y = np.linspace(9835000.0, 9835000.0 - 127 * 20.0, 128)
            return {
                "values": arr,
                "variable": "HHHH",
                "shape": (5400, 5400),
                "window": 128,
                "window_origin": [0, 0],
                "spacing_m": [20.0, 20.0],
                "x_coords": x,
                "y_coords": y,
                "epsg": 32722,
                "crs": "EPSG:32722",
            }

    sent_emails = []

    def fake_send(to_addr, subj, body):
        sent_emails.append((to_addr, subj))
        return True

    with patch("app.services.cache.get_provider", return_value=FakeProvider()):
        # Timeseries incremental run
        timeseries.run_timeseries_job("ts001", -1.5, -52.0, band="HH", months=3, window=128)
        ts_job = db.get_timeseries_job("ts001")
        pts = db.get_timeseries_points("ts001")
        assert ts_job["status"] == "completed"
        assert len(pts) == 2

        # Watchlist alert & deduplication
        item = db.create_watchlist_item(
            "Amazon Site",
            -1.5,
            -52.0,
            hazard="flood",
            severity_threshold="Medium",
            email="ops@example.com",
        )
        res1 = alerts_worker.check_watchlist_once(notifier=fake_send)
        assert res1["alerts_created"] == 1
        assert len(sent_emails) == 1

        # Second check on same granules creates 0 duplicate alerts/emails
        res2 = alerts_worker.check_watchlist_once(notifier=fake_send)
        assert res2["alerts_created"] == 0
        assert len(sent_emails) == 1
        assert len(db.list_alerts()) == 1
        assert db.list_watchlist()[0]["id"] == item["id"]
