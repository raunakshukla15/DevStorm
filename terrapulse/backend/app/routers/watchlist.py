"""Watchlist monitoring and persistent alerts endpoints."""

from typing import List
from fastapi import APIRouter, HTTPException

from app import db
from app.schemas import AlertOut, WatchlistCreate, WatchlistOut
from app.services.alerts_worker import check_watchlist_once
from app.services.flood_analysis import SEVERITY_RULE
from app.services.hazards import HAZARD_CONFIGS

router = APIRouter(tags=["watchlist"])


@router.get("/watchlist", response_model=List[WatchlistOut], summary="List monitored locations")
async def list_watchlist():
    return [WatchlistOut(**w) for w in db.list_watchlist()]


@router.post("/watchlist", response_model=WatchlistOut, status_code=201, summary="Add a location to watchlist")
async def create_watchlist(payload: WatchlistCreate):
    hazard = (payload.hazard or "flood").lower()
    if hazard not in HAZARD_CONFIGS:
        raise HTTPException(status_code=400, detail=f"Unsupported hazard '{hazard}'.")
    sev = payload.severity_threshold if payload.severity_threshold in {"Low", "Medium", "High"} else "Medium"
    row = db.create_watchlist_item(
        name=payload.name.strip(),
        lat=payload.lat,
        lon=payload.lon,
        hazard=hazard,
        severity_threshold=sev,
        email=payload.email.strip() if payload.email else None,
    )
    return WatchlistOut(**row)


@router.delete("/watchlist/{item_id}", summary="Remove location from watchlist")
async def delete_watchlist(item_id: int):
    if not db.delete_watchlist_item(item_id):
        raise HTTPException(status_code=404, detail=f"Unknown watchlist id {item_id}.")
    return {"deleted": True, "id": item_id}


@router.post("/watchlist/check", summary="Trigger watchlist scan for new NISAR passes")
async def trigger_watchlist_check():
    return check_watchlist_once()


@router.get("/alerts", response_model=List[AlertOut], summary="List triggered alerts")
async def list_alerts():
    return [AlertOut(**a) for a in db.list_alerts()]


@router.get("/alerts/severity-rule", summary="Get documented severity classification rule")
async def get_severity_rule():
    return {"rule": SEVERITY_RULE}


@router.post("/alerts/{alert_id}/acknowledge", summary="Acknowledge an alert")
async def acknowledge_alert(alert_id: int):
    if not db.acknowledge_alert(alert_id):
        raise HTTPException(status_code=404, detail=f"Unknown alert id {alert_id}.")
    return {"acknowledged": True, "id": alert_id}


@router.delete("/alerts/{alert_id}", summary="Dismiss an alert")
async def dismiss_alert(alert_id: int):
    if not db.dismiss_alert(alert_id):
        raise HTTPException(status_code=404, detail=f"Unknown alert id {alert_id}.")
    return {"deleted": True, "id": alert_id}
