"""
Bayesian Multi-Modal Species Composition Estimation

Fuses drone visual detections (color classes) with acoustic species IDs
using a Dirichlet-Multinomial model with spatial-temporal weighting.

The drone classifies birds by color (white_birds, black_birds, etc.).
Acoustic recorders (ARUs) identify species via BirdNET.
This module estimates species-level composition of each color group
by weighting acoustic evidence by spatial proximity and temporal gap.
"""

import json
import math
from typing import Dict, List, Tuple, Optional, Any
from datetime import datetime

import numpy as np
from scipy.stats import beta as beta_dist
from sqlmodel import Session, select

from .models import Survey, MediaAsset, ARU, VisualDetection, AcousticDetection
from .fusion import get_species_color_mapping


# --- Constants ---
TILE_SIZE = 1280
SPATIAL_DECAY_M = 100.0    # lambda_d: ARU effective radius ~100m
TEMPORAL_DECAY_HOURS = 6.0 # lambda_t: calls within a few hours of drone flight are strongest evidence
DRONE_DEFAULT_HOUR = 17    # assume drone flights at 5pm if no precise time
SMOOTHING = 0.5            # epsilon: Dirichlet smoothing

# Verified species large enough to appear in drone imagery (from Anusha's analysis).
# Only these species are used as candidates in the Bayesian model.
VERIFIED_ACOUSTIC_SPECIES = {
    "white": [
        "Asian Openbill",
        "Black-crowned Night Heron",
        "Cattle Egret",
        "Little Egret",
        "Grey Heron"
    ],
    "black": [
        "Great Cormorant",
    ]
}


# --- Coordinate helpers ---

def detection_to_latlon(
    bbox_json: str,
    lat_tl: float, lon_tl: float,
    lat_br: float, lon_br: float,
) -> Tuple[float, float]:
    """Convert a normalized bbox [x, y, w, h] (values 0-1) to lat/lon via linear interpolation."""
    bbox = json.loads(bbox_json) if isinstance(bbox_json, str) else bbox_json
    x, y, w, h = [float(v) for v in bbox[:4]]
    # bbox values are already normalized (0-1) from YOLO xywhn output
    cx = x + w / 2.0
    cy = y + h / 2.0
    rel_x = min(1.0, max(0.0, cx))
    rel_y = min(1.0, max(0.0, cy))
    lat = lat_tl + rel_y * (lat_br - lat_tl)
    lon = lon_tl + rel_x * (lon_br - lon_tl)
    return (lat, lon)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in meters between two lat/lon points."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# --- Weighting kernels ---

def spatial_weight(distance_m: float, decay_m: float = SPATIAL_DECAY_M) -> float:
    """Exponential decay weight based on distance in meters."""
    return math.exp(-distance_m / decay_m)


def temporal_weight(hours_apart: float, decay_hours: float = TEMPORAL_DECAY_HOURS) -> float:
    """Exponential decay weight based on time gap in hours."""
    return math.exp(-abs(hours_apart) / decay_hours)


# --- Core estimation ---

def build_weighted_call_counts(
    aru_data: List[Dict[str, Any]],
    detection_centroid: Tuple[float, float],
    drone_survey_datetime: datetime,
    decay_m: float = SPATIAL_DECAY_M,
    decay_hours: float = TEMPORAL_DECAY_HOURS,
) -> Dict[str, float]:
    """
    Combine acoustic call counts from multiple ARUs with spatial-temporal weighting.

    Each acoustic detection is individually weighted by its temporal distance
    (in hours) from the drone survey time.

    Args:
        aru_data: list of dicts with aru_lat, aru_lon, detections (list of {species, time})
                  OR legacy format with calls (aggregated counts) and survey_date
        detection_centroid: (lat, lon) centroid of visual detections
        drone_survey_datetime: datetime of drone survey (with time-of-day)
        decay_m: spatial decay parameter
        decay_hours: temporal decay parameter (hours)
    """
    weighted: Dict[str, float] = {}

    for aru in aru_data:
        dist = haversine_m(
            detection_centroid[0], detection_centroid[1],
            aru["aru_lat"], aru["aru_lon"]
        )
        w_s = spatial_weight(dist, decay_m)

        if "detections" in aru:
            # Per-detection temporal weighting (preferred)
            for det in aru["detections"]:
                hours_gap = abs((drone_survey_datetime - det["time"]).total_seconds()) / 3600.0
                w = w_s * temporal_weight(hours_gap, decay_hours)
                sp = det["species"]
                weighted[sp] = weighted.get(sp, 0.0) + w
        else:
            # Legacy: aggregated counts with single survey_date
            hours_gap = abs((drone_survey_datetime - aru["survey_date"]).total_seconds()) / 3600.0
            w = w_s * temporal_weight(hours_gap, decay_hours)
            for species, count in aru["calls"].items():
                weighted[species] = weighted.get(species, 0.0) + count * w

    return weighted


def compute_species_estimates(
    total_visual_count: int,
    acoustic_call_counts: Dict[str, float],
    smoothing: float = SMOOTHING,
    vocalization_rates: Optional[Dict[str, float]] = None,
) -> Dict[str, Dict[str, Any]]:
    """
    Dirichlet estimation of species composition within a color class.

    Args:
        total_visual_count: N birds of this color class seen by drone
        acoustic_call_counts: {species_name: weighted_call_count}
        smoothing: Dirichlet smoothing (epsilon)
        vocalization_rates: {species_name: rate_ratio} — if provided, call counts
            are divided by the rate to correct for vocalization bias.
            r > 1 means species over-vocalizes (scale down), r < 1 means under-vocalizes (scale up).

    Returns:
        {species_name: {proportion, count, ci_lower, ci_upper}}
    """
    if not acoustic_call_counts or total_visual_count == 0:
        return {}

    species = list(acoustic_call_counts.keys())

    # Apply vocalization rate correction: divide call counts by rate
    corrected = []
    for sp in species:
        count = acoustic_call_counts[sp]
        if vocalization_rates and sp in vocalization_rates and vocalization_rates[sp] > 0:
            count = count / vocalization_rates[sp]
        corrected.append(count)

    alphas = np.array([c + smoothing for c in corrected])
    alpha_sum = alphas.sum()

    results = {}
    for i, sp in enumerate(species):
        proportion = float(alphas[i] / alpha_sum)

        # 95% credible interval from Beta marginal
        a = alphas[i]
        b = alpha_sum - alphas[i]
        ci_lower = float(beta_dist.ppf(0.025, a, b))
        ci_upper = float(beta_dist.ppf(0.975, a, b))

        results[sp] = {
            "proportion": proportion,
            "count": round(total_visual_count * proportion),
            "ci_lower": ci_lower,
            "ci_upper": ci_upper,
        }

    # Fix rounding so counts sum to total
    total_assigned = sum(r["count"] for r in results.values())
    if total_assigned != total_visual_count and results:
        top_sp = max(results, key=lambda s: results[s]["proportion"])
        results[top_sp]["count"] += total_visual_count - total_assigned

    return results


def estimate_vocalization_rates(
    colony_id: int,
    session: Session,
    exclude_survey_id: Optional[int] = None,
    ground_truth_class: str = "asian_openbill",
    ground_truth_color: str = "white",
    decay_m: float = SPATIAL_DECAY_M,
    decay_hours: float = TEMPORAL_DECAY_HOURS,
    min_acoustic_confidence: float = 0.0,
) -> Dict[str, float]:
    """
    Estimate per-species vocalization rate ratios from paired drone+acoustic data.

    Uses surveys where ground_truth_class is separately identified by the drone
    to compute the ratio: r_i = acoustic_proportion_i / true_abundance_proportion_i.

    For the ground truth species, r is computed directly.
    For other species in the same color group, a group-level r is computed.

    Args:
        session: DB session
        exclude_survey_id: survey to exclude (for leave-one-out CV)
        ground_truth_class: drone class with known species-level accuracy
        ground_truth_color: which color group the ground truth species belongs to
        decay_m: spatial decay for weighting
        decay_hours: temporal decay for weighting (hours)

    Returns:
        {species_name: vocalization_rate_ratio}
    """
    drone_key = f"{ground_truth_color}_birds"
    verified_species = VERIFIED_ACOUSTIC_SPECIES.get(ground_truth_color, [])

    # Collect paired data across surveys (scoped to this colony only).
    surveys = session.exec(
        select(Survey).where(
            Survey.type == "drone",
            Survey.status == "completed",
            Survey.colony_id == colony_id,
        )
    ).all()

    # Accumulators across surveys
    total_gt_birds = 0       # ground truth species count (from drone)
    total_color_birds = 0    # total color group count (including reclassified gt)
    total_gt_calls = 0.0     # weighted acoustic calls for ground truth species
    total_other_calls = 0.0  # weighted acoustic calls for other species in group

    all_verified = set()
    for sp_list in VERIFIED_ACOUSTIC_SPECIES.values():
        all_verified.update(sp_list)

    # Get all ARUs in this colony only.
    arus = list(session.exec(select(ARU).where(ARU.colony_id == colony_id)).all())

    for survey in surveys:
        if survey.id == exclude_survey_id:
            continue

        # Count drone detections
        vis_query = (
            select(VisualDetection, MediaAsset)
            .join(MediaAsset)
            .where(MediaAsset.survey_id == survey.id)
        )
        rows = session.exec(vis_query).all()

        gt_count = 0
        color_positions = []
        for det, asset in rows:
            if asset.lat_tl is None or asset.lat_br is None:
                continue
            cls = det.corrected_class or det.class_name
            latlon = detection_to_latlon(
                det.bbox_json, asset.lat_tl, asset.lon_tl, asset.lat_br, asset.lon_br
            )
            if cls == ground_truth_class:
                gt_count += 1
                color_positions.append(latlon)
            elif cls == drone_key:
                color_positions.append(latlon)

        if gt_count == 0 or not color_positions:
            continue

        total_color_count = len(color_positions)
        centroid_lat = sum(p[0] for p in color_positions) / len(color_positions)
        centroid_lon = sum(p[1] for p in color_positions) / len(color_positions)
        centroid = (centroid_lat, centroid_lon)

        # Get acoustic data from ARUs (per-detection for hourly temporal weighting)
        drone_dt = datetime.combine(survey.date, datetime.min.time()).replace(hour=DRONE_DEFAULT_HOUR)

        aru_data_list = []
        for aru in arus:
            acoustic_query = (
                select(AcousticDetection, MediaAsset)
                .join(MediaAsset)
                .where(MediaAsset.aru_id == aru.id)
            )
            acoustic_rows = session.exec(acoustic_query).all()

            detections = []
            for adet, aasset in acoustic_rows:
                if adet.confidence < min_acoustic_confidence:
                    continue
                sp = adet.corrected_class or adet.class_name
                if sp not in all_verified:
                    continue
                det_time = adet.absolute_start_time
                if det_time is None and aasset.survey and aasset.survey.date:
                    det_time = datetime.combine(aasset.survey.date, datetime.min.time())
                if det_time is None:
                    continue
                detections.append({"species": sp, "time": det_time})

            if detections:
                aru_data_list.append({
                    "aru_lat": aru.lat, "aru_lon": aru.lon,
                    "detections": detections,
                })

        # Filter to species in this color group and compute weighted calls
        filtered_aru_data = []
        for aru_entry in aru_data_list:
            filtered_dets = [d for d in aru_entry["detections"] if d["species"] in verified_species]
            if filtered_dets:
                filtered_aru_data.append({
                    "aru_lat": aru_entry["aru_lat"], "aru_lon": aru_entry["aru_lon"],
                    "detections": filtered_dets,
                })

        weighted = build_weighted_call_counts(
            filtered_aru_data, centroid, drone_dt, decay_m, decay_hours
        )

        # Find ground truth species in acoustic data (match case-insensitively)
        gt_species_acoustic = None
        for sp in weighted:
            if ground_truth_class.replace("_", " ").lower() in sp.lower():
                gt_species_acoustic = sp
                break

        if gt_species_acoustic is None:
            continue

        gt_weighted_calls = weighted.get(gt_species_acoustic, 0.0)
        other_weighted_calls = sum(c for sp, c in weighted.items() if sp != gt_species_acoustic)

        total_gt_birds += gt_count
        total_color_birds += total_color_count
        total_gt_calls += gt_weighted_calls
        total_other_calls += other_weighted_calls

    # Compute vocalization rate ratios
    if total_color_birds == 0 or (total_gt_calls + total_other_calls) == 0:
        return {}

    gt_true_prop = total_gt_birds / total_color_birds
    other_true_prop = 1.0 - gt_true_prop

    total_calls = total_gt_calls + total_other_calls
    gt_acoustic_prop = total_gt_calls / total_calls
    other_acoustic_prop = total_other_calls / total_calls

    rates = {}

    # Ground truth species rate
    if gt_true_prop > 0:
        # Find the actual species name from acoustic data
        for sp in verified_species:
            if ground_truth_class.replace("_", " ").lower() in sp.lower():
                rates[sp] = gt_acoustic_prop / gt_true_prop
                break

    # Other species in group get a shared group rate
    if other_true_prop > 0:
        other_rate = other_acoustic_prop / other_true_prop
        for sp in verified_species:
            if sp not in rates:
                rates[sp] = other_rate

    return rates


# --- Main report function ---

def bayesian_fusion_report(
    colony_id: int,
    session: Session,
    visual_survey_id: int,
    aru_ids: List[int] = None,
    decay_m: float = SPATIAL_DECAY_M,
    decay_hours: float = TEMPORAL_DECAY_HOURS,
    smoothing: float = SMOOTHING,
    reclassify_openbill: bool = False,
    use_vocalization_correction: bool = False,
    vocalization_rates: Optional[Dict[str, float]] = None,
    min_acoustic_confidence: float = 0.0,
) -> Dict[str, Any]:
    """
    Run Bayesian species composition estimation for a drone survey, scoped to a colony.

    Args:
        colony_id: active colony id (every query is scoped to it)
        session: DB session
        visual_survey_id: drone survey to analyze
        aru_ids: ARU IDs to use (None = all in colony)
        decay_m: spatial decay parameter (meters)
        decay_hours: temporal decay parameter (hours)
        smoothing: Dirichlet smoothing epsilon
        reclassify_openbill: if True, reassign asian_openbill -> white_birds (validation mode)
        use_vocalization_correction: if True, estimate and apply vocalization rate correction
        vocalization_rates: pre-computed rates (if None and correction enabled, will estimate them)
        min_acoustic_confidence: minimum BirdNET confidence to include an acoustic detection
    """
    survey = session.get(Survey, visual_survey_id)
    if not survey or survey.colony_id != colony_id:
        return {"error": "Survey not found"}

    # 1. Get all visual detections with lat/lon — joined to Survey to enforce colony.
    visual_query = (
        select(VisualDetection, MediaAsset)
        .join(MediaAsset, VisualDetection.asset_id == MediaAsset.id)
        .join(Survey, MediaAsset.survey_id == Survey.id)
        .where(
            MediaAsset.survey_id == visual_survey_id,
            Survey.colony_id == colony_id,
        )
    )
    rows = session.exec(visual_query).all()

    detections_by_class: Dict[str, List[Tuple[float, float]]] = {}
    for det, asset in rows:
        if asset.lat_tl is None or asset.lat_br is None:
            continue
        latlon = detection_to_latlon(
            det.bbox_json, asset.lat_tl, asset.lon_tl, asset.lat_br, asset.lon_br
        )
        cls = det.corrected_class or det.class_name

        if reclassify_openbill and cls == "asian_openbill":
            cls = "white_birds"

        detections_by_class.setdefault(cls, []).append(latlon)

    # 2. Get ARUs (within this colony) and their acoustic data.
    if aru_ids:
        arus = [
            a
            for a in (session.get(ARU, aid) for aid in aru_ids)
            if a is not None and a.colony_id == colony_id
        ]
    else:
        arus = list(session.exec(select(ARU).where(ARU.colony_id == colony_id)).all())

    # Build per-ARU detections (only verified species large enough for drone)
    all_verified = set()
    for species_list in VERIFIED_ACOUSTIC_SPECIES.values():
        all_verified.update(species_list)

    drone_dt = datetime.combine(survey.date, datetime.min.time()).replace(hour=DRONE_DEFAULT_HOUR)

    aru_data_list = []
    for aru in arus:
        acoustic_query = (
            select(AcousticDetection, MediaAsset)
            .join(MediaAsset)
            .where(MediaAsset.aru_id == aru.id)
        )
        acoustic_rows = session.exec(acoustic_query).all()

        detections = []
        for adet, aasset in acoustic_rows:
            if adet.confidence < min_acoustic_confidence:
                continue
            sp = adet.corrected_class or adet.class_name
            if sp not in all_verified:
                continue
            det_time = adet.absolute_start_time
            if det_time is None and aasset.survey and aasset.survey.date:
                det_time = datetime.combine(aasset.survey.date, datetime.min.time())
            if det_time is None:
                continue
            detections.append({"species": sp, "time": det_time})

        if detections:
            aru_data_list.append({
                "aru_id": aru.id,
                "aru_name": aru.name,
                "aru_lat": aru.lat,
                "aru_lon": aru.lon,
                "detections": detections,
            })

    # 3. Estimate vocalization rates if requested
    v_rates = vocalization_rates
    if use_vocalization_correction and v_rates is None:
        v_rates = estimate_vocalization_rates(
            colony_id,
            session,
            exclude_survey_id=visual_survey_id,  # leave-one-out
            decay_m=decay_m,
            decay_hours=decay_hours,
            min_acoustic_confidence=min_acoustic_confidence,
        )

    # 4. For each color class, run Bayesian estimation
    color_groups = {}
    for color, verified_species in VERIFIED_ACOUSTIC_SPECIES.items():
        drone_key = f"{color}_birds"
        positions = detections_by_class.get(drone_key, [])
        if not positions:
            continue

        total_count = len(positions)
        centroid_lat = sum(p[0] for p in positions) / len(positions)
        centroid_lon = sum(p[1] for p in positions) / len(positions)
        centroid = (centroid_lat, centroid_lon)

        # Filter ARU detections to only verified species in this color group
        filtered_aru_data = []
        for aru_entry in aru_data_list:
            filtered_dets = [d for d in aru_entry["detections"] if d["species"] in verified_species]
            if filtered_dets:
                filtered_aru_data.append({
                    "aru_lat": aru_entry["aru_lat"], "aru_lon": aru_entry["aru_lon"],
                    "detections": filtered_dets,
                })

        weighted_calls = build_weighted_call_counts(
            filtered_aru_data, centroid, drone_dt, decay_m, decay_hours
        )

        estimates = compute_species_estimates(
            total_count, weighted_calls, smoothing, vocalization_rates=v_rates
        )

        color_groups[drone_key] = {
            "total_count": total_count,
            "centroid": {"lat": centroid_lat, "lon": centroid_lon},
            "species_estimates": estimates,
            "concentration": sum(weighted_calls.values()) + smoothing * len(weighted_calls),
        }

    # 5. Include non-color classes as-is (asian_openbill, black_headed_ibis)
    direct_classes = {}
    for cls, positions in detections_by_class.items():
        if not cls.endswith("_birds"):
            direct_classes[cls] = {"count": len(positions)}

    return {
        "survey_id": visual_survey_id,
        "survey_name": survey.name,
        "survey_date": survey.date.isoformat(),
        "parameters": {
            "spatial_decay_m": decay_m,
            "temporal_decay_hours": decay_hours,
            "smoothing": smoothing,
            "reclassify_openbill": reclassify_openbill,
            "vocalization_correction": use_vocalization_correction,
            "vocalization_rates": v_rates if use_vocalization_correction else None,
        },
        "color_groups": color_groups,
        "direct_classes": direct_classes,
        "aru_count": len(aru_data_list),
    }
