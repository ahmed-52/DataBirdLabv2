#!/usr/bin/env python
"""
LOCAL DEV ONLY: Copy the user's real SQLite DB into the worktree and add the
multi-colony schema overlay (Colony row + colony_id backfill).

This is a SQLite-compatible variant of migrate_to_multi_colony.py — that one
targets Postgres for cutover. This one is a fast path so the user can dogfood
the multi-colony app locally against their actual Boeung Sne data.

Usage:
  cd backend
  venv/bin/python scripts/seed_boeung_sne_local.py
"""
import os
import shutil
import sys
import sqlite3
from pathlib import Path

WORKTREE_DB = Path(__file__).resolve().parent.parent / "data" / "db.sqlite"
SOURCE_DB = Path("/Users/abdulla/Desktop/Labresearch/DataBirdLab/backend/data/db.sqlite")


def normalize_path(p):
    if not p:
        return p
    if "static/" in p:
        return p.split("static/", 1)[1]
    return p.lstrip("/")


def main():
    if not SOURCE_DB.exists():
        print(f"ERROR: source DB not found at {SOURCE_DB}", file=sys.stderr)
        sys.exit(1)

    # 0. Backup the worktree's current DB if it has anything
    if WORKTREE_DB.exists():
        backup = WORKTREE_DB.with_suffix(".sqlite.bak")
        shutil.copy(WORKTREE_DB, backup)
        print(f"backed up existing worktree DB → {backup}")

    # 1. Copy the source DB over the worktree's
    WORKTREE_DB.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(SOURCE_DB, WORKTREE_DB)
    print(f"copied {SOURCE_DB} → {WORKTREE_DB}")

    # 2. Open the worktree DB and apply the multi-colony schema overlay
    conn = sqlite3.connect(WORKTREE_DB)
    cur = conn.cursor()

    # Check whether colony table already exists (idempotency)
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='colony'")
    if cur.fetchone():
        print("colony table already present — assuming previous run, exiting cleanly")
        conn.close()
        return

    # 3. Create colony table (matches new schema)
    print("creating colony table...")
    cur.execute("""
        CREATE TABLE colony (
            id INTEGER PRIMARY KEY,
            slug TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            species_color_mapping TEXT,
            visual_model_path TEXT,
            acoustic_model_path TEXT,
            min_confidence REAL NOT NULL DEFAULT 0.25,
            tile_size INTEGER NOT NULL DEFAULT 1280,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("CREATE UNIQUE INDEX ix_colony_slug ON colony(slug)")

    # 4. Read existing SystemSettings to seed Colony defaults
    cur.execute("SELECT default_lat, default_lon, species_color_mapping, visual_model_path, acoustic_model_path, min_confidence FROM systemsettings WHERE id=1")
    row = cur.fetchone()
    if row:
        lat, lon, scm, vmp, amp, mc = row
    else:
        lat, lon, scm, vmp, amp, mc = 11.406949, 105.394883, None, None, None, 0.25

    # 5. Insert the Boeung Sne colony with id=1
    print(f"seeding boeung-sne colony at ({lat}, {lon})...")
    cur.execute("""
        INSERT INTO colony (id, slug, name, description, lat, lon, species_color_mapping,
                            visual_model_path, acoustic_model_path, min_confidence, tile_size, is_active)
        VALUES (1, 'boeung-sne', 'Boeung Sne', 'Boeung Sne Protected Forest, Cambodia',
                ?, ?, ?, ?, ?, ?, 1280, 1)
    """, (lat, lon, scm, vmp, amp, mc or 0.25))

    # 6. Add colony_id columns to scoped tables. SQLite ALTER TABLE supports ADD COLUMN.
    #    Default to 1 so all existing rows get the boeung-sne colony.
    print("adding colony_id columns + backfilling to colony 1 (boeung-sne)...")
    for table in ("survey", "aru", "calibrationwindow"):
        # Check if column already exists (in case of partial run)
        cur.execute(f"PRAGMA table_info({table})")
        cols = [r[1] for r in cur.fetchall()]
        if "colony_id" not in cols:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN colony_id INTEGER NOT NULL DEFAULT 1 REFERENCES colony(id)")
            cur.execute(f"CREATE INDEX ix_{table}_colony_id ON {table}(colony_id)")
            print(f"  + {table}.colony_id added + indexed")
        else:
            print(f"  · {table}.colony_id already present")

    # 7. Normalize file_path strings (mix of absolute + relative paths)
    print("normalizing mediaasset.file_path values...")
    cur.execute("SELECT id, file_path FROM mediaasset WHERE file_path IS NOT NULL")
    rows = cur.fetchall()
    fixed = 0
    for asset_id, path in rows:
        normalized = normalize_path(path)
        if normalized != path:
            cur.execute("UPDATE mediaasset SET file_path = ? WHERE id = ?", (normalized, asset_id))
            fixed += 1
    print(f"  normalized {fixed}/{len(rows)} paths")

    conn.commit()

    # 8. Verify counts
    print("\nverification:")
    for table in ("colony", "survey", "aru", "mediaasset", "visualdetection", "acousticdetection", "calibrationwindow"):
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        count = cur.fetchone()[0]
        print(f"  {table}: {count}")

    conn.close()
    print("\n✅ done. Local SQLite is now multi-colony-ready with all your Boeung Sne data.")
    print("   Restart the backend to pick up the new schema.")


if __name__ == "__main__":
    main()
