"""SQLite persistence layer for TerraPulse jobs, results, AOIs, timeseries, watchlist, and alerts."""

from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    desc,
    inspect,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

_BACKEND_DIR = Path(__file__).resolve().parent.parent


class Base(DeclarativeBase):
    pass


class JobRow(Base):
    __tablename__ = "jobs"

    job_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    status: Mapped[str] = mapped_column(String(32), default="running")
    stage: Mapped[str] = mapped_column(String(128), default="queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(64))
    updated_at: Mapped[str] = mapped_column(String(64))


class JobResultRow(Base):
    __tablename__ = "job_results"

    job_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("jobs.job_id", ondelete="CASCADE"), primary_key=True
    )
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(String(64))


class AoiRow(Base):
    __tablename__ = "aois"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(160))
    bbox: Mapped[list] = mapped_column(JSON)
    area_km2: Mapped[float] = mapped_column(Float)
    created_at: Mapped[str] = mapped_column(String(64))


class TimeseriesJobRow(Base):
    __tablename__ = "timeseries_jobs"

    series_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    band: Mapped[str] = mapped_column(String(16), default="HH")
    months: Mapped[int] = mapped_column(Integer, default=6)
    status: Mapped[str] = mapped_column(String(32), default="running")
    total_granules: Mapped[int] = mapped_column(Integer, default=0)
    processed_granules: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(64))
    updated_at: Mapped[str] = mapped_column(String(64))


class TimeseriesPointRow(Base):
    __tablename__ = "timeseries_points"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    series_id: Mapped[str] = mapped_column(String(64), index=True)
    granule_id: Mapped[str] = mapped_column(String(160))
    acquisition_date: Mapped[str] = mapped_column(String(32))
    mean_db: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    std_db: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    orbit_direction: Mapped[str] = mapped_column(String(32), default="unknown")
    valid_pixels: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[str] = mapped_column(String(64))


class WatchlistRow(Base):
    __tablename__ = "watchlist"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(160))
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    hazard: Mapped[str] = mapped_column(String(32), default="flood")
    severity_threshold: Mapped[str] = mapped_column(String(32), default="Medium")
    email: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    last_checked_at: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    last_granule_date: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[str] = mapped_column(String(64))


class AlertRow(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    watchlist_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("watchlist.id", ondelete="SET NULL"), nullable=True
    )
    job_id: Mapped[Optional[str]] = mapped_column(
        String(64), ForeignKey("jobs.job_id", ondelete="SET NULL"), nullable=True
    )
    granule_id: Mapped[Optional[str]] = mapped_column(String(160), nullable=True)
    hazard: Mapped[str] = mapped_column(String(32))
    location_name: Mapped[str] = mapped_column(String(160))
    severity: Mapped[str] = mapped_column(String(32))
    message: Mapped[str] = mapped_column(Text)
    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[str] = mapped_column(String(64))


_engine = None
_SessionLocal: Optional[sessionmaker[Session]] = None
_current_db_path: Optional[str] = None


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def resolve_db_path(db_path: Optional[str] = None) -> Path:
    raw = (
        db_path or os.getenv("TERRAPULSE_DB_PATH") or os.getenv("DB_PATH") or "./data/terrapulse.db"
    )
    p = Path(raw)
    if not p.is_absolute():
        p = (_BACKEND_DIR / p).resolve()
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def init_db(db_path: Optional[str] = None) -> None:
    """Initialize SQLite engine and create/migrate tables if missing."""
    global _engine, _SessionLocal, _current_db_path
    resolved = resolve_db_path(db_path)
    resolved_str = str(resolved)
    if _engine is not None and _current_db_path == resolved_str:
        return
    if _engine is not None:
        _engine.dispose()
    _engine = create_engine(
        f"sqlite:///{resolved_str}",
        connect_args={"check_same_thread": False},
        future=True,
    )
    Base.metadata.create_all(_engine)
    # Lightweight additive column check for existing SQLite files
    insp = inspect(_engine)
    if "alerts" in insp.get_table_names():
        cols = {c["name"] for c in insp.get_columns("alerts")}
        if "granule_id" not in cols:
            with _engine.begin() as conn:
                conn.execute(text("ALTER TABLE alerts ADD COLUMN granule_id VARCHAR(160)"))
    _SessionLocal = sessionmaker(
        bind=_engine, autoflush=False, autocommit=False, expire_on_commit=False
    )
    _current_db_path = resolved_str


def get_session() -> Session:
    if _SessionLocal is None:
        init_db()
    assert _SessionLocal is not None
    return _SessionLocal()


# ---------------- Jobs ----------------


def create_job(
    job_id: str, params: Dict[str, Any], created_at: Optional[str] = None
) -> Dict[str, Any]:
    ts = created_at or _utc_iso()
    with get_session() as db:
        db.add(
            JobRow(
                job_id=job_id,
                status="running",
                stage="queued",
                progress=0,
                params=params,
                error=None,
                created_at=ts,
                updated_at=ts,
            )
        )
        db.commit()
    return {
        "job_id": job_id,
        "status": "running",
        "stage": "queued",
        "progress": 0,
        "params": params,
        "created_at": ts,
        "result": None,
        "error": None,
    }


def update_job(
    job_id: str,
    *,
    status: Optional[str] = None,
    stage: Optional[str] = None,
    progress: Optional[int] = None,
    error: Optional[str] = None,
) -> None:
    with get_session() as db:
        row = db.get(JobRow, job_id)
        if row is None:
            return
        if status is not None:
            row.status = status
        if stage is not None:
            row.stage = stage
        if progress is not None:
            row.progress = progress
        if error is not None:
            row.error = error
        row.updated_at = _utc_iso()
        db.commit()


def save_job_result(job_id: str, result: Dict[str, Any]) -> None:
    ts = _utc_iso()
    with get_session() as db:
        row = db.get(JobRow, job_id)
        if row is not None:
            row.status = "complete"
            row.stage = "done"
            row.progress = 100
            row.updated_at = ts
        existing = db.get(JobResultRow, job_id)
        if existing is None:
            db.add(JobResultRow(job_id=job_id, result=result, created_at=ts))
        else:
            existing.result = result
        db.commit()


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    with get_session() as db:
        row = db.get(JobRow, job_id)
        if row is None:
            return None
        res_row = db.get(JobResultRow, job_id)
        return {
            "job_id": row.job_id,
            "status": row.status,
            "stage": row.stage,
            "progress": row.progress,
            "params": row.params or {},
            "created_at": row.created_at,
            "result": res_row.result if res_row is not None else None,
            "error": row.error,
        }


def list_jobs(limit: int = 20) -> List[Dict[str, Any]]:
    capped = max(1, min(int(limit), 100))
    with get_session() as db:
        rows = (
            db.query(JobRow, JobResultRow)
            .outerjoin(JobResultRow, JobRow.job_id == JobResultRow.job_id)
            .order_by(desc(JobRow.created_at))
            .limit(capped)
            .all()
        )
        items: List[Dict[str, Any]] = []
        for row, res_row in rows:
            items.append(
                {
                    "job_id": row.job_id,
                    "status": row.status,
                    "stage": row.stage,
                    "progress": row.progress,
                    "params": row.params or {},
                    "created_at": row.created_at,
                    "result": res_row.result if res_row is not None else None,
                    "error": row.error,
                }
            )
        return items


def prune_expired_jobs(ttl_days: int = 30) -> int:
    cutoff = (
        (datetime.now(timezone.utc) - timedelta(days=ttl_days)).isoformat().replace("+00:00", "Z")
    )
    with get_session() as db:
        old = db.query(JobRow).filter(JobRow.created_at < cutoff).all()
        count = len(old)
        for row in old:
            db.delete(row)
        db.commit()
        return count


# ---------------- AOIs ----------------


def create_aoi(name: str, bbox: List[float], area_km2: float) -> Dict[str, Any]:
    ts = _utc_iso()
    with get_session() as db:
        row = AoiRow(name=name, bbox=bbox, area_km2=area_km2, created_at=ts)
        db.add(row)
        db.commit()
        db.refresh(row)
        return {
            "id": row.id,
            "name": row.name,
            "bbox": row.bbox,
            "area_km2": row.area_km2,
            "created_at": row.created_at,
        }


def list_aois() -> List[Dict[str, Any]]:
    with get_session() as db:
        rows = db.query(AoiRow).order_by(desc(AoiRow.id)).all()
        return [
            {
                "id": r.id,
                "name": r.name,
                "bbox": r.bbox,
                "area_km2": r.area_km2,
                "created_at": r.created_at,
            }
            for r in rows
        ]


def delete_aoi(aoi_id: int) -> bool:
    with get_session() as db:
        row = db.get(AoiRow, aoi_id)
        if row is None:
            return False
        db.delete(row)
        db.commit()
        return True


# ---------------- Time series ----------------


def upsert_timeseries_job(
    series_id: str,
    lat: float,
    lon: float,
    band: str,
    months: int,
    status: str = "running",
    total_granules: Optional[int] = None,
    processed_granules: Optional[int] = None,
    error: Optional[str] = None,
) -> Dict[str, Any]:
    ts = _utc_iso()
    with get_session() as db:
        row = db.get(TimeseriesJobRow, series_id)
        if row is None:
            row = TimeseriesJobRow(
                series_id=series_id,
                lat=lat,
                lon=lon,
                band=band,
                months=months,
                status=status,
                total_granules=total_granules or 0,
                processed_granules=processed_granules or 0,
                error=error,
                created_at=ts,
                updated_at=ts,
            )
            db.add(row)
        else:
            row.status = status
            if total_granules is not None:
                row.total_granules = total_granules
            if processed_granules is not None:
                row.processed_granules = processed_granules
            if error is not None:
                row.error = error
            row.updated_at = ts
        db.commit()
        return {
            "series_id": row.series_id,
            "lat": row.lat,
            "lon": row.lon,
            "band": row.band,
            "months": row.months,
            "status": row.status,
            "total_granules": row.total_granules,
            "processed_granules": row.processed_granules,
            "error": row.error,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }


def get_timeseries_job(series_id: str) -> Optional[Dict[str, Any]]:
    with get_session() as db:
        row = db.get(TimeseriesJobRow, series_id)
        if row is None:
            return None
        return {
            "series_id": row.series_id,
            "lat": row.lat,
            "lon": row.lon,
            "band": row.band,
            "months": row.months,
            "status": row.status,
            "total_granules": row.total_granules,
            "processed_granules": row.processed_granules,
            "error": row.error,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }


def add_timeseries_point(
    series_id: str,
    granule_id: str,
    acquisition_date: str,
    mean_db: Optional[float],
    std_db: Optional[float],
    orbit_direction: str,
    valid_pixels: int,
) -> Dict[str, Any]:
    ts = _utc_iso()
    with get_session() as db:
        existing = (
            db.query(TimeseriesPointRow)
            .filter(
                TimeseriesPointRow.series_id == series_id,
                TimeseriesPointRow.granule_id == granule_id,
            )
            .first()
        )
        if existing is not None:
            return {
                "granule_id": existing.granule_id,
                "acquisition_date": existing.acquisition_date,
                "mean_db": existing.mean_db,
                "std_db": existing.std_db,
                "orbit_direction": existing.orbit_direction,
                "valid_pixels": existing.valid_pixels,
            }
        row = TimeseriesPointRow(
            series_id=series_id,
            granule_id=granule_id,
            acquisition_date=acquisition_date,
            mean_db=mean_db,
            std_db=std_db,
            orbit_direction=orbit_direction,
            valid_pixels=valid_pixels,
            created_at=ts,
        )
        db.add(row)
        db.commit()
        return {
            "granule_id": row.granule_id,
            "acquisition_date": row.acquisition_date,
            "mean_db": row.mean_db,
            "std_db": row.std_db,
            "orbit_direction": row.orbit_direction,
            "valid_pixels": row.valid_pixels,
        }


def get_timeseries_points(series_id: str) -> List[Dict[str, Any]]:
    with get_session() as db:
        rows = (
            db.query(TimeseriesPointRow)
            .filter(TimeseriesPointRow.series_id == series_id)
            .order_by(TimeseriesPointRow.acquisition_date)
            .all()
        )
        return [
            {
                "granule_id": r.granule_id,
                "acquisition_date": r.acquisition_date,
                "mean_db": r.mean_db,
                "std_db": r.std_db,
                "orbit_direction": r.orbit_direction,
                "valid_pixels": r.valid_pixels,
            }
            for r in rows
        ]


# ---------------- Watchlist & Alerts ----------------


def create_watchlist_item(
    name: str,
    lat: float,
    lon: float,
    hazard: str = "flood",
    severity_threshold: str = "Medium",
    email: Optional[str] = None,
) -> Dict[str, Any]:
    ts = _utc_iso()
    with get_session() as db:
        row = WatchlistRow(
            name=name,
            lat=lat,
            lon=lon,
            hazard=hazard,
            severity_threshold=severity_threshold,
            email=email,
            active=True,
            created_at=ts,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return _serialize_watchlist(row)


def _serialize_watchlist(row: WatchlistRow) -> Dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "lat": row.lat,
        "lon": row.lon,
        "hazard": row.hazard,
        "severity_threshold": row.severity_threshold,
        "email": row.email,
        "last_checked_at": row.last_checked_at,
        "last_granule_date": row.last_granule_date,
        "active": row.active,
        "created_at": row.created_at,
    }


def list_watchlist() -> List[Dict[str, Any]]:
    with get_session() as db:
        rows = db.query(WatchlistRow).order_by(desc(WatchlistRow.id)).all()
        return [_serialize_watchlist(r) for r in rows]


def delete_watchlist_item(item_id: int) -> bool:
    with get_session() as db:
        row = db.get(WatchlistRow, item_id)
        if row is None:
            return False
        db.delete(row)
        db.commit()
        return True


def update_watchlist_checked(item_id: int, last_granule_date: Optional[str] = None) -> None:
    with get_session() as db:
        row = db.get(WatchlistRow, item_id)
        if row is None:
            return
        row.last_checked_at = _utc_iso()
        if last_granule_date:
            row.last_granule_date = last_granule_date
        db.commit()


def has_alert_for_granule(watchlist_id: int, granule_id: str) -> bool:
    with get_session() as db:
        return (
            db.query(AlertRow)
            .filter(
                AlertRow.watchlist_id == watchlist_id,
                AlertRow.granule_id == granule_id,
            )
            .first()
            is not None
        )


def create_alert(
    *,
    watchlist_id: Optional[int],
    job_id: Optional[str],
    hazard: str,
    location_name: str,
    severity: str,
    message: str,
    granule_id: Optional[str] = None,
) -> Dict[str, Any]:
    ts = _utc_iso()
    with get_session() as db:
        row = AlertRow(
            watchlist_id=watchlist_id,
            job_id=job_id,
            granule_id=granule_id,
            hazard=hazard,
            location_name=location_name,
            severity=severity,
            message=message,
            acknowledged=False,
            created_at=ts,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return _serialize_alert(row)


def _serialize_alert(row: AlertRow) -> Dict[str, Any]:
    return {
        "id": row.id,
        "watchlist_id": row.watchlist_id,
        "job_id": row.job_id,
        "granule_id": row.granule_id,
        "hazard": row.hazard,
        "location_name": row.location_name,
        "severity": row.severity,
        "message": row.message,
        "acknowledged": row.acknowledged,
        "created_at": row.created_at,
    }


def list_alerts() -> List[Dict[str, Any]]:
    with get_session() as db:
        rows = db.query(AlertRow).order_by(desc(AlertRow.id)).all()
        return [_serialize_alert(r) for r in rows]


def acknowledge_alert(alert_id: int) -> bool:
    with get_session() as db:
        row = db.get(AlertRow, alert_id)
        if row is None:
            return False
        row.acknowledged = True
        db.commit()
        return True


def dismiss_alert(alert_id: int) -> bool:
    with get_session() as db:
        row = db.get(AlertRow, alert_id)
        if row is None:
            return False
        db.delete(row)
        db.commit()
        return True
