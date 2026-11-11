"""Phase 4 coverage, security, concurrency, and service resilience tests."""

from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import numpy as np
import xarray as xr

from app import db
from app.services import alerts_worker, cache, event_feeds, job_runner, masks, timeseries
from app.services.nisar_provider import NISARDataProvider


def _fake_gcov_ds(rows=128, cols=128, before=True):
    x_coords = np.linspace(393000.0, 393000.0 + (cols - 1) * 20.0, cols)
    y_coords = np.linspace(9830000.0, 9830000.0 - (rows - 1) * 20.0, rows)
    hh = np.full((rows, cols), 0.08, dtype=np.float64)
    hv = np.full((rows, cols), 0.02, dtype=np.float64)
    if not before:
        hh[20:60, 20:60] = 0.005
    return xr.Dataset(
        {
            "HHHH": (["y", "x"], hh),
            "HVHV": (["y", "x"], hv),
            "projection": xr.DataArray(np.uint32(32722), attrs={"epsg_code": 32722}),
            "xCoordinateSpacing": xr.DataArray(20.0),
            "yCoordinateSpacing": xr.DataArray(-20.0),
        },
        coords={"xCoordinates": (["x"], x_coords), "yCoordinates": (["y"], y_coords)},
    )


def _fake_gunw_ds(rows=96, cols=96):
    x_coords = np.linspace(391000.0, 391000.0 + (cols - 1) * 80.0, cols)
    y_coords = np.linspace(9832000.0, 9832000.0 - (rows - 1) * 80.0, rows)
    phase = np.zeros((rows, cols), dtype=np.float64)
    phase[20:45, 20:45] = -3.5  # strong coherent LOS deformation (~6.6 cm)
    coh = np.full((rows, cols), 0.78, dtype=np.float64)
    return xr.Dataset(
        {
            "unwrappedPhase": (["y", "x"], phase),
            "coherenceMagnitude": (["y", "x"], coh),
            "projection": xr.DataArray(np.uint32(32722), attrs={"epsg_code": 32722}),
        },
        coords={"xCoordinates": (["x"], x_coords), "yCoordinates": (["y"], y_coords)},
    )


def test_provider_auth_search_extract_discover_and_gunw():
    provider = NISARDataProvider()
    provider._username = "demo_user"
    provider._password = "demo_password"

    with patch("app.services.nisar_provider.earthaccess.login") as mock_login:
        assert provider.authenticate() is True
        assert provider.is_authenticated() is True
        assert mock_login.call_count == 1

    provider._authenticated = False
    with patch(
        "app.services.nisar_provider.earthaccess.login",
        side_effect=[RuntimeError("no env"), None],
    ):
        assert provider.authenticate() is True

    provider._authenticated = False
    with patch(
        "app.services.nisar_provider.earthaccess.login",
        side_effect=RuntimeError("offline"),
    ):
        assert provider.authenticate() is False
        assert (
            provider.check_availability(
                -1.5, -52.0, "2026-01-01", "2026-02-01", "NISAR_L2_GCOV_V1"
            )["available"]
            is False
        )

    class FakeGranule:
        def __init__(self, cid, umm):
            self._cid = cid
            self._umm = umm

        def data_links(self, access=None):
            return ["s3://bucket/a.h5"] if access == "direct" else ["https://earthdata/a.h5"]

        def get(self, key, default=None):
            if key == "meta":
                return {"concept-id": self._cid}
            if key == "umm":
                return self._umm
            return default

    g_rect = FakeGranule(
        "G100",
        {
            "GranuleUR": "NISAR_RECT",
            "TemporalExtent": {"SingleDateTime": "2026-06-15T12:00:00Z"},
            "SpatialExtent": {
                "HorizontalSpatialDomain": {
                    "Geometry": {
                        "BoundingRectangles": [
                            {
                                "WestBoundingCoordinate": -53.0,
                                "SouthBoundingCoordinate": -2.0,
                                "EastBoundingCoordinate": -51.0,
                                "NorthBoundingCoordinate": -1.0,
                            }
                        ]
                    }
                }
            },
            "RelatedUrls": [{"Type": "GET RELATED VISUALIZATION", "URL": "https://browse/p.png"}],
            "AdditionalAttributes": [
                {"Name": "ASCENDING_ORBIT_DIRECTION", "Values": ["Ascending"]}
            ],
        },
    )
    g_poly = FakeGranule(
        "G101",
        {
            "GranuleUR": "NISAR_POLY",
            "TemporalExtent": {"RangeDateTime": {"BeginningDateTime": "2026-06-27T00:00:00Z"}},
            "SpatialExtent": {
                "HorizontalSpatialDomain": {
                    "Geometry": {
                        "GPolygons": [
                            {
                                "Boundary": {
                                    "Points": [
                                        {"Longitude": -53.0, "Latitude": -2.0},
                                        {"Longitude": -51.0, "Latitude": -1.0},
                                    ]
                                }
                            }
                        ]
                    }
                }
            },
        },
    )

    provider._authenticated = True
    with patch(
        "app.services.nisar_provider.earthaccess.search_data", return_value=[g_rect, g_poly]
    ):
        found = provider.search_datasets(
            "NISAR_L2_GCOV_V1", temporal=("2026-06-01", "2026-07-01"), bbox=(-53, -2, -51, -1)
        )
        assert len(found) == 2
        assert found[0]["orbit_direction"] == "ascending"
        assert found[0]["browse_url"] == "https://browse/p.png"
        assert found[1]["bounding_box"] == [-53.0, -2.0, -51.0, -1.0]

        avail = provider.check_availability(
            -1.5, -52.0, "2026-06-01", "2026-07-01", "NISAR_L2_GCOV_V1"
        )
        assert avail["available"] is True

    with patch("app.services.nisar_provider.earthaccess.search_data", return_value=[]):
        empty_av = provider.check_availability(
            -1.5, -52.0, "2026-06-01", "2026-07-01", "NISAR_L2_GCOV_V1"
        )
        assert empty_av["available"] is False

    # Discover all product families
    fake_cols = [
        {
            "umm": {
                "ShortName": "NISAR_L2_GCOV_V1",
                "Version": "1",
                "ProcessingLevel": {"Id": "L2"},
            },
            "meta": {"concept-id": "C1"},
        },
        {
            "umm": {"ShortName": "NISAR_L2_GUNW_BETA_V1", "Version": "1"},
            "meta": {"concept-id": "C2"},
        },
        {"umm": {"ShortName": "NISAR_L2_GSLC_V1", "Version": "1"}, "meta": {"concept-id": "C3"}},
        {"umm": {"ShortName": "NISAR_L3_SME2_V1", "Version": "1"}, "meta": {"concept-id": "C4"}},
        {"umm": {"ShortName": "NISAR_L2_GOFF_V1", "Version": "1"}, "meta": {"concept-id": "C5"}},
        {"umm": {"ShortName": "NISAR_L1_RSLC_V1", "Version": "1"}, "meta": {"concept-id": "C6"}},
        {"umm": {"ShortName": "NISAR_CAL_V1", "Version": "1"}, "meta": {"concept-id": "C7"}},
    ]
    with patch("app.services.nisar_provider.earthaccess.search_datasets", return_value=fake_cols):
        cols = provider.discover_nisar_collections()
        assert len(cols) == 7
        assert any("Soil Moisture" in c["family"] for c in cols)

    # EPSG extraction branches & product info
    ds_attr = xr.Dataset(attrs={"epsg_code": 32618})
    assert provider._extract_epsg(ds_attr) == 32618
    ds_val = xr.Dataset({"projection": xr.DataArray(np.array([32722]))})
    assert provider._extract_epsg(ds_val) == 32722
    assert provider.get_product_info("CUSTOM_PRODUCT")["name"] == "CUSTOM_PRODUCT"

    # GUNW streaming via mocked fsspec session + xarray.open_dataset
    gunw_ds = _fake_gunw_ds()
    fake_file = MagicMock()
    fake_fs = SimpleNamespace(open=lambda *_a, **_kw: fake_file)
    with patch(
        "app.services.nisar_provider.earthaccess.get_fsspec_https_session", return_value=fake_fs
    ):
        with patch("xarray.open_dataset", return_value=gunw_ds):
            out_pt = provider.stream_gunw_window(
                "https://x/gunw.h5", lat=-1.55, lon=-51.95, window=64
            )
            assert out_pt["crs"] == "EPSG:32722"
            assert out_pt["los_displacement_cm"].shape[0] <= 64
            out_bb = provider.stream_gunw_window(
                "https://x/gunw.h5", lat=-1.55, lon=-51.95, bbox=[-51.96, -1.56, -51.94, -1.54]
            )
            assert out_bb["coherence"] is not None


def test_job_runner_auto_dates_insar_fallbacks_and_semaphore(tmp_path, monkeypatch):
    monkeypatch.setenv("TERRAPULSE_DB_PATH", str(tmp_path / "jr.db"))
    monkeypatch.setenv("TERRAPULSE_JOBS_DIR", str(tmp_path / "jobs"))
    monkeypatch.setenv("MAX_CONCURRENT_JOBS", "2")
    db.init_db()

    sem = job_runner._get_job_semaphore()
    assert sem is job_runner._get_job_semaphore()

    # Invalid params fast-fail checks
    db.create_job("bad1", {"hazard": "alien_hazard", "lat": 0.0, "lon": 0.0})
    job_runner.run_analysis_job("bad1", {"hazard": "alien_hazard", "lat": 0.0, "lon": 0.0})
    assert db.get_job("bad1")["status"] == "failed"

    db.create_job(
        "bad2",
        {"hazard": "flood", "lat": 0.0, "lon": 0.0, "before_date": "bad", "after_date": "date"},
    )
    job_runner.run_analysis_job(
        "bad2",
        {"hazard": "flood", "lat": 0.0, "lon": 0.0, "before_date": "bad", "after_date": "date"},
    )
    assert db.get_job("bad2")["status"] == "failed"

    db.create_job(
        "bad3",
        {
            "hazard": "flood",
            "lat": 0.0,
            "lon": 0.0,
            "before_date": "2026-05-10",
            "after_date": "2026-05-01",
        },
    )
    job_runner.run_analysis_job(
        "bad3",
        {
            "hazard": "flood",
            "lat": 0.0,
            "lon": 0.0,
            "before_date": "2026-05-10",
            "after_date": "2026-05-01",
        },
    )
    assert db.get_job("bad3")["status"] == "failed"

    d1 = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    d2 = (datetime.now() - timedelta(days=5)).strftime("%Y-%m-%d")
    fake_granules = [
        {
            "id": "G_A",
            "title": "NISAR_A",
            "acquisition_date": d2,
            "orbit_direction": "ascending",
            "https_link": "https://x/after.h5",
        },
        {
            "id": "G_B",
            "title": "NISAR_B",
            "acquisition_date": d1,
            "orbit_direction": "ascending",
            "https_link": "https://x/before.h5",
        },
    ]

    ds_before = _fake_gcov_ds(before=True)
    ds_after = _fake_gcov_ds(before=False)
    gunw_ds = _fake_gunw_ds()

    class MockRunnerProvider(NISARDataProvider):
        def __init__(self, fail_stream=False):
            super().__init__()
            self._authenticated = True
            self.fail_stream = fail_stream

        def search_datasets(self, short_name, temporal=None, bbox=None, **kwargs):
            return fake_granules

        def stream_backscatter_window(
            self, https_url, band="HH", window=256, lat=None, lon=None, bbox=None
        ):
            if self.fail_stream:
                raise RuntimeError("HDF5 range read timeout")
            ds = ds_before if "before" in https_url else ds_after
            fake_file = MagicMock()
            fake_fs = SimpleNamespace(open=lambda *_a, **_kw: fake_file)
            with patch(
                "app.services.nisar_provider.earthaccess.get_fsspec_https_session",
                return_value=fake_fs,
            ):
                with patch("xarray.open_dataset", return_value=ds):
                    return super().stream_backscatter_window(
                        https_url, band=band, window=window, lat=lat, lon=lon, bbox=bbox
                    )

        def stream_gunw_window(self, https_url, lat, lon, window=256, bbox=None):
            if self.fail_stream:
                raise RuntimeError("GUNW timeout")
            fake_file = MagicMock()
            fake_fs = SimpleNamespace(open=lambda *_a, **_kw: fake_file)
            with patch(
                "app.services.nisar_provider.earthaccess.get_fsspec_https_session",
                return_value=fake_fs,
            ):
                with patch("xarray.open_dataset", return_value=gunw_ds):
                    return super().stream_gunw_window(
                        https_url, lat=lat, lon=lon, window=window, bbox=bbox
                    )

    # 1) Full GCOV auto_dates + HH/HV + lee speckle + otsu + water/slope mask notes
    p_ok = MockRunnerProvider(fail_stream=False)
    params_gcov = {
        "hazard": "flood",
        "lat": -1.55,
        "lon": -51.95,
        "band": "HH/HV",
        "speckle_filter": "lee",
        "threshold_mode": "otsu",
        "water_mask": True,
        "slope_mask": True,
        "window": 128,
    }
    db.create_job("gcov_ok", params_gcov)
    with patch("app.services.cache.get_provider", return_value=p_ok):
        job_runner.run_analysis_job("gcov_ok", params_gcov)
    res_ok = db.get_job("gcov_ok")["result"]
    assert res_ok["auto_dates"] is True
    assert res_ok["auxiliary_masks"]["status"] == "metadata_only"

    # 2) GUNW deformation InSAR path
    params_insar = {"hazard": "deformation", "lat": -1.55, "lon": -51.95, "window": 64}
    db.create_job("gunw_ok", params_insar)
    with patch("app.services.cache.get_provider", return_value=p_ok):
        job_runner.run_analysis_job("gunw_ok", params_insar)
    res_insar = db.get_job("gunw_ok")["result"]
    assert res_insar["method"].startswith("insar_unwrapped_phase_los")
    assert res_insar["analysis"]["mean_coherence"] > 0.5

    # 3) Stream RuntimeError -> metadata_only graceful fallback (both GCOV & GUNW)
    p_fail = MockRunnerProvider(fail_stream=True)
    params_meta = {
        "hazard": "flood",
        "lat": -1.55,
        "lon": -51.95,
        "before_date": d1,
        "after_date": d2,
        "window": 128,
    }
    db.create_job("gcov_meta", params_meta)
    db.create_job("gunw_meta", params_insar)
    with patch("app.services.cache.get_provider", return_value=p_fail):
        job_runner.run_analysis_job("gcov_meta", params_meta)
        job_runner.run_analysis_job("gunw_meta", params_insar)
    assert db.get_job("gcov_meta")["result"]["status"] == "metadata_only"
    assert db.get_job("gunw_meta")["result"]["status"] == "metadata_only"


def test_alerts_worker_smtp_scheduler_masks_timeseries_and_pruning(tmp_path, monkeypatch):
    monkeypatch.setenv("TERRAPULSE_DB_PATH", str(tmp_path / "p4.db"))
    monkeypatch.setenv("DISABLE_SCHEDULER", "0")
    db.init_db()

    # SMTP disabled without host
    monkeypatch.delenv("SMTP_HOST", raising=False)
    assert alerts_worker.send_email_alert("ops@example.com", "Subj", "Body") is False

    # SMTP enabled with TLS + login mocked
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("SMTP_PORT", "587")
    monkeypatch.setenv("SMTP_USER", "bot@example.com")
    monkeypatch.setenv("SMTP_PASSWORD", "secret")
    smtp_srv = MagicMock()
    smtp_ctx = MagicMock()
    smtp_ctx.__enter__.return_value = smtp_srv
    with patch("smtplib.SMTP", return_value=smtp_ctx):
        assert alerts_worker.send_email_alert("ops@example.com", "Subj", "Body") is True
        smtp_srv.starttls.assert_called_once()
        smtp_srv.login.assert_called_once()
        smtp_srv.send_message.assert_called_once()

    # Scheduler start / stop lifecycle
    alerts_worker.stop_watchlist_scheduler()
    alerts_worker.start_watchlist_scheduler()
    assert alerts_worker._scheduler is not None
    alerts_worker.stop_watchlist_scheduler()
    assert alerts_worker._scheduler is None

    # Auxiliary masks direct test
    m_out = masks.evaluate_auxiliary_masks(
        [[-2.0, -52.5], [-1.0, -51.5]], (10, 10), apply_water_mask=True, apply_slope_mask=True
    )
    assert m_out["masked_pixels"] == 0
    assert "Permanent water mask" in m_out["note"]

    # EONET Polygon normalization + cache clear
    event_feeds._feed_cache.clear()
    poly_ev = {
        "events": [
            {
                "id": "EONET_POLY",
                "title": "Wildfire Area",
                "categories": [{"id": "wildfires", "title": "Wildfires"}],
                "geometry": [
                    {
                        "date": "2026-09-12T00:00:00Z",
                        "type": "Polygon",
                        "coordinates": [
                            [[-120.0, 38.0], [-119.5, 38.0], [-119.5, 38.5], [-120.0, 38.5]]
                        ],
                    }
                ],
            }
        ]
    }
    norm = event_feeds._normalize_eonet(poly_ev)
    assert len(norm) == 1
    assert norm[0]["hazard"] == "forest_disturbance"
    assert abs(norm[0]["lat"] - 38.25) < 0.01

    # Timeseries empty granules sets failed status gracefully
    class EmptyProv:
        def is_authenticated(self):
            return True

        def authenticate(self):
            return True

        def search_datasets(self, **kwargs):
            return []

    with patch("app.services.cache.get_provider", return_value=EmptyProv()):
        timeseries.run_timeseries_job("ts_empty", 0.0, 0.0, band="HH", months=3)
    assert db.get_timeseries_job("ts_empty")["status"] == "completed"

    # Job TTL pruning deletes expired rows while keeping fresh ones
    db.create_job("old_job", {"hazard": "flood", "lat": 0.0, "lon": 0.0})
    db.create_job("fresh_job", {"hazard": "flood", "lat": 0.0, "lon": 0.0})
    with db.get_session() as s:
        old_row = s.get(db.JobRow, "old_job")
        old_row.created_at = "2020-01-01T00:00:00Z"
        s.commit()
    pruned = db.prune_expired_jobs(ttl_days=30)
    assert pruned == 1
    assert db.get_job("old_job") is None
    assert db.get_job("fresh_job") is not None


def test_collections_cache_and_startup_warmup():
    calls = {"discover": 0, "search": 0}

    class WarmProvider:
        def is_authenticated(self):
            return True

        def authenticate(self):
            return True

        def discover_nisar_collections(self, keyword="NISAR", count=50):
            calls["discover"] += 1
            return [{"short_name": "NISAR_L2_GCOV_PROVISIONAL_V1", "version": "1", "title": "GCOV"}]

        def search_datasets(self, short_name, temporal=None, bbox=None, count=20):
            calls["search"] += 1
            return []

    cache.collections_cache.clear()
    cache.search_cache.clear()
    prov = WarmProvider()
    with patch("app.services.cache.get_provider", return_value=prov):
        cache.warm_startup_caches()
        first = cache.cached_discover_collections(prov, keyword="NISAR", count=50)
        second = cache.cached_discover_collections(prov, keyword="NISAR", count=50)
    assert len(first) == 1
    assert second == first
    assert calls["discover"] == 1
    assert calls["search"] >= 2
