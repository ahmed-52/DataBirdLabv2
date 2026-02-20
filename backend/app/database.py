from sqlmodel import create_engine, SQLModel
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
sqlite_file_name = BASE_DIR / "data" / "db.sqlite"
sqlite_url = f"sqlite:///{sqlite_file_name}"

engine = create_engine(sqlite_url, echo=False)

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)

