"""
NISAR Data Provider

Provides a unified interface for accessing NISAR SAR data through
NASA Earthdata services. Supports both HTTPS and direct S3 access
depending on the execution environment.

Follows the provider abstraction pattern defined in the project spec.
"""

import os
import logging
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List, Tuple, Iterator
from pathlib import Path

import earthaccess
import numpy as np

logger = logging.getLogger(__name__)

MAX_WINDOW_PIXELS = 512


class NISARDataProvider:
    """
    Abstract base class for NISAR data access.
    
    Handles:
    - Earthdata authentication
    - Dataset searching and metadata retrieval
    - Geographic/temporal coverage checks
    - Observation retrieval with appropriate preprocessing
    """
    
    def __init__(self) -> None:
        self._authenticated = False
        self._s3_endpoint = os.getenv("NISAR_S3_ENDPOINT", 
                                      "https://nisar.asf.earthdatacloud.nasa.gov/s3credentials")
        self._username = os.getenv("NASA_EARTHDATA_USERNAME")
        self._password = os.getenv("NASA_EARTHDATA_PASSWORD")
        
    def authenticate(self) -> bool:
        """Authenticate with NASA Earthdata.

        Fails fast when no credentials are configured — never blocks on an
        interactive prompt (which would hang API requests forever).
        earthaccess>=0.14 uses strategy-based login; the "environment"
        strategy reads EARTHDATA_USERNAME / EARTHDATA_PASSWORD, so our
        NASA_EARTHDATA_* values are bridged into those names first.
        """
        import os as _os

        try:
            if self._username and self._password:
                _os.environ["EARTHDATA_USERNAME"] = self._username
                _os.environ["EARTHDATA_PASSWORD"] = self._password
            # Non-interactive only: never strategy="all"/"interactive", which
            # prompts on stdin and would hang the server request indefinitely.
            try:
                earthaccess.login(strategy="environment")
            except Exception:
                # Fall back to an existing .netrc if present
                earthaccess.login(strategy="netrc")
            self._authenticated = True
            logger.info("Successfully authenticated with NASA Earthdata")
            return True
        except Exception as e:
            logger.warning(
                "Earthdata authentication failed (set NASA_EARTHDATA_USERNAME / "
                "NASA_EARTHDATA_PASSWORD in backend/.env). %s",
                e,
            )
            self._authenticated = False
            return False
    
    def is_authenticated(self) -> bool:
        """Check if provider is authenticated."""
        return self._authenticated
    
    def search_datasets(
        self,
        short_name: str,
        temporal: Optional[Tuple[str, str]] = None,
        bbox: Optional[Tuple[float, float, float, float]] = None,
        **kwargs
    ) -> List[Dict[str, Any]]:
        """
        Search for NISAR datasets.
        
        Args:
            short_name: NISAR product short name (e.g., 'NISAR_L1B_RSLC')
            temporal: (start_date, end_date) in YYYY-MM-DD format
            bbox: (min_lon, min_lat, max_lon, max_lat)
            **kwargs: Additional earthsearch parameters
            
        Returns:
            List of dataset metadata dicts
        """
        if not self.is_authenticated():
            if not self.authenticate():
                raise RuntimeError("Could not authenticate with NASA Earthdata")
        
        # Build search parameters
        search_kwargs = {
            "short_name": short_name,
            "cloud_hosted": True,
        }
        
        if temporal:
            start_date, end_date = temporal
            search_kwargs["temporal"] = (start_date, end_date)
        
        if bbox:
            min_lon, min_lat, max_lon, max_lat = bbox
            # earthaccess>=0.14 takes 4 positional args, not a list
            search_kwargs["bounding_box"] = (min_lon, min_lat, max_lon, max_lat)
        
        # Add any additional kwargs
        search_kwargs.update(kwargs)
        
        try:
            logger.info(f"Searching NISAR datasets: short_name={short_name}, "
                       f"temporal={temporal}, bbox={bbox}")
            
            results = earthaccess.search_data(**search_kwargs)

            datasets = []
            for result in results:
                metadata = self._extract_metadata(result, short_name)
                if metadata:
                    datasets.append(metadata)
            
            logger.info(f"Found {len(datasets)} NISAR datasets")
            return datasets
            
        except Exception as e:
            logger.error(f"NISAR dataset search failed: {e}")
            raise
    
    def _extract_metadata(self, result, short_name: str) -> Optional[Dict[str, Any]]:
        """Extract standardized metadata from an earthaccess search result.

        Uses defensive access: earthaccess granule objects expose UMM metadata
        in several shapes depending on version, so every field falls back to
        None/"unknown" instead of raising.
        """
        try:
            https_link = None
            s3_link = None
            try:
                links = result.data_links()
                if links:
                    https_link = links[0]
            except Exception:
                pass
            try:
                direct = result.data_links(access="direct")
                if direct:
                    s3_link = direct[0]
            except Exception:
                pass

            granule_id = None
            title = "NISAR Product"
            try:
                meta = result.get("meta", {}) or {}
                granule_id = meta.get("concept-id")
            except Exception:
                pass
            try:
                umm_probe = result.get("umm", {}) or {}
                title = umm_probe.get("GranuleUR") or title
            except Exception:
                pass

            # UMM temporal extent -> acquisition date
            acquisition_date = None
            temporal_begin = None
            try:
                umm = result.get("umm", {}) or {}
                te = umm.get("TemporalExtent", {}) or {}
                # RangeDateTime (most NISAR granules) or SingleDateTime
                rd = te.get("RangeDateTime", {}) or {}
                temporal_begin = rd.get("BeginningDateTime") or te.get("SingleDateTime")
                if temporal_begin:
                    acquisition_date = datetime.fromisoformat(
                        str(temporal_begin).replace("Z", "+00:00")
                    ).date().isoformat()
            except Exception:
                pass

            # UMM spatial extent -> bounding box [W, S, E, N].
            # NISAR granules use GPolygons (not BoundingRectangles).
            bounding_box = None
            try:
                umm = result.get("umm", {}) or {}
                se = umm.get("SpatialExtent", {}) or {}
                hsd = se.get("HorizontalSpatialDomain", {}) or {}
                geom = hsd.get("Geometry", {}) or {}
                rects = geom.get("BoundingRectangles") or []
                if rects:
                    r = rects[0]
                    bounding_box = [
                        r.get("WestBoundingCoordinate"),
                        r.get("SouthBoundingCoordinate"),
                        r.get("EastBoundingCoordinate"),
                        r.get("NorthBoundingCoordinate"),
                    ]
                else:
                    polys = geom.get("GPolygons") or []
                    lons, lats = [], []
                    for poly in polys:
                        pts = (poly.get("Boundary", {}) or {}).get("Points") or []
                        for pt in pts:
                            if pt.get("Longitude") is not None:
                                lons.append(float(pt["Longitude"]))
                            if pt.get("Latitude") is not None:
                                lats.append(float(pt["Latitude"]))
                    if lons and lats:
                        bounding_box = [min(lons), min(lats), max(lons), max(lats)]
            except Exception:
                pass

            # Browse/preview image from UMM RelatedUrls when the archive provides one
            browse_url = None
            try:
                umm = result.get("umm", {}) or {}
                for rel in umm.get("RelatedUrls") or []:
                    url = rel.get("URL") or ""
                    typ = str(rel.get("Type", "")).upper()
                    if ("VISUALIZATION" in typ or "BROWSE" in typ or "PREVIEW" in typ
                            or "browse" in url.lower()):
                        browse_url = url
                        break
            except Exception:
                pass

            # Orbit direction from UMM AdditionalAttributes when present
            orbit_direction = "unknown"
            try:
                umm = result.get("umm", {}) or {}
                for attr in umm.get("AdditionalAttributes") or []:
                    name = str(attr.get("Name", "")).upper()
                    vals = attr.get("Values") or []
                    if "ORBIT" in name and ("ASCEND" in name or "DIRECTION" in name):
                        if vals:
                            orbit_direction = str(vals[0]).lower()
                            break
            except Exception:
                pass

            return {
                "id": granule_id,
                "short_name": short_name,
                "title": str(title),
                "acquisition_date": acquisition_date,
                "temporal_begin": temporal_begin,
                "https_link": https_link,
                "s3_link": s3_link,
                "browse_url": browse_url,
                "bounding_box": bounding_box,
                "orbit_direction": orbit_direction,
                "provider": "NASA/ISRO NISAR",
                "data_centre": "ASF DAAC / Earthdata Cloud",
            }

        except Exception as e:
            logger.warning(f"Failed to extract metadata from result: {e}")
            return None
    
    def check_availability(
        self,
        lat: float,
        lon: float,
        start_date: str,
        end_date: str,
        short_name: str,
        radius_km: float = 50.0
    ) -> Dict[str, Any]:
        """
        Check NISAR data availability for a location and time range.
        
        Args:
            lat: Latitude
            lon: Longitude
            start_date: Start date (YYYY-MM-DD)
            end_date: End date (YYYY-MM-DD)
            short_name: NISAR product short name
            radius_km: Search radius in km from the point
            
        Returns:
            Availability result dict
        """
        if not self.is_authenticated():
            if not self.authenticate():
                return {
                    "available": False,
                    "error": "Authentication failed - cannot check data availability"
                }
        
        try:
            # Search for data in the area and time range
            bbox = [lon - radius_km/111.0, lat - radius_km/111.0, 
                    lon + radius_km/111.0, lat + radius_km/111.0]
            
            datasets = self.search_datasets(
                short_name=short_name,
                temporal=(start_date, end_date),
                bbox=bbox
            )
            
            if datasets:
                # Return information about the first available dataset
                dataset = datasets[0]
                return {
                    "available": True,
                    "datasets": datasets,
                    "note": f"Found {len(datasets)} NISAR datasets in the specified area and time range"
                }
            else:
                return {
                    "available": False,
                    "note": "No NISAR data found for the specified location and time range. "
                            "This could be due to: orbital coverage, data gaps, "
                            "or the area being outside the swath coverage.",
                    "data_qualifier": "No observations available"
                }
                
        except Exception as e:
            logger.error(f"Availability check failed: {e}")
            return {
                "available": False,
                "error": str(e),
                "note": "Error checking data availability. Please verify credentials "
                        "and try again."
            }
    
    def get_observation(
        self,
        dataset_id: str,
        s3_link: str,
        https_link: str,
        band: str = "HH"
    ) -> Optional[Dict[str, Any]]:
        """
        Retrieve and load a NISAR observation.
        
        Args:
            dataset_id: Identifier for the dataset
            s3_link: Direct S3 access URL (if available)
            https_link: HTTPS access URL
            band: Polarization band (e.g., 'HH', 'HV', 'VV')
            
        Returns:
            Observation dict with loaded data or None if failed
        """
        if not self.is_authenticated():
            if not self.authenticate():
                return None
        
        try:
            import xarray as xr
            
            # Try S3 access first (if in us-west-2 and s3_link provided)
            if s3_link:
                try:
                    import boto3
                    import fsspec
                    
                    # For S3 access, we need to be in us-west-2 or have temp credentials
                    fs = fsspec.filesystem('https')
                    nisar_file = fs.open(s3_link, mode='rb', 
                                        client_kwargs={'auth': None})
                    
                    # Try to open with h5netcdf
                    ds = xr.open_dataset(nisar_file, engine='h5netcdf')
                    
                    logger.info(f"Loaded NISAR observation via S3: {dataset_id}")
                    return {
                        "dataset_id": dataset_id,
                        "data": ds,
                        "source": "S3",
                        "band": band,
                        "success": True
                    }
                    
                except Exception as e:
                    logger.warning(f"S3 access failed, trying HTTPS: {e}")
            
            # Fall back to HTTPS access
            if https_link:
                import fsspec
                
                fs = fsspec.filesystem('https')
                nisar_file = fs.open(https_link, mode='rb')
                
                ds = xr.open_dataset(nisar_file, engine='h5netcdf')
                
                logger.info(f"Loaded NISAR observation via HTTPS: {dataset_id}")
                return {
                    "dataset_id": dataset_id,
                    "data": ds,
                    "source": "HTTPS",
                    "band": band,
                    "success": True
                }
            
            logger.error(f"No access link available for {dataset_id}")
            return None
            
        except Exception as e:
            logger.error(f"Failed to load observation {dataset_id}: {e}")
            return {
                "dataset_id": dataset_id,
                "success": False,
                "error": str(e),
                "note": "Could not load observation. Check data access and format compatibility."
            }
    
    @contextmanager
    def _open_gcov_grid(self, https_url: str) -> Iterator[Any]:
        """Open only the NISAR GCOV frequencyA grid group via authenticated HTTPS."""
        try:
            import xarray as xr
        except ImportError as e:
            raise RuntimeError(f"xarray is required for streaming: {e}")

        if not self.is_authenticated() and not self.authenticate():
            raise RuntimeError("Earthdata authentication required for streaming.")

        try:
            fs = earthaccess.get_fsspec_https_session()
        except Exception as e:
            raise RuntimeError(f"Could not create authenticated session: {e}")

        fobj = None
        try:
            fobj = fs.open(https_url, mode="rb")
            # Open ONLY the GCOV grid group; open_datatree() walks every HDF5 group.
            ds = None
            last_err = None
            for gp in (
                "/science/LSAR/GCOV/grids/frequencyA",
                "science/LSAR/GCOV/grids/frequencyA",
            ):
                try:
                    try:
                        fobj.seek(0)
                    except Exception:
                        pass
                    ds = xr.open_dataset(
                        fobj,
                        group=gp,
                        engine="h5netcdf",
                        decode_timedelta=False,
                        phony_dims="access",
                    )
                    break
                except Exception as e:
                    last_err = e
                    continue
            if ds is None:
                raise RuntimeError(
                    f"Could not open GCOV grid group in product: {last_err}"
                )
            yield ds
        finally:
            try:
                if fobj is not None:
                    fobj.close()
            except Exception:
                pass

    @staticmethod
    def _extract_epsg(ds: Any) -> int:
        """Extract the integer EPSG code from a NISAR GCOV grid dataset."""
        if "projection" in ds:
            proj = ds["projection"]
            for attr_key in ("epsg_code", "epsg"):
                val = proj.attrs.get(attr_key)
                if val is not None:
                    return int(val)
            try:
                arr = np.asarray(proj.values).ravel()
                if arr.size > 0 and int(arr[0]) > 0:
                    return int(arr[0])
            except Exception:
                pass
        for attr_key in ("epsg_code", "epsg"):
            val = ds.attrs.get(attr_key)
            if val is not None:
                return int(val)
        raise RuntimeError(
            "Could not determine projection EPSG code from GCOV grid group."
        )

    @staticmethod
    def _select_pol_variable(ds: Any, band: str) -> str:
        """Select the 2D backscatter variable matching the requested polarization."""
        candidates = []
        for name, var in ds.data_vars.items():
            try:
                if len(var.dims) == 2:
                    candidates.append(str(name))
            except Exception:
                continue
        if not candidates:
            raise RuntimeError(
                f"No 2D data variables found in group "
                f"(available: {sorted(map(str, ds.data_vars))[:20]})"
            )
        band_up = (band or "HH").upper()
        preferred = [f"{band_up}{band_up}{band_up}{band_up}", f"{band_up}{band_up}"]
        for p in preferred:
            if p in candidates:
                return p
        for c in candidates:
            if band_up in c.upper():
                return c
        non_aux = [
            c for c in candidates
            if c not in {"mask", "inputDataExceptionMask", "numberOfLooks", "rtcGammaToSigmaFactor"}
        ]
        return non_aux[0] if non_aux else candidates[0]

    def stream_backscatter_window(
        self,
        https_url: str,
        band: str = "HH",
        window: int = 256,
        lat: Optional[float] = None,
        lon: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Stream a location-centered window of a co-pol backscatter layer.

        Reads ONLY a ``window`` x ``window`` patch via HTTPS range requests —
        the full (often multi-GB) product is never downloaded. When ``lat`` and
        ``lon`` are provided, transforms them into the granule's projected CRS
        using ``xCoordinates``, ``yCoordinates`` and ``projection`` EPSG, checks
        footprint bounds, and slices around the nearest grid cell.
        """
        if not https_url:
            raise RuntimeError("No HTTPS access URL for this granule.")
        req_window = int(window)
        if req_window < 1 or req_window > MAX_WINDOW_PIXELS:
            raise ValueError(
                f"window must be between 1 and {MAX_WINDOW_PIXELS} pixels (got {req_window})."
            )

        try:
            with self._open_gcov_grid(https_url) as ds:
                chosen = self._select_pol_variable(ds, band)
                da = ds[chosen]
                shape = tuple(int(s) for s in da.shape)
                rows, cols = shape[-2], shape[-1]
                w = min(req_window, rows, cols)

                if "xCoordinates" not in ds or "yCoordinates" not in ds:
                    raise RuntimeError(
                        "Granule grid group is missing xCoordinates or yCoordinates."
                    )
                x_coords = np.asarray(ds["xCoordinates"].values, dtype=np.float64)
                y_coords = np.asarray(ds["yCoordinates"].values, dtype=np.float64)
                if x_coords.shape[0] != cols or y_coords.shape[0] != rows:
                    raise RuntimeError(
                        f"Coordinate length mismatch: x={x_coords.shape[0]} vs cols={cols}, "
                        f"y={y_coords.shape[0]} vs rows={rows}."
                    )

                epsg_code = self._extract_epsg(ds)
                crs_str = f"EPSG:{epsg_code}"

                # Determine pixel spacing (meters) from metadata or coordinate steps
                spacing_m = None
                try:
                    sx = float(np.asarray(ds["xCoordinateSpacing"].values).ravel()[0])
                    sy = float(np.asarray(ds["yCoordinateSpacing"].values).ravel()[0])
                    if sx != 0 and sy != 0:
                        spacing_m = [abs(sx), abs(sy)]
                except Exception:
                    pass
                if spacing_m is None and len(x_coords) > 1 and len(y_coords) > 1:
                    dx = abs(float(x_coords[1] - x_coords[0]))
                    dy = abs(float(y_coords[1] - y_coords[0]))
                    if dx > 0 and dy > 0:
                        spacing_m = [dx, dy]

                half_dx = (spacing_m[0] / 2.0) if spacing_m else 10.0
                half_dy = (spacing_m[1] / 2.0) if spacing_m else 10.0

                if lat is not None and lon is not None:
                    from pyproj import Transformer

                    transformer = Transformer.from_crs("EPSG:4326", crs_str, always_xy=True)
                    target_x, target_y = transformer.transform(float(lon), float(lat))
                    x_min = float(np.min(x_coords)) - half_dx
                    x_max = float(np.max(x_coords)) + half_dx
                    y_min = float(np.min(y_coords)) - half_dy
                    y_max = float(np.max(y_coords)) + half_dy
                    if not (x_min <= target_x <= x_max and y_min <= target_y <= y_max):
                        raise ValueError(
                            f"Point ({lat}, {lon}) is outside granule footprint "
                            f"(projected x={target_x:.1f} m, y={target_y:.1f} m vs "
                            f"x=[{x_min:.1f}, {x_max:.1f}], y=[{y_min:.1f}, {y_max:.1f}] in {crs_str})."
                        )
                    cx = int(np.abs(x_coords - target_x).argmin())
                    cy = int(np.abs(y_coords - target_y).argmin())
                    r0 = max(0, min(rows - w, cy - w // 2))
                    c0 = max(0, min(cols - w, cx - w // 2))
                else:
                    r0 = max(0, (rows - w) // 2)
                    c0 = max(0, (cols - w) // 2)

                patch = da.isel({
                    da.dims[-2]: slice(r0, r0 + w),
                    da.dims[-1]: slice(c0, c0 + w),
                })
                values = np.asarray(patch.values, dtype=np.float64)
                x_win = x_coords[c0 : c0 + w]
                y_win = y_coords[r0 : r0 + w]

                logger.info(
                    "Streamed %dx%d window of '%s' at origin=(%d,%d) in %s (full %s) from %s",
                    w, w, chosen, r0, c0, crs_str, shape, https_url.split("/")[-1],
                )
                return {
                    "values": values,
                    "variable": str(chosen),
                    "shape": shape,
                    "window": w,
                    "window_origin": [r0, c0],
                    "spacing_m": spacing_m,
                    "x_coords": x_win,
                    "y_coords": y_win,
                    "epsg": epsg_code,
                    "crs": crs_str,
                }
        except (RuntimeError, ValueError):
            raise
        except Exception as e:
            raise RuntimeError(f"Windowed streaming failed: {e}")

    def get_product_info(self, short_name: str) -> Dict[str, Any]:
        """Get information about a NISAR product type."""
        product_info = {
            "NISAR_L1B_RSLC": {
                "name": "NISAR Level-1b Range-Doppler SLC",
                "description": "Level-1b single-look complex radar data",
                "spatial_resolution": "~30 m",
                "polarizations": ["HH", "HV", "VV"],
                "product_type": "SAR Interferometric",
                "orbit": "Sun-synchronous, 12-day repeat",
            },
            "NISAR_L2_GCOV_PROVISIONAL_V1": {
                "name": "NISAR Level-2 Geocoded Polarimetric Covariance (PROVISIONAL)",
                "description": "Geocoded covariance matrix information for polarization analysis",
                "spatial_resolution": "~30 m",
                "polarizations": ["HH", "HV", "VV"],
                "product_type": "Geocoded Polarimetric",
                "orbit": "Sun-synchronous, 12-day repeat",
            },
            "NISAR_L2_GCOV_BETA_V1": {
                "name": "NISAR Level-2 Geocoded Polarimetric Covariance (BETA)",
                "description": "Pre-calibration geocoded covariance information",
                "spatial_resolution": "~30 m",
                "polarizations": ["HH", "HV", "VV"],
                "product_type": "Geocoded Polarimetric",
                "orbit": "Sun-synchronous, 12-day repeat",
            },
        }
        
        return product_info.get(short_name, {
            "name": short_name,
            "description": "NISAR product type",
            "spatial_resolution": "~30 m",
            "polarizations": ["HH", "HV", "VV"],
            "product_type": "SAR",
            "orbit": "Sun-synchronous",
        })