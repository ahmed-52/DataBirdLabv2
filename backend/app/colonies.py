from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from pydantic import BaseModel
from app.database import engine
from app.models import Colony

router = APIRouter(prefix="/api/colonies", tags=["colonies"])


def get_session():
    with Session(engine) as session:
        yield session


class ColonyCreate(BaseModel):
    slug: str
    name: str
    description: Optional[str] = None
    lat: float
    lon: float
    species_color_mapping: Optional[str] = None
    visual_model_path: Optional[str] = None
    acoustic_model_path: Optional[str] = None
    min_confidence: float = 0.25
    tile_size: int = 1280


class ColonyUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    species_color_mapping: Optional[str] = None
    visual_model_path: Optional[str] = None
    acoustic_model_path: Optional[str] = None
    min_confidence: Optional[float] = None
    tile_size: Optional[int] = None
    # NOTE: slug is intentionally absent — immutable after creation


@router.get("")
def list_colonies(session: Session = Depends(get_session)):
    return session.exec(select(Colony).where(Colony.is_active == True)).all()


@router.get("/{slug}")
def get_colony_by_slug(slug: str, session: Session = Depends(get_session)):
    c = session.exec(select(Colony).where(Colony.slug == slug, Colony.is_active == True)).one_or_none()
    if not c:
        raise HTTPException(404, f"Colony '{slug}' not found")
    return c


@router.post("", status_code=201)
def create_colony(payload: ColonyCreate, session: Session = Depends(get_session)):
    existing = session.exec(select(Colony).where(Colony.slug == payload.slug)).one_or_none()
    if existing:
        raise HTTPException(400, f"Slug '{payload.slug}' already exists")
    c = Colony(**payload.model_dump())
    session.add(c); session.commit(); session.refresh(c)
    return c


@router.patch("/{slug}")
def update_colony(slug: str, payload: ColonyUpdate, session: Session = Depends(get_session)):
    c = session.exec(select(Colony).where(Colony.slug == slug, Colony.is_active == True)).one_or_none()
    if not c:
        raise HTTPException(404, f"Colony '{slug}' not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    session.add(c); session.commit(); session.refresh(c)
    return c


@router.delete("/{slug}")
def delete_colony(slug: str, session: Session = Depends(get_session)):
    c = session.exec(select(Colony).where(Colony.slug == slug, Colony.is_active == True)).one_or_none()
    if not c:
        raise HTTPException(404, f"Colony '{slug}' not found")
    c.is_active = False  # soft delete
    session.add(c); session.commit()
    return {"ok": True, "soft_deleted": slug}
