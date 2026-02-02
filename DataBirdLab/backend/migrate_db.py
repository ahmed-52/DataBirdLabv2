import sqlite3
from pathlib import Path

# Path relative to backend root
DB_PATH = Path("data/db.sqlite")

def migrate():
    if not DB_PATH.exists():
        print(f"Database not found at {DB_PATH}. Skipping migration.")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    print("Migrating Survey table...")
    try:
        cursor.execute("ALTER TABLE survey ADD COLUMN status TEXT DEFAULT 'pending'")
        print("  Added 'status' column to survey")
    except sqlite3.OperationalError as e:
        print(f"  Skipping survey.status: {e}")

    try:
        cursor.execute("ALTER TABLE survey ADD COLUMN error_message TEXT")
        print("  Added 'error_message' column to survey")
    except sqlite3.OperationalError as e:
        print(f"  Skipping survey.error_message: {e}")

    print("Migrating MediaAsset table...")
    try:
        cursor.execute("ALTER TABLE mediaasset ADD COLUMN status TEXT DEFAULT 'pending'")
        print("  Added 'status' column to mediaasset")
    except sqlite3.OperationalError as e:
        print(f"  Skipping mediaasset.status: {e}")

    try:
        cursor.execute("ALTER TABLE mediaasset ADD COLUMN error_message TEXT")
        print("  Added 'error_message' column to mediaasset")
    except sqlite3.OperationalError as e:
        print(f"  Skipping mediaasset.error_message: {e}")

    conn.commit()
    conn.close()
    print("Migration complete.")

if __name__ == "__main__":
    migrate()
