"""CSV and PDF report export builders for completed TerraPulse jobs."""

import csv
import io
from pathlib import Path
from typing import Any, Dict, Optional

from app.services.renders import load_job_image


def build_job_csv(job: Dict[str, Any]) -> str:
    """Build CSV export combining job summary metrics and polygon outline features."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    res = job.get("result") or {}
    an = res.get("analysis") or {}
    dates = res.get("actual_granule_dates") or {}
    loc = res.get("location") or {}

    writer.writerow([
        "job_id",
        "hazard",
        "lat",
        "lon",
        "before_date",
        "after_date",
        "mean_diff_db",
        "std_diff_db",
        "percentage_decrease",
        "percentage_disturbed",
        "affected_area_km2",
        "confidence_level",
        "confidence_score",
    ])
    conf = res.get("confidence") or {}
    writer.writerow([
        job.get("job_id"),
        res.get("hazard"),
        loc.get("lat"),
        loc.get("lon"),
        dates.get("before"),
        dates.get("after"),
        an.get("mean_backscatter_difference_db"),
        an.get("std_difference_db"),
        an.get("percentage_decrease"),
        an.get("percentage_disturbed"),
        an.get("affected_area_km2"),
        conf.get("level") or conf.get("quality"),
        conf.get("score"),
    ])

    writer.writerow([])
    writer.writerow([
        "feature_index",
        "pixel_count",
        "area_km2",
        "mean_difference_db",
        "min_difference_db",
        "confidence_level",
        "confidence_score",
    ])
    outlines = (res.get("results") or {}).get("flood_outlines") or (res.get("results") or {}).get("disturbance_outlines") or {}
    for idx, feat in enumerate(outlines.get("features") or []):
        props = feat.get("properties") or {}
        writer.writerow([
            idx + 1,
            props.get("pixel_count"),
            props.get("area_km2"),
            props.get("mean_difference_db"),
            props.get("min_difference_db"),
            props.get("confidence_level"),
            props.get("confidence_score"),
        ])
    return buf.getvalue()


def build_job_pdf(job: Dict[str, Any]) -> bytes:
    """Render an HTML/PDF report (uses WeasyPrint when system libs work, else FPDF2)."""
    job_id = str(job.get("job_id") or "")
    res = job.get("result") or {}
    an = res.get("analysis") or {}
    dates = res.get("actual_granule_dates") or {}
    loc = res.get("location") or {}
    conf = res.get("confidence") or {}
    bg = res.get("before_granule") or {}
    ag = res.get("after_granule") or {}
    caveats = res.get("caveats_and_limitations") or []
    diff_img: Optional[Path] = load_job_image(job_id, "difference")

    def _safe_txt(val: Any) -> str:
        # FPDF standard fonts expect latin-1; replace non-latin symbols cleanly
        text = str(val if val is not None else "n/a")
        return (
            text.replace("—", "-")
            .replace("–", "-")
            .replace("Δ", "Delta ")
            .replace("σ⁰", "sigma0")
            .replace("²", "2")
            .encode("latin-1", "replace")
            .decode("latin-1")
        )

    from fpdf import FPDF

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, _safe_txt(f"TerraPulse SAR Change Report - Job {job_id}"), new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("Helvetica", "", 10)
    pdf.cell(
        0,
        6,
        _safe_txt(
            f"Hazard: {res.get('hazard_label', res.get('hazard', 'n/a'))} | "
            f"Location: {loc.get('lat')}, {loc.get('lon')} | "
            f"Dates: {dates.get('before')} -> {dates.get('after')}"
        ),
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.cell(
        0,
        6,
        _safe_txt(
            f"Collection: {res.get('short_name', 'n/a')} | Band: {res.get('polarization_band', 'HH')} | "
            f"Threshold: {res.get('threshold_db', 'n/a')} dB ({res.get('detection_mode', 'decrease')})"
        ),
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(3)

    if diff_img is not None:
        pdf.set_font("Helvetica", "B", 11)
        pdf.cell(0, 7, "Backscatter Difference Overlay (dB)", new_x="LMARGIN", new_y="NEXT")
        pdf.image(str(diff_img), x=pdf.l_margin, w=95)
        pdf.set_x(pdf.l_margin)
        pdf.ln(3)

    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 7, "Key Quantitative Indicators", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    metrics = [
        f"Mean Delta (dB): {an.get('mean_backscatter_difference_db')}",
        f"Std Delta (dB): {an.get('std_difference_db')}",
        f"Pixels Darker (%): {an.get('percentage_decrease')}",
        f"Pixels Disturbed (%): {an.get('percentage_disturbed')}",
        f"Affected Area (km2): {an.get('affected_area_km2')} ({an.get('area_basis', '')})",
        f"Confidence: {conf.get('level', conf.get('quality', 'indicator-level'))} "
        f"(score {conf.get('score', 'n/a')}) - {conf.get('formula', '')}",
        f"Before Granule ID: {bg.get('id', 'n/a')} ({bg.get('orbit_direction', 'unknown')})",
        f"After Granule ID: {ag.get('id', 'n/a')} ({ag.get('orbit_direction', 'unknown')})",
    ]
    for line in metrics:
        pdf.set_x(pdf.l_margin)
        pdf.multi_cell(pdf.epw, 5.5, _safe_txt(f"- {line}"), new_x="LMARGIN", new_y="NEXT")

    pdf.ln(3)
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 7, "Caveats and Scientific Limitations", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9.5)
    for c in caveats:
        pdf.set_x(pdf.l_margin)
        pdf.multi_cell(pdf.epw, 5, _safe_txt(f"* {c}"), new_x="LMARGIN", new_y="NEXT")

    return bytes(pdf.output())
