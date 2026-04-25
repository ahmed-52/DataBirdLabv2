import pytest
from sqlmodel import Session, SQLModel, create_engine, select
from app.models import Colony, Survey, ARU, CalibrationWindow


@pytest.fixture
def session():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


def test_create_colony_with_required_fields(session):
    c = Colony(slug="test", name="Test Colony", lat=10.0, lon=20.0)
    session.add(c); session.commit(); session.refresh(c)
    assert c.id is not None
    assert c.is_active is True
    assert c.min_confidence == 0.25
    assert c.tile_size == 1280


def test_unique_slug_constraint(session):
    session.add(Colony(slug="dup", name="A", lat=0, lon=0))
    session.commit()
    session.add(Colony(slug="dup", name="B", lat=1, lon=1))
    with pytest.raises(Exception):  # IntegrityError
        session.commit()


def test_survey_requires_colony_id(session):
    s = Survey(name="orphan", type="drone")
    session.add(s)
    with pytest.raises(Exception):
        session.commit()


def test_aru_requires_colony_id(session):
    a = ARU(name="orphan", lat=0, lon=0)
    session.add(a)
    with pytest.raises(Exception):
        session.commit()


def test_calibrationwindow_requires_colony_id(session):
    c = Colony(slug="x", name="X", lat=0, lon=0); session.add(c); session.commit(); session.refresh(c)
    a_survey = Survey(colony_id=c.id, name="acoustic", type="acoustic"); session.add(a_survey); session.commit(); session.refresh(a_survey)
    v_survey = Survey(colony_id=c.id, name="drone", type="drone"); session.add(v_survey); session.commit(); session.refresh(v_survey)
    aru = ARU(colony_id=c.id, name="aru1", lat=0, lon=0); session.add(aru); session.commit(); session.refresh(aru)

    cw = CalibrationWindow(
        acoustic_survey_id=a_survey.id, visual_survey_id=v_survey.id, aru_id=aru.id,
        days_apart=1, buffer_meters=100.0,
    )
    session.add(cw)
    with pytest.raises(Exception):
        session.commit()


def test_colony_relationships(session):
    c = Colony(slug="r", name="Rel", lat=0, lon=0); session.add(c); session.commit(); session.refresh(c)
    s = Survey(colony_id=c.id, name="s1", type="drone"); session.add(s)
    a = ARU(colony_id=c.id, name="a1", lat=0, lon=0); session.add(a)
    session.commit()
    session.refresh(c)
    assert len(c.surveys) == 1
    assert len(c.arus) == 1


from fastapi import HTTPException
from app.main import get_colony


def test_get_colony_returns_active(session):
    c = Colony(slug="boeung-sne", name="BS", lat=11.4, lon=105.4)
    session.add(c); session.commit(); session.refresh(c)
    result = get_colony("boeung-sne", session)
    assert result.id == c.id


def test_get_colony_404_for_missing(session):
    with pytest.raises(HTTPException) as exc:
        get_colony("nonexistent", session)
    assert exc.value.status_code == 404


def test_get_colony_404_for_soft_deleted(session):
    c = Colony(slug="dead", name="X", lat=0, lon=0, is_active=False)
    session.add(c); session.commit()
    with pytest.raises(HTTPException) as exc:
        get_colony("dead", session)
    assert exc.value.status_code == 404
