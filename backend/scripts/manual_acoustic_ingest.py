#!/usr/bin/env python3
"""
Batch acoustic ingestion for DataBirdLab.

Processes audio folders in scripts/data/ through the BirdNET pipeline.

Folder naming convention:
    {ARU_NUM}_{DEVICE_ID}_{DATE}_Gain_{dB}dB
    Example: 1_S7899_2025-02-04_Gain_40.0dB

Audio file naming convention:
    {ARU_NUM}_{DEVICE_ID}_{YYYYMMDD}_{HHMMSS}({TZ}).wav
    Example: 1_S7899_20250204_000000(UTC+7).wav

Usage:
    # Process first folder only (default)
    python backend/scripts/manual_acoustic_ingest.py

    # Process all folders
    python backend/scripts/manual_acoustic_ingest.py --all

    # Clear existing acoustic detections first
    python backend/scripts/manual_acoustic_ingest.py --clear

    # List ARUs
    python backend/scripts/manual_acoustic_ingest.py --list-arus
"""

from __future__ import annotations

import re
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
# Confidence thresholds are loaded from app/acoustic_config.py
# Edit that file to change species-specific thresholds globally.

# Set to True to process ALL folders, or False for the first folder only
PROCESS_ALL_FOLDERS = True

# Override ARU ID for all folders (None = use ARU number from folder name)
ARU_OVERRIDE = 2  # Beta

# Override year in all timestamps (None = use year from filenames)
YEAR_OVERRIDE = 2026

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
DATA_DIR = SCRIPT_DIR / "data"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlmodel import Session, select, delete, func  # noqa: E402

from app.database import engine  # noqa: E402
from app.models import ARU, Survey, MediaAsset, AcousticDetection  # noqa: E402
from pipeline import PipelineManager  # noqa: E402

AUDIO_EXTS = {".wav", ".mp3", ".flac"}
FOLDER_PATTERN = re.compile(r"^(\d+)_\w+_(\d{4}-\d{2}-\d{2})_Gain_")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def parse_folder_meta(folder_name: str) -> Optional[Tuple[int, str]]:
    """Extract (aru_number, date_str) from a folder name like '1_S7899_2025-02-04_Gain_40.0dB'."""
    m = FOLDER_PATTERN.match(folder_name)
    if not m:
        return None
    return int(m.group(1)), m.group(2)


def discover_folders(data_dir: Path) -> List[Path]:
    """Return sorted list of data sub-folders that match the expected naming pattern."""
    folders = []
    for p in sorted(data_dir.iterdir()):
        if p.is_dir() and parse_folder_meta(p.name):
            folders.append(p)
    return folders


def collect_audio_files(folder: Path) -> List[Path]:
    """Return sorted audio files in a folder (non-recursive). Skips empty files."""
    files = []
    skipped = 0
    for p in sorted(folder.iterdir()):
        if p.is_file() and p.suffix.lower() in AUDIO_EXTS:
            if p.stat().st_size == 0:
                skipped += 1
                continue
            files.append(p)
    if skipped:
        print(f"  Skipped {skipped} empty (0-byte) file(s) in {folder.name}")
    return files


def clear_acoustic_data(session: Session) -> None:
    """Delete all AcousticDetection rows and reset acoustic MediaAssets."""
    count = session.exec(select(func.count(AcousticDetection.id))).one()
    if count == 0:
        print("No acoustic detections to clear.")
        return

    session.exec(delete(AcousticDetection))

    acoustic_assets = session.exec(
        select(MediaAsset)
        .join(Survey, MediaAsset.survey_id == Survey.id)
        .where(Survey.type == "acoustic")
    ).all()
    for asset in acoustic_assets:
        asset.is_processed = False
        asset.status = "pending"
        asset.error_message = None
        session.add(asset)

    session.commit()
    print(f"Cleared {count} acoustic detections, reset {len(acoustic_assets)} assets.")


# ---------------------------------------------------------------------------
# Main ingestion
# ---------------------------------------------------------------------------

def process_folder(
    session: Session,
    folder: Path,
    aru_id: int,
    date_str: str,
    manager: PipelineManager,
) -> Tuple[int, int]:
    """Process a single data folder. Returns (ok_count, fail_count)."""
    files = collect_audio_files(folder)
    if not files:
        print(f"  No audio files in {folder.name}")
        return 0, 0

    date_obj = datetime.strptime(date_str, "%Y-%m-%d")
    survey_name = f"ARU {aru_id} - {date_str} - {folder.name}"

    survey = Survey(
        name=survey_name,
        type="acoustic",
        date=date_obj,
        status="processing",
    )
    session.add(survey)
    session.commit()
    session.refresh(survey)

    audio_dir = BACKEND_DIR / "static" / "uploads" / f"survey_{survey.id}" / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*60}")
    print(f"Survey {survey.id}: {survey_name}")
    print(f"Folder: {folder.name}")
    print(f"ARU: {aru_id} | Date: {date_str} | Files: {len(files)}")
    print(f"{'='*60}")

    ok, fail = 0, 0
    for src in files:
        dst = audio_dir / src.name.replace(" ", "_")
        shutil.copy2(src, dst)

        try:
            manager.run_survey_processing(
                survey_id=survey.id,
                input_path=str(dst),
                output_dir=None,
                aru_id=aru_id,
            )
            ok += 1
            print(f"  OK   {src.name}")
        except Exception as exc:
            fail += 1
            print(f"  FAIL {src.name} -> {exc}")

    survey.status = "completed" if fail == 0 else "failed"
    if fail > 0:
        survey.error_message = f"{fail} file(s) failed during ingestion."
    session.add(survey)
    session.commit()

    return ok, fail


def main() -> None:
    import argparse

    p = argparse.ArgumentParser(description="Batch acoustic ingestion for DataBirdLab")
    p.add_argument("--all", action="store_true", help="Process all data folders (default: first only)")
    p.add_argument("--clear", action="store_true", help="Clear existing acoustic detections before ingesting")
    p.add_argument("--list-arus", action="store_true", help="List ARU stations and exit")
    args = p.parse_args()

    process_all = args.all or PROCESS_ALL_FOLDERS

    with Session(engine) as session:
        # List ARUs
        arus = {a.id: a for a in session.exec(select(ARU).order_by(ARU.id)).all()}

        if args.list_arus:
            for a in arus.values():
                print(f"[{a.id}] {a.name} ({a.lat:.6f}, {a.lon:.6f})")
            return

        if args.clear:
            clear_acoustic_data(session)

        # Discover data folders
        if not DATA_DIR.exists():
            raise RuntimeError(f"Data directory not found: {DATA_DIR}")

        folders = discover_folders(DATA_DIR)
        if not folders:
            raise RuntimeError(f"No valid data folders found in {DATA_DIR}")

        if not process_all:
            folders = folders[:1]

        print(f"\nFolders to process: {len(folders)}")
        for f in folders:
            meta = parse_folder_meta(f.name)
            print(f"  {f.name}  ->  ARU {meta[0]}, {meta[1]}")

        # Configure pipeline (confidence thresholds loaded from app/acoustic_config.py)
        from app.acoustic_config import (
            ANALYSIS_MIN_CONFIDENCE,
            DEFAULT_SAVE_CONFIDENCE,
            SPECIES_CONFIDENCE_OVERRIDES,
        )
        manager = PipelineManager(pipeline_type="birdnet")
        manager.pipeline.year_override = YEAR_OVERRIDE

        print(f"\nConfidence config (from app/acoustic_config.py):")
        print(f"  BirdNET analysis floor: {ANALYSIS_MIN_CONFIDENCE}")
        print(f"  Default save threshold: {DEFAULT_SAVE_CONFIDENCE}")
        for species, thresh in SPECIES_CONFIDENCE_OVERRIDES.items():
            print(f"  {species}: {thresh}")

        total_ok, total_fail = 0, 0

        for folder in folders:
            meta = parse_folder_meta(folder.name)
            if meta is None:
                continue

            aru_num, date_str = meta

            # Apply overrides
            effective_aru = ARU_OVERRIDE if ARU_OVERRIDE is not None else aru_num
            if YEAR_OVERRIDE is not None:
                date_str = str(YEAR_OVERRIDE) + date_str[4:]

            if effective_aru not in arus:
                print(f"\n  SKIP {folder.name} — ARU {effective_aru} not found in DB")
                print(f"  Available ARUs: {list(arus.keys())}")
                continue

            ok, fail = process_folder(session, folder, effective_aru, date_str, manager)
            total_ok += ok
            total_fail += fail

        print(f"\n{'='*60}")
        print(f"DONE — {total_ok} files processed, {total_fail} failed")
        print(f"{'='*60}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
