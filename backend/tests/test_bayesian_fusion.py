import json
import math
from datetime import datetime

from app.bayesian_fusion import (
    detection_to_latlon,
    haversine_m,
    spatial_weight,
    temporal_weight,
    build_weighted_call_counts,
    compute_species_estimates,
)


# --- detection_to_latlon ---

def test_detection_to_latlon_center():
    """Normalized bbox centered at (0.5, 0.5) should give center lat/lon."""
    lat, lon = detection_to_latlon(
        bbox_json=json.dumps([0.4, 0.4, 0.2, 0.2]),
        lat_tl=11.40, lon_tl=105.39,
        lat_br=11.41, lon_br=105.40,
    )
    assert abs(lat - 11.405) < 0.001
    assert abs(lon - 105.395) < 0.001


def test_detection_to_latlon_top_left():
    """Normalized bbox near (0, 0) should give near top-left coords."""
    lat, lon = detection_to_latlon(
        bbox_json=json.dumps([0.0, 0.0, 0.02, 0.02]),
        lat_tl=11.40, lon_tl=105.39,
        lat_br=11.41, lon_br=105.40,
    )
    assert abs(lat - 11.40) < 0.002
    assert abs(lon - 105.39) < 0.002


# --- haversine ---

def test_haversine_same_point():
    assert haversine_m(11.40, 105.39, 11.40, 105.39) == 0.0


def test_haversine_known_distance():
    d = haversine_m(11.400, 105.390, 11.401, 105.390)
    assert 100 < d < 120


# --- weighting kernels ---

def test_spatial_weight_zero_distance():
    assert spatial_weight(0.0, decay_m=100.0) == 1.0


def test_spatial_weight_decays():
    w1 = spatial_weight(50.0, decay_m=100.0)
    w2 = spatial_weight(200.0, decay_m=100.0)
    assert w1 > w2 > 0


def test_temporal_weight_zero_gap():
    assert temporal_weight(0.0, decay_hours=6.0) == 1.0


def test_temporal_weight_decays():
    w1 = temporal_weight(1.0, decay_hours=6.0)
    w2 = temporal_weight(12.0, decay_hours=6.0)
    assert w1 > w2 > 0


# --- build_weighted_call_counts ---

def test_build_weighted_call_counts_same_location():
    drone_dt = datetime(2026, 3, 1, 17, 0)
    aru_data = [
        {
            "aru_lat": 11.40, "aru_lon": 105.39,
            "detections": [
                {"species": "Cattle Egret", "time": drone_dt},
                {"species": "Asian Openbill", "time": drone_dt},
            ] * 5 + [
                {"species": "Cattle Egret", "time": drone_dt},
            ] * 5,
        }
    ]
    result = build_weighted_call_counts(
        aru_data,
        detection_centroid=(11.40, 105.39),
        drone_survey_datetime=drone_dt,
    )
    # 10 Cattle Egret detections, 5 Asian Openbill, all at same time/place → weight=1.0 each
    assert abs(result["Cattle Egret"] - 10.0) < 0.1
    assert abs(result["Asian Openbill"] - 5.0) < 0.1


def test_build_weighted_call_counts_distance_weights():
    """Closer ARU should contribute more."""
    drone_dt = datetime(2026, 3, 1, 17, 0)
    aru_data = [
        {
            "aru_lat": 11.400, "aru_lon": 105.390,
            "detections": [{"species": "Cattle Egret", "time": drone_dt}] * 10,
        },
        {
            "aru_lat": 11.410, "aru_lon": 105.390,  # ~1.1km away
            "detections": [{"species": "Cattle Egret", "time": drone_dt}] * 100,
        },
    ]
    result = build_weighted_call_counts(
        aru_data,
        detection_centroid=(11.400, 105.390),
        drone_survey_datetime=drone_dt,
    )
    assert result["Cattle Egret"] < 15


# --- compute_species_estimates ---

def test_compute_species_estimates_basic():
    result = compute_species_estimates(
        total_visual_count=100,
        acoustic_call_counts={"Cattle Egret": 60.0, "Asian Openbill": 40.0},
        smoothing=0.5,
    )
    assert "Cattle Egret" in result
    assert "Asian Openbill" in result

    ge = result["Cattle Egret"]
    ao = result["Asian Openbill"]
    assert 0.55 < ge["proportion"] < 0.65
    assert 0.35 < ao["proportion"] < 0.45
    assert ge["count"] + ao["count"] == 100
    assert ge["ci_lower"] < ge["proportion"] < ge["ci_upper"]


def test_compute_species_estimates_single_species():
    result = compute_species_estimates(
        total_visual_count=50,
        acoustic_call_counts={"Cattle Egret": 30.0},
        smoothing=0.5,
    )
    assert result["Cattle Egret"]["count"] == 50
    assert result["Cattle Egret"]["proportion"] > 0.95


def test_compute_species_estimates_no_acoustic():
    result = compute_species_estimates(
        total_visual_count=50,
        acoustic_call_counts={},
        smoothing=0.5,
    )
    assert result == {}


def test_compute_species_estimates_counts_sum_to_total():
    result = compute_species_estimates(
        total_visual_count=73,
        acoustic_call_counts={
            "Cattle Egret": 20.0,
            "Asian Openbill": 15.0,
            "Little Egret": 8.0,
        },
        smoothing=0.5,
    )
    total = sum(r["count"] for r in result.values())
    assert total == 73
