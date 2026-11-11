"""SQLite persistence layer for TerraPulse jobs, results, watchlist, and alerts."""

from datetime import datetime, timezone
from pathlib import Path
import os
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
    raw = db_path or os.getenv("TERRAPULSE_DB_PATH") or os.getenv("DB_PATH") or "./data/terrapulse.db"
    p = Path(raw)
    if not p.is_absolute():
        p = (_BACKEND_DIR / p).resolve()
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def init_db(db_path: Optional[str] = None) -> None:
    """Initialize SQLite engine and create tables if missing."""
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
    _SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False, expire_on_commit=False)
    _current_db_path = resolved_str


def get_session() -> Session:
    if _SessionLocal is None:
        init_db()
    assert _SessionLocal is not None
    return _SessionLocal()


def create_job(job_id: str, params: Dict[str, Any], created_at: Optional[str] = None) -> Dict[str, Any]:
    ts = created_at or _utc_iso()
    with get_session() as db:
        row = JobRow(
            job_id=job_id,
            status="running",
            stage="queued",
            progress=0,
            params=params,
            error=None,
            created_at=ts,
            updated_at=ts,
        )
        db.add(row)
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
            items.append({
                "job_id": row.job_id,
                "status": row.status,
                "stage": row.stage,
                "progress": row.progress,
                "params": row.params or {},
                "created_at": row.created_at,
                "result": res_row.result if res_row is not None else None,
                "error": row.error,
            })
        return items

