from __future__ import annotations

from math import cos, radians
from typing import Any, Dict, List, Tuple
from statistics import median
import re
import numpy as np

from sqlmodel import Session, select, func, delete

from .models import (
    ARU,
    AcousticDetection,
    CalibrationWindow,
    MediaAsset,
    Survey,
    VisualDetection,
)


def _meters_to_lat_degrees(meters: float) -> float:
    return meters / 111_320.0


def _meters_to_lon_degrees(meters: float, lat: float) -> float:
    scale = 111_320.0 * max(0.1, cos(radians(lat)))
    return meters / scale


def _survey_bounds(session: Session, survey_id: int) -> Dict[str, float] | None:
    assets = session.exec(
        select(MediaAsset).where(MediaAsset.survey_id == survey_id)
    ).all()
    if not assets:
        return None

    lats: List[float] = []
    lons: List[float] = []
    for a in assets:
        if None in (a.lat_tl, a.lat_br, a.lon_tl, a.lon_br):
            continue
        lats.extend([a.lat_tl, a.lat_br])
        lons.extend([a.lon_tl, a.lon_br])

    if not lats or not lons:
        return None

    return {
        "min_lat": min(lats),
        "max_lat": max(lats),
        "min_lon": min(lons),
        "max_lon": max(lons),
    }


def _point_in_bounds_with_buffer(
    lat: float, lon: float, bounds: Dict[str, float], buffer_meters: float
) -> bool:
    d_lat = _meters_to_lat_degrees(buffer_meters)
    d_lon = _meters_to_lon_degrees(buffer_meters, lat)
    return (
        bounds["min_lat"] - d_lat <= lat <= bounds["max_lat"] + d_lat
        and bounds["min_lon"] - d_lon <= lon <= bounds["max_lon"] + d_lon
    )


def _compute_area_hectares(bounds: Dict[str, float]) -> float:
    lat_span = max(0.0, bounds["max_lat"] - bounds["min_lat"])
    lon_span = max(0.0, bounds["max_lon"] - bounds["min_lon"])
    mean_lat = (bounds["max_lat"] + bounds["min_lat"]) / 2.0

    meters_per_deg_lat = 111_320.0
    meters_per_deg_lon = 111_320.0 * max(0.1, cos(radians(mean_lat)))

    area_m2 = (lat_span * meters_per_deg_lat) * (lon_span * meters_per_deg_lon)
    return area_m2 / 10_000.0


def _acoustic_metrics(session: Session, acoustic_survey_id: int, aru_id: int) -> Dict[str, float]:
    asset_count = session.exec(
        select(func.count(MediaAsset.id)).where(
            MediaAsset.survey_id == acoustic_survey_id,
            MediaAsset.aru_id == aru_id,
        )
    ).one()

    call_count = session.exec(
        select(func.count(AcousticDetection.id))
        .join(MediaAsset, AcousticDetection.asset_id == MediaAsset.id)
        .where(
            MediaAsset.survey_id == acoustic_survey_id,
            MediaAsset.aru_id == aru_id,
        )
    ).one()

    calls_per_asset = (call_count / asset_count) if asset_count else 0.0
    return {
        "acoustic_call_count": int(call_count or 0),
        "acoustic_asset_count": int(asset_count or 0),
        "acoustic_calls_per_asset": float(calls_per_asset),
    }


def _drone_metrics(session: Session, visual_survey_id: int) -> Dict[str, float]:
    det_count = session.exec(
        select(func.count(VisualDetection.id))
        .join(MediaAsset, VisualDetection.asset_id == MediaAsset.id)
        .where(MediaAsset.survey_id == visual_survey_id)
    ).one()

    bounds = _survey_bounds(session, visual_survey_id)
    if not bounds:
        return {
            "drone_detection_count": int(det_count or 0),
            "drone_area_hectares": 0.0,
            "drone_density_per_hectare": 0.0,
        }

    area_ha = _compute_area_hectares(bounds)
    density = (det_count / area_ha) if area_ha > 0 else 0.0
    return {
        "drone_detection_count": int(det_count or 0),
        "drone_area_hectares": float(area_ha),
        "drone_density_per_hectare": float(density),
    }


def rebuild_calibration_windows(
    session: Session,
    max_days_apart: int = 14,
    buffer_meters: float = 150.0,
    min_acoustic_calls: int = 1,
) -> Dict[str, Any]:
    session.exec(delete(CalibrationWindow))
    session.commit()

    acoustic_surveys = session.exec(
        select(Survey).where(Survey.type == "acoustic")
    ).all()
    drone_surveys = session.exec(
        select(Survey).where(Survey.type == "drone")
    ).all()

    created = 0
    skipped = 0

    for acoustic in acoustic_surveys:
        aru_ids = session.exec(
            select(func.distinct(MediaAsset.aru_id)).where(
                MediaAsset.survey_id == acoustic.id,
                MediaAsset.aru_id.is_not(None),
            )
        ).all()

        for aru_id in [a for a in aru_ids if a is not None]:
            aru = session.get(ARU, aru_id)
            if not aru:
                skipped += 1
                continue

            acoustic_m = _acoustic_metrics(session, acoustic.id, aru_id)
            if acoustic_m["acoustic_call_count"] < min_acoustic_calls:
                skipped += 1
                continue

            for drone in drone_surveys:
                if not drone.date or not acoustic.date:
                    skipped += 1
                    continue
                days_apart = abs((drone.date.date() - acoustic.date.date()).days)
                if days_apart > max_days_apart:
                    continue

                bounds = _survey_bounds(session, drone.id)
                if not bounds:
                    skipped += 1
                    continue

                if not _point_in_bounds_with_buffer(
                    aru.lat, aru.lon, bounds, buffer_meters
                ):
                    continue

                drone_m = _drone_metrics(session, drone.id)
                if drone_m["drone_area_hectares"] <= 0:
                    skipped += 1
                    continue

                row = CalibrationWindow(
                    acoustic_survey_id=acoustic.id,
                    visual_survey_id=drone.id,
                    aru_id=aru_id,
                    days_apart=days_apart,
                    buffer_meters=buffer_meters,
                    acoustic_call_count=acoustic_m["acoustic_call_count"],
                    acoustic_asset_count=acoustic_m["acoustic_asset_count"],
                    acoustic_calls_per_asset=acoustic_m["acoustic_calls_per_asset"],
                    drone_detection_count=drone_m["drone_detection_count"],
                    drone_area_hectares=drone_m["drone_area_hectares"],
                    drone_density_per_hectare=drone_m["drone_density_per_hectare"],
                )
                session.add(row)
                created += 1

    session.commit()

    return {
        "created_windows": created,
        "skipped_candidates": skipped,
        "max_days_apart": max_days_apart,
        "buffer_meters": buffer_meters,
        "min_acoustic_calls": min_acoustic_calls,
    }


def list_calibration_windows(
    session: Session,
    min_calls: int = 0,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    rows = session.exec(
        select(CalibrationWindow)
        .where(CalibrationWindow.acoustic_call_count >= min_calls)
        .order_by(CalibrationWindow.days_apart.asc(), CalibrationWindow.id.desc())
        .limit(limit)
    ).all()

    data: List[Dict[str, Any]] = []
    for r in rows:
        data.append(
            {
                "id": r.id,
                "acoustic_survey_id": r.acoustic_survey_id,
                "visual_survey_id": r.visual_survey_id,
                "aru_id": r.aru_id,
                "days_apart": r.days_apart,
                "buffer_meters": r.buffer_meters,
                "acoustic_call_count": r.acoustic_call_count,
                "acoustic_asset_count": r.acoustic_asset_count,
                "acoustic_calls_per_asset": r.acoustic_calls_per_asset,
                "drone_detection_count": r.drone_detection_count,
                "drone_area_hectares": r.drone_area_hectares,
                "drone_density_per_hectare": r.drone_density_per_hectare,
                "created_at": r.created_at,
            }
        )

    return data


def calibration_curve_summary(
    session: Session, min_calls: int = 1
) -> Dict[str, Any]:
    rows = session.exec(
        select(CalibrationWindow).where(CalibrationWindow.acoustic_call_count >= min_calls)
    ).all()

    if not rows:
        return {
            "window_count": 0,
            "message": "No calibration windows available. Rebuild windows first.",
        }

    ratios: List[float] = []
    pairs: List[Dict[str, float]] = []
    for r in rows:
        x = r.acoustic_calls_per_asset
        y = r.drone_density_per_hectare
        if x > 0 and y >= 0:
            ratios.append(y / x)
            pairs.append({"x_calls_per_asset": x, "y_density_per_ha": y})

    if not ratios:
        return {
            "window_count": len(rows),
            "usable_count": 0,
            "message": "No windows with positive acoustic call rate to calibrate.",
        }

    factor = median(ratios)
    return {
        "window_count": len(rows),
        "usable_count": len(ratios),
        "simple_factor_density_per_call_per_asset": factor,
        "notes": "MVP calibration factor (median(y/x)); replace with stronger model later.",
        "sample_pairs": pairs[:50],
    }


def _safe_feature_name(name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", name.strip().lower()).strip("_")
    return f"sp_{slug or 'unknown'}_calls_per_hour"


def _window_effort_hours(session: Session, acoustic_survey_id: int, aru_id: int) -> float:
    assets = session.exec(
        select(MediaAsset).where(
            MediaAsset.survey_id == acoustic_survey_id,
            MediaAsset.aru_id == aru_id,
        )
    ).all()
    if not assets:
        return 0.0

    total_seconds = 0.0
    for asset in assets:
        max_end = session.exec(
            select(func.max(AcousticDetection.end_time)).where(
                AcousticDetection.asset_id == asset.id
            )
        ).one()
        # Fallback for files with no detections: assume 5 minutes to avoid divide-by-zero.
        total_seconds += float(max_end or 300.0)

    return max(0.0, total_seconds / 3600.0)


def _window_species_counts(session: Session, acoustic_survey_id: int, aru_id: int) -> Dict[str, int]:
    rows = session.exec(
        select(AcousticDetection.class_name, func.count(AcousticDetection.id))
        .join(MediaAsset, AcousticDetection.asset_id == MediaAsset.id)
        .where(
            MediaAsset.survey_id == acoustic_survey_id,
            MediaAsset.aru_id == aru_id,
        )
        .group_by(AcousticDetection.class_name)
    ).all()
    return {name: int(count) for name, count in rows}


def _top_species_for_windows(
    session: Session, windows: List[CalibrationWindow], top_species: int
) -> List[str]:
    agg: Dict[str, int] = {}
    for w in windows:
        species_counts = _window_species_counts(session, w.acoustic_survey_id, w.aru_id)
        for sp, c in species_counts.items():
            agg[sp] = agg.get(sp, 0) + c

    ranked = sorted(agg.items(), key=lambda x: x[1], reverse=True)
    return [name for name, _ in ranked[:top_species]]


def build_calibration_feature_rows(
    session: Session,
    min_calls: int = 1,
    top_species: int = 5,
) -> Dict[str, Any]:
    windows = session.exec(
        select(CalibrationWindow).where(CalibrationWindow.acoustic_call_count >= min_calls)
    ).all()
    if not windows:
        return {"rows": [], "feature_names": [], "species_features": []}

    species = _top_species_for_windows(session, windows, top_species=top_species)
    species_feature_names = [_safe_feature_name(sp) for sp in species]
    feature_names = ["calls_per_hour", "calls_per_asset"] + species_feature_names

    rows: List[Dict[str, Any]] = []
    for w in windows:
        effort_h = _window_effort_hours(session, w.acoustic_survey_id, w.aru_id)
        if effort_h <= 0:
            effort_h = max(1.0 / 12.0, w.acoustic_asset_count * (5.0 / 60.0))

        sp_counts = _window_species_counts(session, w.acoustic_survey_id, w.aru_id)
        feature_map: Dict[str, float] = {
            "calls_per_hour": float(w.acoustic_call_count / effort_h) if effort_h > 0 else 0.0,
            "calls_per_asset": float(w.acoustic_calls_per_asset),
        }
        for sp, f_name in zip(species, species_feature_names):
            feature_map[f_name] = float(sp_counts.get(sp, 0) / effort_h) if effort_h > 0 else 0.0

        rows.append(
            {
                "window_id": w.id,
                "acoustic_survey_id": w.acoustic_survey_id,
                "visual_survey_id": w.visual_survey_id,
                "aru_id": w.aru_id,
                "days_apart": w.days_apart,
                "target_density_per_hectare": float(w.drone_density_per_hectare),
                "effort_hours_estimated": float(effort_h),
                "features": feature_map,
            }
        )

    return {
        "rows": rows,
        "feature_names": feature_names,
        "species_features": species,
    }


def _matrix_from_rows(
    rows: List[Dict[str, Any]], feature_names: List[str]
) -> Tuple[np.ndarray, np.ndarray]:
    X = []
    y = []
    for r in rows:
        X.append([float(r["features"].get(name, 0.0)) for name in feature_names])
        y.append(float(r["target_density_per_hectare"]))
    return np.array(X, dtype=float), np.array(y, dtype=float)


def _fit_linear_model(X: np.ndarray, y: np.ndarray) -> Dict[str, Any]:
    if X.size == 0:
        return {"intercept": 0.0, "coef": []}
    X_aug = np.hstack([np.ones((X.shape[0], 1)), X])
    beta, *_ = np.linalg.lstsq(X_aug, y, rcond=None)
    return {"intercept": float(beta[0]), "coef": [float(v) for v in beta[1:]]}


def _predict_linear(model: Dict[str, Any], X: np.ndarray) -> np.ndarray:
    coef = np.array(model.get("coef", []), dtype=float)
    if X.size == 0:
        return np.array([], dtype=float)
    return model.get("intercept", 0.0) + X.dot(coef)


def _fit_quadratic_total_call_model(X: np.ndarray, y: np.ndarray) -> Dict[str, Any]:
    if X.size == 0:
        return {"a0": 0.0, "a1": 0.0, "a2": 0.0}
    x = X[:, 0]  # calls_per_hour
    Q = np.column_stack([np.ones_like(x), x, x * x])
    beta, *_ = np.linalg.lstsq(Q, y, rcond=None)
    return {"a0": float(beta[0]), "a1": float(beta[1]), "a2": float(beta[2])}


def _predict_quadratic_total_call(model: Dict[str, Any], X: np.ndarray) -> np.ndarray:
    if X.size == 0:
        return np.array([], dtype=float)
    x = X[:, 0]
    return model["a0"] + model["a1"] * x + model["a2"] * (x * x)


def _metrics(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
    if y_true.size == 0:
        return {"rmse": 0.0, "mae": 0.0, "r2": 0.0}
    err = y_pred - y_true
    rmse = float(np.sqrt(np.mean(err ** 2)))
    mae = float(np.mean(np.abs(err)))
    denom = float(np.sum((y_true - np.mean(y_true)) ** 2))
    r2 = float(1.0 - (np.sum(err ** 2) / denom)) if denom > 0 else 0.0
    return {"rmse": rmse, "mae": mae, "r2": r2}


def calibration_backtest_report(
    session: Session,
    min_calls: int = 1,
    top_species: int = 5,
) -> Dict[str, Any]:
    data = build_calibration_feature_rows(
        session=session, min_calls=min_calls, top_species=top_species
    )
    rows = data["rows"]
    feature_names = data["feature_names"]
    if len(rows) < 3:
        return {
            "window_count": len(rows),
            "message": "Not enough windows for grouped backtest (need >= 3).",
            "feature_names": feature_names,
            "folds": [],
        }

    groups = sorted(set(r["visual_survey_id"] for r in rows))
    if len(groups) < 2:
        return {
            "window_count": len(rows),
            "message": "Need at least 2 drone surveys for grouped backtest.",
            "feature_names": feature_names,
            "folds": [],
        }

    folds = []
    agg_true_linear: List[float] = []
    agg_pred_linear: List[float] = []
    agg_true_quad: List[float] = []
    agg_pred_quad: List[float] = []

    for g in groups:
        train_rows = [r for r in rows if r["visual_survey_id"] != g]
        test_rows = [r for r in rows if r["visual_survey_id"] == g]
        if not train_rows or not test_rows:
            continue

        X_train, y_train = _matrix_from_rows(train_rows, feature_names)
        X_test, y_test = _matrix_from_rows(test_rows, feature_names)

        linear_model = _fit_linear_model(X_train, y_train)
        quad_model = _fit_quadratic_total_call_model(X_train, y_train)

        yhat_linear = _predict_linear(linear_model, X_test)
        yhat_quad = _predict_quadratic_total_call(quad_model, X_test)

        m_linear = _metrics(y_test, yhat_linear)
        m_quad = _metrics(y_test, yhat_quad)

        agg_true_linear.extend(y_test.tolist())
        agg_pred_linear.extend(yhat_linear.tolist())
        agg_true_quad.extend(y_test.tolist())
        agg_pred_quad.extend(yhat_quad.tolist())

        folds.append(
            {
                "held_out_visual_survey_id": g,
                "train_windows": len(train_rows),
                "test_windows": len(test_rows),
                "linear_metrics": m_linear,
                "quadratic_metrics": m_quad,
            }
        )

    linear_overall = _metrics(
        np.array(agg_true_linear, dtype=float),
        np.array(agg_pred_linear, dtype=float),
    )
    quadratic_overall = _metrics(
        np.array(agg_true_quad, dtype=float),
        np.array(agg_pred_quad, dtype=float),
    )

    recommended_model = (
        "quadratic" if quadratic_overall["rmse"] < linear_overall["rmse"] else "linear"
    )

    return {
        "window_count": len(rows),
        "feature_names": feature_names,
        "species_features": data["species_features"],
        "folds": folds,
        "overall": {
            "linear": linear_overall,
            "quadratic": quadratic_overall,
            "recommended_model": recommended_model,
        },
    }


def calibration_train_summary(
    session: Session,
    min_calls: int = 1,
    top_species: int = 5,
) -> Dict[str, Any]:
    data = build_calibration_feature_rows(
        session=session, min_calls=min_calls, top_species=top_species
    )
    rows = data["rows"]
    feature_names = data["feature_names"]
    if not rows:
        return {"window_count": 0, "message": "No windows available for training."}

    X, y = _matrix_from_rows(rows, feature_names)
    linear_model = _fit_linear_model(X, y)
    quad_model = _fit_quadratic_total_call_model(X, y)

    yhat_linear = _predict_linear(linear_model, X)
    yhat_quad = _predict_quadratic_total_call(quad_model, X)
    linear_metrics = _metrics(y, yhat_linear)
    quad_metrics = _metrics(y, yhat_quad)

    recommended_model = "quadratic" if quad_metrics["rmse"] < linear_metrics["rmse"] else "linear"

    residuals = (yhat_linear - y) if recommended_model == "linear" else (yhat_quad - y)
    resid_std = float(np.std(residuals)) if residuals.size > 1 else 0.0

    return {
        "window_count": len(rows),
        "feature_names": feature_names,
        "species_features": data["species_features"],
        "linear_model": linear_model,
        "quadratic_model": quad_model,
        "linear_metrics_train": linear_metrics,
        "quadratic_metrics_train": quad_metrics,
        "recommended_model": recommended_model,
        "residual_std_density_per_hectare": resid_std,
    }


def calibration_predict_density(
    session: Session,
    acoustic_survey_id: int,
    aru_id: int,
    model: str = "best",
    min_calls: int = 1,
    top_species: int = 5,
) -> Dict[str, Any]:
    train = calibration_train_summary(
        session=session, min_calls=min_calls, top_species=top_species
    )
    if train.get("window_count", 0) == 0:
        return {"message": "No calibration windows available for prediction."}

    data = build_calibration_feature_rows(
        session=session, min_calls=min_calls, top_species=top_species
    )
    feature_names = data["feature_names"]
    species = data["species_features"]
    effort_h = _window_effort_hours(session, acoustic_survey_id, aru_id)
    if effort_h <= 0:
        effort_h = 1.0 / 12.0

    counts = _window_species_counts(session, acoustic_survey_id, aru_id)
    total_calls = int(sum(counts.values()))
    assets = session.exec(
        select(func.count(MediaAsset.id)).where(
            MediaAsset.survey_id == acoustic_survey_id,
            MediaAsset.aru_id == aru_id,
        )
    ).one()
    calls_per_asset = float(total_calls / assets) if assets else 0.0

    feat = {"calls_per_hour": float(total_calls / effort_h), "calls_per_asset": calls_per_asset}
    for sp in species:
        feat[_safe_feature_name(sp)] = float(counts.get(sp, 0) / effort_h)

    X = np.array([[float(feat.get(name, 0.0)) for name in feature_names]], dtype=float)

    model_name = model
    if model == "best":
        model_name = train["recommended_model"]

    if model_name == "quadratic":
        pred = float(_predict_quadratic_total_call(train["quadratic_model"], X)[0])
    else:
        pred = float(_predict_linear(train["linear_model"], X)[0])
        model_name = "linear"

    resid_std = float(train.get("residual_std_density_per_hectare", 0.0))
    return {
        "acoustic_survey_id": acoustic_survey_id,
        "aru_id": aru_id,
        "model_used": model_name,
        "estimated_density_per_hectare": max(0.0, pred),
        "prediction_interval_approx": {
            "low": max(0.0, pred - 1.96 * resid_std),
            "high": max(0.0, pred + 1.96 * resid_std),
        },
        "features": feat,
        "effort_hours_estimated": effort_h,
        "training_window_count": train.get("window_count", 0),
    }
