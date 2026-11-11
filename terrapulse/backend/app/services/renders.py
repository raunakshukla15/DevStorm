"""PNG overlay rendering and job artifact cache under data/jobs/{job_id}/."""

import os
from pathlib import Path
import struct
from typing import Any, Dict, Optional, Tuple
import zlib

import numpy as np

_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent


def get_jobs_dir() -> Path:
    raw = os.getenv("TERRAPULSE_JOBS_DIR") or os.getenv("TERRAPULSE_DB_PATH")
    if os.getenv("TERRAPULSE_JOBS_DIR"):
        base = Path(os.environ["TERRAPULSE_JOBS_DIR"])
    elif raw:
        db_p = Path(raw)
        if not db_p.is_absolute():
            db_p = (_BACKEND_DIR / db_p).resolve()
        base = db_p.parent / "jobs"
    else:
        base = (_BACKEND_DIR / "data" / "jobs").resolve()
    base.mkdir(parents=True, exist_ok=True)
    return base


def get_job_dir(job_id: str) -> Path:
    safe = "".join(ch for ch in job_id if ch.isalnum() or ch in ("-", "_"))
    d = get_jobs_dir() / safe
    d.mkdir(parents=True, exist_ok=True)
    return d


def _encode_png_rgba(rgba: np.ndarray) -> bytes:
    """Encode an (H, W, 4) uint8 array as PNG bytes (Pillow or pure-zlib fallback)."""
    try:
        import io
        from PIL import Image

        buf = io.BytesIO()
        Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG")
        return buf.getvalue()
    except ImportError:
        h, w, _ = rgba.shape
        raw_rows = b"".join(b"\x00" + rgba[y].tobytes() for y in range(h))

        def chunk(tag: bytes, payload: bytes) -> bytes:
            return (
                struct.pack("!I", len(payload))
                + tag
                + payload
                + struct.pack("!I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
            )

        ihdr = struct.pack("!IIBBBBB", w, h, 8, 6, 0, 0, 0)
        return (
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw_rows, level=6))
            + chunk(b"IEND", b"")
        )


def _stretch_bounds(arr: np.ndarray) -> Tuple[float, float]:
    valid = arr[np.isfinite(arr)]
    if valid.size == 0:
        return (-25.0, 0.0)
    lo, hi = np.percentile(valid, [2.0, 98.0])
    if not np.isfinite(lo) or not np.isfinite(hi) or hi <= lo:
        return (float(np.nanmin(valid)), float(np.nanmin(valid)) + 1.0)
    return (float(lo), float(hi))


def _grayscale_rgba(arr: np.ndarray, vmin: float, vmax: float) -> np.ndarray:
    h, w = arr.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    valid = np.isfinite(arr)
    norm = np.clip((np.where(valid, arr, vmin) - vmin) / max(vmax - vmin, 1e-6), 0.0, 1.0)
    gray = (norm * 255.0).astype(np.uint8)
    rgba[..., 0] = gray
    rgba[..., 1] = gray
    rgba[..., 2] = gray
    rgba[..., 3] = np.where(valid, 235, 0).astype(np.uint8)
    return rgba


def _diverging_rgba(diff: np.ndarray, limit_db: float = 5.0) -> np.ndarray:
    """Diverging palette: red/amber for negative dB drop, blue/cyan for increase, transparent near 0."""
    h, w = diff.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    valid = np.isfinite(diff)
    lim = max(float(limit_db), 1.0)
    vals = np.where(valid, diff, 0.0)

    neg_t = np.clip(-vals / lim, 0.0, 1.0)
    pos_t = np.clip(vals / lim, 0.0, 1.0)

    # Strong drops -> bright red/orange (#ef4444); strong increases -> cyan/blue (#38bdf8)
    r = np.where(vals < 0, 239, 56).astype(np.uint8)
    g = np.where(vals < 0, (190 - 122 * neg_t), 189).astype(np.uint8)
    b = np.where(vals < 0, (68 * (1.0 - neg_t)), 248).astype(np.uint8)

    mag = np.abs(vals)
    alpha_f = np.where(mag < 0.8, 25.0, 60.0 + 175.0 * np.clip(mag / lim, 0.0, 1.0))
    a = np.where(valid, alpha_f, 0.0).astype(np.uint8)

    rgba[..., 0] = r
    rgba[..., 1] = g
    rgba[..., 2] = b
    rgba[..., 3] = a
    return rgba


def _rgb_composite_rgba(before_db: np.ndarray, after_db: np.ndarray, hv_diff: Optional[np.ndarray] = None) -> np.ndarray:
    """False-color SAR composite: R=after, G=before (or HV diff), B=before."""
    lo, hi = _stretch_bounds(np.concatenate([before_db[np.isfinite(before_db)], after_db[np.isfinite(after_db)]]))
    span = max(hi - lo, 1e-6)
    valid = np.isfinite(before_db) & np.isfinite(after_db)
    r_ch = np.clip((np.where(valid, after_db, lo) - lo) / span, 0.0, 1.0)
    b_ch = np.clip((np.where(valid, before_db, lo) - lo) / span, 0.0, 1.0)
    if hv_diff is not None and hv_diff.shape == before_db.shape:
        g_ch = np.clip((np.where(np.isfinite(hv_diff), hv_diff, 0.0) + 5.0) / 10.0, 0.0, 1.0)
    else:
        g_ch = 0.5 * (r_ch + b_ch)

    h, w = before_db.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., 0] = (r_ch * 255.0).astype(np.uint8)
    rgba[..., 1] = (g_ch * 255.0).astype(np.uint8)
    rgba[..., 2] = (b_ch * 255.0).astype(np.uint8)
    rgba[..., 3] = np.where(valid, 235, 0).astype(np.uint8)
    return rgba


def save_job_visuals(
    job_id: str,
    before_db: np.ndarray,
    after_db: np.ndarray,
    difference_db: np.ndarray,
    x_coords: np.ndarray,
    y_coords: np.ndarray,
    crs: str,
    hv_diff: Optional[np.ndarray] = None,
) -> Dict[str, str]:
    """Render before/after/difference/rgb PNGs and cache arrays for export endpoints."""
    job_dir = get_job_dir(job_id)

    b_fin = before_db[np.isfinite(before_db)]
    a_fin = after_db[np.isfinite(after_db)]
    combined = np.concatenate([b_fin, a_fin]) if (b_fin.size or a_fin.size) else np.array([-25.0, 0.0])
    vmin, vmax = _stretch_bounds(combined)

    outputs: Dict[str, bytes] = {
        "before": _encode_png_rgba(_grayscale_rgba(before_db, vmin, vmax)),
        "after": _encode_png_rgba(_grayscale_rgba(after_db, vmin, vmax)),
        "difference": _encode_png_rgba(_diverging_rgba(difference_db)),
        "rgb": _encode_png_rgba(_rgb_composite_rgba(before_db, after_db, hv_diff=hv_diff)),
    }
    urls: Dict[str, str] = {}
    for name, payload in outputs.items():
        (job_dir / f"{name}.png").write_bytes(payload)
        urls[name] = f"/api/v1/analysis/jobs/{job_id}/image/{name}.png"

    np.savez_compressed(
        job_dir / "arrays.npz",
        difference=np.asarray(difference_db, dtype=np.float32),
        x_coords=np.asarray(x_coords, dtype=np.float64),
        y_coords=np.asarray(y_coords, dtype=np.float64),
        crs=np.array([str(crs)]),
    )
    return urls


def load_job_image(job_id: str, name: str) -> Optional[Path]:
    allowed = {"before", "after", "difference", "rgb"}
    if name not in allowed:
        return None
    p = get_job_dir(job_id) / f"{name}.png"
    return p if p.exists() else None


def load_job_arrays(job_id: str) -> Optional[Dict[str, Any]]:
    p = get_job_dir(job_id) / "arrays.npz"
    if not p.exists():
        return None
    with np.load(p, allow_pickle=False) as data:
        return {
            "difference": np.asarray(data["difference"], dtype=np.float64),
            "x_coords": np.asarray(data["x_coords"], dtype=np.float64),
            "y_coords": np.asarray(data["y_coords"], dtype=np.float64),
            "crs": str(data["crs"][0]),
        }
