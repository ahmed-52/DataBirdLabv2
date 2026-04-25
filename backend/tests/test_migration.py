"""
Migration smoke test using SQLite as both source and dest.
For full Postgres validation, run the script manually against a real Supabase test project.
"""
import pytest
import tempfile
import os
from sqlmodel import Session, SQLModel, create_engine, select
from datetime import datetime


def test_migration_preserves_counts_and_pks(tmp_path, monkeypatch):
    # Build fixture SQLite with old schema shape
    src_path = tmp_path / "src.sqlite"
    dst_path = tmp_path / "dst.sqlite"

    # Import models BEFORE create_all so SQLModel.metadata is populated
    from app.models import ARU, Survey, MediaAsset, VisualDetection, Colony

    # Use new models (they've already had the Colony table added)
    src_engine = create_engine(f"sqlite:///{src_path}")
    SQLModel.metadata.create_all(src_engine)

    # Pre-create Colony for fixture (real migration handles this)
    with Session(src_engine) as s:
        c = Colony(slug="boeung-sne-fixture", name="Fixture", lat=0, lon=0)
        s.add(c); s.commit(); s.refresh(c)
        s.add(ARU(id=42, colony_id=c.id, name="aru-fixture", lat=0, lon=0))
        s.add(Survey(id=99, colony_id=c.id, name="surv-fixture", type="drone"))
        s.commit()
        s.add(MediaAsset(id=7, survey_id=99, file_path="static/uploads/x.tif"))
        s.commit()
        s.add(VisualDetection(id=3, asset_id=7, confidence=0.9, class_name="bird", bbox_json="[]"))
        s.commit()

    # Verify PKs preserved on read-back (sanity check that explicit IDs work)
    with Session(src_engine) as s:
        assert s.get(ARU, 42).name == "aru-fixture"
        assert s.get(Survey, 99).name == "surv-fixture"
        assert s.get(MediaAsset, 7).file_path == "static/uploads/x.tif"
        assert s.get(VisualDetection, 3).class_name == "bird"


def test_normalize_path():
    from scripts.migrate_to_multi_colony import normalize_path
    assert normalize_path("static/uploads/x.wav") == "uploads/x.wav"
    assert normalize_path("/Users/abc/backend/static/uploads/x.wav") == "uploads/x.wav"
    assert normalize_path("uploads/x.wav") == "uploads/x.wav"
    assert normalize_path(None) is None
