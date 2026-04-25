#!/usr/bin/env python
"""
One-shot migration: existing SQLite (single-site Boeung Sne) → multi-colony Postgres.

Usage:
  DATABASE_URL=postgresql://... python scripts/migrate_to_multi_colony.py \
    --sqlite-path ./data/db.sqlite

Behavior:
- Creates Boeung Sne Colony seeded from old SystemSettings.
- Preserves all primary keys exactly.
- Normalizes file_path strings (strips absolute prefix, strips 'static/' prefix).
- Verifies row counts; aborts on any mismatch.
- Idempotent: aborts cleanly if Boeung Sne colony already exists in Postgres.
"""
import os
import sys
import argparse
import logging
from sqlmodel import SQLModel, Session, create_engine, select
from sqlalchemy import text

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

OLD_TABLES = ["aru", "survey", "mediaasset", "visualdetection", "acousticdetection", "calibrationwindow", "systemsettings"]


def normalize_path(p):
    if not p: return p
    if "static/" in p:
        return p.split("static/", 1)[1]
    return p.lstrip("/")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sqlite-path", default="./data/db.sqlite")
    args = parser.parse_args()

    DATABASE_URL = os.environ.get("DATABASE_URL")
    if not DATABASE_URL or not DATABASE_URL.startswith("postgresql"):
        log.error("DATABASE_URL must be set to a postgresql:// URL")
        sys.exit(1)

    sqlite_engine = create_engine(f"sqlite:///{args.sqlite_path}")
    pg_engine = create_engine(DATABASE_URL)

    # Import old + new models. Old SystemSettings still exists in old schema.
    from app.models import Colony, ARU, Survey, MediaAsset, VisualDetection, AcousticDetection, CalibrationWindow, SystemSettings
    from app.database import create_db_and_tables
    SQLModel.metadata.create_all(pg_engine)

    # Idempotency check
    with Session(pg_engine) as pg:
        existing = pg.exec(select(Colony).where(Colony.slug == "boeung-sne")).one_or_none()
        if existing:
            log.error("Boeung Sne colony already exists in Postgres. Aborting (script is idempotent).")
            sys.exit(2)

    # Read everything from SQLite
    with Session(sqlite_engine) as sl:
        # Old SystemSettings (singleton)
        ss = sl.exec(text("SELECT * FROM systemsettings WHERE id=1")).first()
        arus = sl.exec(text("SELECT id, name, lat, lon FROM aru ORDER BY id")).all()
        surveys = sl.exec(text("SELECT id, name, date, type, status, error_message FROM survey ORDER BY id")).all()
        media = sl.exec(text("SELECT * FROM mediaasset ORDER BY id")).all()
        vdets = sl.exec(text("SELECT * FROM visualdetection ORDER BY id")).all()
        adets = sl.exec(text("SELECT * FROM acousticdetection ORDER BY id")).all()
        cws = sl.exec(text("SELECT * FROM calibrationwindow ORDER BY id")).all()

    log.info(f"Source counts: arus={len(arus)} surveys={len(surveys)} media={len(media)} vdet={len(vdets)} adet={len(adets)} cw={len(cws)}")

    # Insert into Postgres preserving PKs
    with Session(pg_engine) as pg:
        # 1. Seed colony
        colony = Colony(
            id=1,
            slug="boeung-sne",
            name="Boeung Sne",
            description="Boeung Sne Protected Forest, Cambodia",
            lat=ss.default_lat if ss else 11.406949,
            lon=ss.default_lon if ss else 105.394883,
            species_color_mapping=ss.species_color_mapping if ss else None,
            visual_model_path=ss.visual_model_path if ss else None,
            acoustic_model_path=ss.acoustic_model_path if ss else None,
            min_confidence=ss.min_confidence if ss else 0.25,
            tile_size=1280,
            is_active=True,
        )
        pg.add(colony); pg.commit(); pg.refresh(colony)
        log.info(f"Created Boeung Sne colony id={colony.id}")

        # Insert + commit per table to guarantee FK-dependent inserts see parents.
        # Batches of 500 for the large detection tables to avoid huge single-commit memory.
        def _commit_batch(batch_name):
            pg.commit()
            log.info(f"  inserted {batch_name}")

        for r in arus:
            pg.add(ARU(id=r.id, colony_id=colony.id, name=r.name, lat=r.lat, lon=r.lon))
        _commit_batch(f"aru ({len(arus)})")

        for r in surveys:
            pg.add(Survey(id=r.id, colony_id=colony.id, name=r.name, date=r.date, type=r.type, status=r.status, error_message=r.error_message))
        _commit_batch(f"survey ({len(surveys)})")

        for i, r in enumerate(media, 1):
            pg.add(MediaAsset(
                id=r.id, survey_id=r.survey_id, file_path=normalize_path(r.file_path),
                lat_tl=r.lat_tl, lon_tl=r.lon_tl, lat_br=r.lat_br, lon_br=r.lon_br,
                aru_id=r.aru_id, is_processed=r.is_processed, status=r.status,
                error_message=r.error_message, is_validated=r.is_validated,
            ))
            if i % 500 == 0:
                pg.commit()
        _commit_batch(f"mediaasset ({len(media)})")

        for i, r in enumerate(vdets, 1):
            pg.add(VisualDetection(
                id=r.id, asset_id=r.asset_id, confidence=r.confidence,
                class_name=r.class_name, bbox_json=r.bbox_json,
                corrected_class=r.corrected_class, corrected_bbox=r.corrected_bbox,
            ))
            if i % 1000 == 0:
                pg.commit()
        _commit_batch(f"visualdetection ({len(vdets)})")

        for i, r in enumerate(adets, 1):
            pg.add(AcousticDetection(
                id=r.id, asset_id=r.asset_id, class_name=r.class_name,
                confidence=r.confidence, start_time=r.start_time, end_time=r.end_time,
                is_human_reviewed=r.is_human_reviewed, corrected_class=r.corrected_class,
                absolute_start_time=r.absolute_start_time,
            ))
            if i % 1000 == 0:
                pg.commit()
        _commit_batch(f"acousticdetection ({len(adets)})")

        for r in cws:
            pg.add(CalibrationWindow(
                id=r.id, colony_id=colony.id,
                acoustic_survey_id=r.acoustic_survey_id, visual_survey_id=r.visual_survey_id, aru_id=r.aru_id,
                days_apart=r.days_apart, buffer_meters=r.buffer_meters,
                acoustic_call_count=r.acoustic_call_count, acoustic_asset_count=r.acoustic_asset_count,
                acoustic_calls_per_asset=r.acoustic_calls_per_asset,
                drone_detection_count=r.drone_detection_count,
                drone_area_hectares=r.drone_area_hectares,
                drone_density_per_hectare=r.drone_density_per_hectare,
                created_at=r.created_at,
            ))
        _commit_batch(f"calibrationwindow ({len(cws)})")

        # 2. Fix sequences
        for tbl in ["colony", "aru", "survey", "mediaasset", "visualdetection", "acousticdetection", "calibrationwindow"]:
            pg.exec(text(f"SELECT setval(pg_get_serial_sequence('{tbl}', 'id'), COALESCE((SELECT MAX(id) FROM {tbl}), 1))"))
        pg.commit()

    # 3. Verify counts
    with Session(pg_engine) as pg:
        new_counts = {
            "aru": pg.exec(select(ARU)).all(),
            "survey": pg.exec(select(Survey)).all(),
            "media": pg.exec(select(MediaAsset)).all(),
            "vdet": pg.exec(select(VisualDetection)).all(),
            "adet": pg.exec(select(AcousticDetection)).all(),
            "cw": pg.exec(select(CalibrationWindow)).all(),
        }

    expected = {
        "aru": len(arus), "survey": len(surveys), "media": len(media),
        "vdet": len(vdets), "adet": len(adets), "cw": len(cws),
    }
    for key, expected_count in expected.items():
        actual = len(new_counts[key])
        if actual != expected_count:
            log.error(f"COUNT MISMATCH on {key}: expected {expected_count}, got {actual}")
            sys.exit(3)
        log.info(f"OK: {key} count = {actual}")

    log.info("Migration complete.")


if __name__ == "__main__":
    main()
