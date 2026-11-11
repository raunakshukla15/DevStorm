"""Watchlist monitoring worker, APScheduler hook, and optional SMTP alerts."""

from datetime import datetime, timedelta
import logging
import os
import smtplib
from email.message import EmailMessage
from typing import Any, Callable, Dict, List, Optional
import uuid

from apscheduler.schedulers.background import BackgroundScheduler

from app import db
from app.services import cache
from app.services.flood_analysis import compute_polygon_confidence, compute_severity_area_confidence
from app.services.hazards import resolve_short_names
from app.services.job_runner import parse_granule_date, run_analysis_job

logger = logging.getLogger(__name__)

_SEVERITY_RANK = {"Low": 1, "Medium": 2, "High": 3}
_scheduler: Optional[BackgroundScheduler] = None


def send_email_alert(to_email: str, subject: str, body: str) -> bool:
    """Send an alert notification via configured SMTP server; safe no-op if unconfigured."""
    host = os.getenv("SMTP_HOST")
    if not host or not to_email:
        return False
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    sender = os.getenv("SMTP_FROM", user or "terrapulse@localhost")
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP(host, port, timeout=15) as server:
        if port != 25:
            try:
                server.starttls()
            except Exception:
                pass
        if user and password:
            server.login(user, password)
        server.send_message(msg)
    return True


def check_watchlist_once(
    notifier: Optional[Callable[[str, str, str], Any]] = None,
) -> Dict[str, Any]:
    """Scan all watchlist entries for newer NISAR granules and trigger alerts if exceeded."""
    send_fn = notifier or send_email_alert
    items = db.list_watchlist()
    provider = cache.get_provider()
    checked = 0
    created_alerts: List[Dict[str, Any]] = []
    errors: List[str] = []

    if items and not provider.is_authenticated() and not provider.authenticate():
        return {
            "checked": 0,
            "alerts_created": 0,
            "alerts": [],
            "errors": ["Earthdata auth unavailable"],
        }

    end_str = datetime.now().strftime("%Y-%m-%d")
    start_str = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")

    for item in items:
        checked += 1
        wid = int(item["id"])
        lat, lon = float(item["lat"]), float(item["lon"])
        hazard = str(item.get("hazard") or "flood").lower()
        thresh_sev = str(item.get("severity_threshold") or "Medium")
        last_date = item.get("last_granule_date")
        bbox = [lon - 0.6, lat - 0.6, lon + 0.6, lat + 0.6]

        granules: List[Dict[str, Any]] = []
        for sn in resolve_short_names("nisar_l2_gcov"):
            try:
                found = cache.cached_search(provider, sn, (start_str, end_str), bbox, count=15)
                if found:
                    granules = found
                    break
            except Exception as e:
                errors.append(f"watchlist {wid} search failed: {e}")

        dated = [(g, parse_granule_date(g)) for g in granules]
        dated = [(g, d) for g, d in dated if d is not None]
        dated.sort(key=lambda t: t[1], reverse=True)
        if not dated:
            db.update_watchlist_checked(wid, last_date)
            continue

        latest_g, latest_dt = dated[0]
        latest_iso = latest_dt.strftime("%Y-%m-%d")
        gid = str(cache.granule_key(latest_g) or latest_g.get("title") or latest_iso)

        if last_date and latest_iso <= last_date:
            db.update_watchlist_checked(wid, last_date)
            continue
        if db.has_alert_for_granule(wid, gid):
            db.update_watchlist_checked(wid, latest_iso)
            continue

        # Run a quick synchronous analysis when at least 2 granules exist
        severity = "Low"
        job_id = f"wl-{uuid.uuid4().hex[:10]}"
        msg = f"New NISAR acquisition on {latest_iso} for {item['name']} ({hazard})."

        if len(dated) >= 2:
            prev_g, prev_dt = dated[1]
            params = {
                "hazard": hazard,
                "before_date": prev_dt.strftime("%Y-%m-%d"),
                "after_date": latest_iso,
                "lat": lat,
                "lon": lon,
                "dataset_id": "nisar_l2_gcov",
                "band": "HH",
                "window": 128,
            }
            db.create_job(job_id, params)
            try:
                run_analysis_job(job_id, params)
                job = db.get_job(job_id)
                res = (job or {}).get("result") or {}
                an = res.get("analysis") or {}
                area_km2 = an.get("affected_area_km2") or 0.0
                conf_score = (res.get("confidence") or {}).get("score")
                if conf_score is None:
                    conf_score, _ = compute_polygon_confidence(
                        an.get("mean_backscatter_difference_db") or 0.0,
                        res.get("threshold_db") or -2.0,
                        int(an.get("valid_pixels") or 0),
                    )
                severity, _ = compute_severity_area_confidence(area_km2, float(conf_score))
                msg = (
                    f"{hazard.title()} indicator at {item['name']}: {severity} severity "
                    f"({area_km2:.2f} km^2 affected, {latest_iso} vs {prev_dt.strftime('%Y-%m-%d')})."
                )
            except Exception as e:
                errors.append(f"watchlist {wid} analysis failed: {e}")

        db.update_watchlist_checked(wid, latest_iso)
        if _SEVERITY_RANK.get(severity, 1) >= _SEVERITY_RANK.get(thresh_sev, 2):
            alert = db.create_alert(
                watchlist_id=wid,
                job_id=job_id,
                hazard=hazard,
                location_name=item["name"],
                severity=severity,
                message=msg,
                granule_id=gid,
            )
            created_alerts.append(alert)
            if item.get("email"):
                try:
                    send_fn(
                        str(item["email"]),
                        f"[TerraPulse Alert] {severity} {hazard} indicator at {item['name']}",
                        msg + "\n\nNote: SAR backscatter indicator only; verify before action.",
                    )
                except Exception as e:
                    errors.append(f"email notify failed for {wid}: {e}")

    return {
        "checked": checked,
        "alerts_created": len(created_alerts),
        "alerts": created_alerts,
        "errors": errors,
    }


def start_watchlist_scheduler() -> None:
    """Start background APScheduler interval job if enabled."""
    global _scheduler
    if _scheduler is not None:
        return
    if os.getenv("DISABLE_SCHEDULER", "").lower() in {"1", "true", "yes"}:
        return
    interval_hours = max(1, int(os.getenv("WATCHLIST_INTERVAL_HOURS", "6")))
    _scheduler = BackgroundScheduler(daemon=True)
    _scheduler.add_job(
        check_watchlist_once,
        "interval",
        hours=interval_hours,
        id="watchlist_poll",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info("Watchlist APScheduler started (every %dh)", interval_hours)


def stop_watchlist_scheduler() -> None:
    """Shutdown APScheduler cleanly on app exit."""
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:
            pass
        _scheduler = None
