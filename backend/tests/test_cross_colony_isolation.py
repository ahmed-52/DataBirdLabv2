"""
Critical regression test: cross-colony data bleed across all scoped endpoints.

We seed two independent colonies (colony-a and colony-b) with disjoint
Survey/ARU/MediaAsset/Visual+Acoustic detections, then hit each scoped
endpoint with both colony slugs and assert no data from the other colony
ever leaks through. Auth is bypassed via dependency_overrides so this
test focuses purely on the colony scoping in the service layer.
"""

import pytest
from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.main import app, get_session
from app.auth import get_current_user
from app.models import (
    Colony,
    Survey,
    ARU,
    MediaAsset,
    VisualDetection,
    AcousticDetection,
)


SCOPED_ENDPOINTS = [
    "/api/surveys",
    "/api/arus",
    "/api/stats/daily?days=365",
    "/api/stats/acoustic?days=365",
    "/api/stats/species?days=365",
    "/api/stats/overview?days=365",
    "/api/detections/visual?days=365",
    "/api/detections/acoustic?days=365",
    "/api/species_list",
]


@pytest.fixture(scope="module")
def test_engine():
    """Module-scoped in-memory SQLite engine, shared across the test class.

    Uses StaticPool so every connection in the test sees the same in-memory DB
    (otherwise each new connection gets a fresh, empty memory DB).
    """
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


@pytest.fixture(scope="module", autouse=True)
def seed_two_colonies(test_engine):
    """Seed two completely disjoint colonies with overlapping species names so
    a missing scope filter would visibly bleed data."""
    with Session(test_engine) as s:
        colony_a = Colony(slug="colony-a", name="Colony A", lat=10.0, lon=20.0)
        colony_b = Colony(slug="colony-b", name="Colony B", lat=30.0, lon=40.0)
        s.add(colony_a)
        s.add(colony_b)
        s.commit()
        s.refresh(colony_a)
        s.refresh(colony_b)

        recent_date = datetime.now() - timedelta(days=1)

        # Colony A: 1 drone survey, 1 acoustic survey, 1 ARU, detections only-in-A.
        survey_a_drone = Survey(
            colony_id=colony_a.id,
            name="A drone",
            type="drone",
            date=recent_date,
            status="completed",
        )
        survey_a_acoustic = Survey(
            colony_id=colony_a.id,
            name="A acoustic",
            type="acoustic",
            date=recent_date,
            status="completed",
        )
        s.add(survey_a_drone)
        s.add(survey_a_acoustic)
        s.commit()
        s.refresh(survey_a_drone)
        s.refresh(survey_a_acoustic)

        aru_a = ARU(colony_id=colony_a.id, name="A-ARU-1", lat=10.1, lon=20.1)
        s.add(aru_a)
        s.commit()
        s.refresh(aru_a)

        asset_a_drone = MediaAsset(
            survey_id=survey_a_drone.id,
            file_path="a/drone.tif",
            lat_tl=10.0,
            lon_tl=20.0,
            lat_br=10.2,
            lon_br=20.2,
            is_processed=True,
        )
        asset_a_acoustic = MediaAsset(
            survey_id=survey_a_acoustic.id,
            file_path="a/audio.wav",
            aru_id=aru_a.id,
            lat_tl=10.1,
            lon_tl=20.1,
            is_processed=True,
        )
        s.add(asset_a_drone)
        s.add(asset_a_acoustic)
        s.commit()
        s.refresh(asset_a_drone)
        s.refresh(asset_a_acoustic)

        s.add(
            VisualDetection(
                asset_id=asset_a_drone.id,
                class_name="ONLY_IN_A_visual",
                confidence=0.9,
                bbox_json="[0.5,0.5,0.1,0.1]",
            )
        )
        s.add(
            AcousticDetection(
                asset_id=asset_a_acoustic.id,
                class_name="ONLY_IN_A_acoustic",
                confidence=0.9,
                start_time=1.0,
                end_time=2.0,
            )
        )

        # Colony B: separate surveys / ARU / detections.
        survey_b_drone = Survey(
            colony_id=colony_b.id,
            name="B drone",
            type="drone",
            date=recent_date,
            status="completed",
        )
        survey_b_acoustic = Survey(
            colony_id=colony_b.id,
            name="B acoustic",
            type="acoustic",
            date=recent_date,
            status="completed",
        )
        s.add(survey_b_drone)
        s.add(survey_b_acoustic)
        s.commit()
        s.refresh(survey_b_drone)
        s.refresh(survey_b_acoustic)

        aru_b = ARU(colony_id=colony_b.id, name="B-ARU-1", lat=30.1, lon=40.1)
        s.add(aru_b)
        s.commit()
        s.refresh(aru_b)

        asset_b_drone = MediaAsset(
            survey_id=survey_b_drone.id,
            file_path="b/drone.tif",
            lat_tl=30.0,
            lon_tl=40.0,
            lat_br=30.2,
            lon_br=40.2,
            is_processed=True,
        )
        asset_b_acoustic = MediaAsset(
            survey_id=survey_b_acoustic.id,
            file_path="b/audio.wav",
            aru_id=aru_b.id,
            lat_tl=30.1,
            lon_tl=40.1,
            is_processed=True,
        )
        s.add(asset_b_drone)
        s.add(asset_b_acoustic)
        s.commit()
        s.refresh(asset_b_drone)
        s.refresh(asset_b_acoustic)

        s.add(
            VisualDetection(
                asset_id=asset_b_drone.id,
                class_name="ONLY_IN_B_visual",
                confidence=0.9,
                bbox_json="[0.5,0.5,0.1,0.1]",
            )
        )
        s.add(
            AcousticDetection(
                asset_id=asset_b_acoustic.id,
                class_name="ONLY_IN_B_acoustic",
                confidence=0.9,
                start_time=1.0,
                end_time=2.0,
            )
        )
        s.commit()


@pytest.fixture(scope="module")
def client(test_engine):
    """TestClient that uses the seeded in-memory engine and bypasses auth."""

    def _get_session_override():
        with Session(test_engine) as s:
            yield s

    # get_colony itself depends on get_session, so once we override get_session,
    # get_colony will resolve against our test database transparently.
    app.dependency_overrides[get_session] = _get_session_override
    app.dependency_overrides[get_current_user] = lambda: {"sub": "test-user"}

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()


def _flatten(obj):
    """Recursively flatten any JSON-shaped value to a single string for substring search."""
    import json as _json
    return _json.dumps(obj, default=str)


@pytest.mark.parametrize("endpoint", SCOPED_ENDPOINTS)
def test_no_cross_colony_bleed(client, endpoint):
    """Hitting an endpoint with colony-a must never expose colony-b data, and vice versa."""
    sep = "&" if "?" in endpoint else "?"

    # Colony A: must contain ONLY_IN_A_* tokens or be empty; must NEVER contain ONLY_IN_B_*.
    res_a = client.get(f"{endpoint}{sep}colony_slug=colony-a")
    assert res_a.status_code == 200, f"colony-a {endpoint}: {res_a.status_code} {res_a.text}"
    body_a = _flatten(res_a.json())
    assert "ONLY_IN_B_visual" not in body_a, f"colony-a leaked B visual at {endpoint}: {body_a}"
    assert "ONLY_IN_B_acoustic" not in body_a, f"colony-a leaked B acoustic at {endpoint}: {body_a}"
    assert "B-ARU-1" not in body_a, f"colony-a leaked B ARU at {endpoint}: {body_a}"
    assert "B drone" not in body_a, f"colony-a leaked B drone survey at {endpoint}: {body_a}"
    assert "B acoustic" not in body_a, f"colony-a leaked B acoustic survey at {endpoint}: {body_a}"

    # Colony B: must contain ONLY_IN_B_* tokens or be empty; must NEVER contain ONLY_IN_A_*.
    res_b = client.get(f"{endpoint}{sep}colony_slug=colony-b")
    assert res_b.status_code == 200, f"colony-b {endpoint}: {res_b.status_code} {res_b.text}"
    body_b = _flatten(res_b.json())
    assert "ONLY_IN_A_visual" not in body_b, f"colony-b leaked A visual at {endpoint}: {body_b}"
    assert "ONLY_IN_A_acoustic" not in body_b, f"colony-b leaked A acoustic at {endpoint}: {body_b}"
    assert "A-ARU-1" not in body_b, f"colony-b leaked A ARU at {endpoint}: {body_b}"
    assert "A drone" not in body_b, f"colony-b leaked A drone survey at {endpoint}: {body_b}"
    assert "A acoustic" not in body_b, f"colony-b leaked A acoustic survey at {endpoint}: {body_b}"
