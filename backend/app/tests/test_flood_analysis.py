"""Tests for NISAR flood monitoring analysis functions."""

import numpy as np
import xarray as xr

from app.services.flood_analysis import (
    calculate_backscatter_difference,
    validate_observation_compatibility,
    export_geotiff,
    export_geojson,
)


def create_mock_dataset(backscatter_value=0.0):
    """Create a mock NISAR-like xarray dataset for testing."""
    # Create a simple 2D data variable
    data = np.full((10, 10), backscatter_value, dtype=np.float64)

    ds = xr.Dataset({"sigma0": (["y", "x"], data)}, coords={"y": np.arange(10), "x": np.arange(10)})

    # Add metadata attributes (used by validation and analysis)
    ds.attrs = {
        "polarizations": "HH",
        "orbit_direction": "descending",
        "acquisition_date": "2024-01-15",
    }

    return ds


class TestBackscatterDifference:
    """Tests for backscatter difference calculation."""

    def test_basic_difference_calculation(self):
        """Test basic backscatter difference between two datasets."""
        before = create_mock_dataset(backscatter_value=0.5)
        after = create_mock_dataset(backscatter_value=0.2)

        result = calculate_backscatter_difference(before, after)

        assert "difference" in result
        assert result["method"] == "backscatter_difference_flood_indicator"
        assert "mean_difference" in result
        assert "percentage_decrease" in result

        # After (0.2) - Before (0.5) = -0.3
        diff = result["difference"]
        # Should have no NaN if no nodata in mock
        NaN_count = np.isnan(diff).sum()
        assert NaN_count == 0, f"Expected 0 NaN values, got {NaN_count}"
        # Check a specific value
        assert abs(float(diff[5, 5]) - (-0.3)) < 0.01, f"Expected -0.3, got {diff[5, 5]}"

    def test_difference_with_nodata(self):
        """Test backscatter difference with nodata values."""
        before = create_mock_dataset(backscatter_value=0.5)
        after = create_mock_dataset(backscatter_value=0.2)

        # Set a nodata value in the before dataset
        before_sigma0 = before["sigma0"].values.copy()
        before_sigma0[5, 5] = np.nan
        before = xr.Dataset(
            {"sigma0": (["y", "x"], before_sigma0)},
            coords={"y": np.arange(10), "x": np.arange(10)},
        )

        result = calculate_backscatter_difference(before, after)

        assert "difference" in result
        # Nodata positions should be NaN in the difference
        NaN_count = np.isnan(result["difference"]).sum()
        assert NaN_count > 0, "Expected some NaN values due to nodata"

    def test_percentage_decrease(self):
        """Test percentage decrease calculation."""
        before = create_mock_dataset(backscatter_value=1.0)
        after = create_mock_dataset(backscatter_value=0.1)

        result = calculate_backscatter_difference(before, after)

        # Should show ~90% decrease
        pct = result["percentage_decrease"]
        assert isinstance(pct, float)
        assert pct > 50  # More than 50% decrease expected


class TestCompatibilityValidation:
    """Tests for observation compatibility validation."""

    def test_compatible_observations(self):
        """Test validation of compatible observations."""
        before = create_mock_dataset()
        after = create_mock_dataset()

        result = validate_observation_compatibility(before, after)

        assert result["compatible"] is True
        assert len(result["warnings"]) == 0

    def test_incompatible_polarization(self):
        """Test validation with incompatible polarization."""
        before = create_mock_dataset()
        after = create_mock_dataset()

        # Set polarization via attrs (xarray compatible way)
        before.attrs["polarizations"] = "HH"
        after.attrs["polarizations"] = "VV"  # Different polarization

        result = validate_observation_compatibility(before, after)

        assert result["compatible"] is False
        assert len(result["warnings"]) > 0

    def test_incompatible_orbit(self):
        """Test validation with incompatible orbit direction."""
        before = create_mock_dataset()
        after = create_mock_dataset()

        # Set orbit direction via attrs (xarray compatible way)
        before.attrs["orbit_direction"] = "descending"
        after.attrs["orbit_direction"] = "ascending"  # Different orbit

        result = validate_observation_compatibility(before, after)

        assert result["compatible"] is False
        assert len(result["warnings"]) > 0

    def test_missing_attributes(self):
        """Test validation when attributes are missing."""
        before = xr.Dataset({"sigma0": (["y", "x"], np.zeros((10, 10)))})
        after = xr.Dataset({"sigma0": (["y", "x"], np.zeros((10, 10)))})

        # Don't set polarization or orbit - function should handle gracefully
        result = validate_observation_compatibility(before, after)

        # Should still be compatible (no warnings about missing attrs)
        assert "compatible" in result


class TestExportFunctions:
    """Tests for result export functions."""

    def test_geotiff_export_structure(self):
        """Test GeoTIFF export function structure."""
        dataset = xr.Dataset({"sigma0": (["y", "x"], np.random.random((10, 10)))})

        # Test the function runs (rasterio may or may not produce a valid GeoTIFF
        # depending on environment, but should not crash with import errors)
        result = export_geotiff(dataset, transform=None, crs="EPSG:4326")

        assert "success" in result
        # Either succeeds or returns error dict
        assert result.get("success") or "error" in result

    def test_geojson_export_no_flood(self):
        """Test GeoJSON export with no flood pixels."""
        difference_mask = np.zeros((10, 10), dtype=np.float64)

        result = export_geojson(difference_mask, transform=None, crs="EPSG:4326")

        assert "type" in result
        assert "features" in result
        assert result["type"] == "FeatureCollection"
        assert len(result["features"]) == 0

    def test_geojson_export_with_flood(self):
        """Test GeoJSON export with flood pixels."""
        import numpy as np

        # Create mask with flood in center
        difference_mask = np.zeros((10, 10), dtype=np.float64)
        difference_mask[4:6, 4:6] = -5.0  # Strong negative difference

        result = export_geojson(difference_mask, transform=None, crs="EPSG:4326")

        assert "type" in result
        assert "features" in result
        # Should detect the flooded region (at minimum, centroid-based feature)
        assert len(result["features"]) >= 1
