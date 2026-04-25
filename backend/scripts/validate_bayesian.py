#!/usr/bin/env python3
"""
Bayesian Fusion Validation — Asian Openbill Holdout

Compares V1 (uncorrected) vs V2 (vocalization rate corrected) models.

Usage:
    cd backend
    python scripts/validate_bayesian.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlmodel import Session, select
from app.database import engine
from app.models import Survey, MediaAsset, VisualDetection
from app.bayesian_fusion import bayesian_fusion_report, estimate_vocalization_rates


def extract_openbill_estimate(report):
    """Pull Asian Openbill estimate from a fusion report."""
    white_group = report.get("color_groups", {}).get("white_birds", {})
    estimates = white_group.get("species_estimates", {})
    for sp_name, est in estimates.items():
        if "openbill" in sp_name.lower():
            return est
    return None


def run_single(session, survey, reclassify=True, use_correction=False):
    """Run fusion on one survey and extract openbill results."""
    # Count actual detections
    det_query = (
        select(VisualDetection)
        .join(MediaAsset)
        .where(MediaAsset.survey_id == survey.id)
    )
    all_dets = session.exec(det_query).all()

    actual_openbill = sum(
        1 for d in all_dets
        if (d.corrected_class or d.class_name) == "asian_openbill"
    )
    actual_white = sum(
        1 for d in all_dets
        if (d.corrected_class or d.class_name) == "white_birds"
    )

    if actual_openbill == 0:
        return None

    total_white_after = actual_white + actual_openbill

    report = bayesian_fusion_report(
        session=session,
        visual_survey_id=survey.id,
        reclassify_openbill=reclassify,
        use_vocalization_correction=use_correction,
    )

    est = extract_openbill_estimate(report)
    if est is None:
        return None

    actual_prop = actual_openbill / total_white_after
    ci_covers = est["ci_lower"] <= actual_prop <= est["ci_upper"]

    return {
        "survey_id": survey.id,
        "survey_name": survey.name,
        "actual_openbill": actual_openbill,
        "total_white": total_white_after,
        "actual_proportion": actual_prop,
        "estimated_count": est["count"],
        "estimated_proportion": est["proportion"],
        "ci_lower": est["ci_lower"],
        "ci_upper": est["ci_upper"],
        "abs_error": abs(est["count"] - actual_openbill),
        "pct_error": abs(est["count"] - actual_openbill) / actual_openbill * 100,
        "ci_covers": ci_covers,
        "vocalization_rates": report.get("parameters", {}).get("vocalization_rates"),
    }


def print_results(label, results):
    print(f"\n{'=' * 70}")
    print(f"  {label}")
    print(f"{'=' * 70}\n")

    for r in results:
        ci_status = "COVERS" if r["ci_covers"] else "MISSES"
        print(f"  Survey {r['survey_id']} ({r['survey_name']}):")
        print(f"    White birds (reclassified): {r['total_white']}")
        print(f"    Actual openbills:    {r['actual_openbill']} ({r['actual_proportion']:.1%})")
        print(f"    Estimated openbills: {r['estimated_count']} ({r['estimated_proportion']:.1%})")
        print(f"    95% CI: [{r['ci_lower']:.1%}, {r['ci_upper']:.1%}] — {ci_status}")
        print(f"    Error: {r['abs_error']} birds ({r['pct_error']:.1f}%)")
        print()

    n = len(results)
    mae = sum(r["abs_error"] for r in results) / n
    mape = sum(r["pct_error"] for r in results) / n
    coverage = sum(1 for r in results if r["ci_covers"]) / n * 100
    print(f"  --- Summary ---")
    print(f"  Surveys evaluated:     {n}")
    print(f"  Mean Absolute Error:   {mae:.1f} birds")
    print(f"  Mean % Error:          {mape:.1f}%")
    print(f"  95% CI Coverage:       {coverage:.0f}% (target: 95%)")


def run_validation():
    print("=" * 70)
    print("  BAYESIAN FUSION VALIDATION — Asian Openbill Holdout")
    print("  Comparing V1 (uncorrected) vs V2 (vocalization rate corrected)")
    print("=" * 70)

    with Session(engine) as session:
        surveys = session.exec(
            select(Survey).where(Survey.type == "drone", Survey.status == "completed")
        ).all()

        if not surveys:
            print("No completed drone surveys found.")
            return

        print(f"\nFound {len(surveys)} drone survey(s)")

        # Show vocalization rates estimated from all data
        rates = estimate_vocalization_rates(session)
        if rates:
            print(f"\nEstimated vocalization rate ratios (from all surveys):")
            for sp, r in sorted(rates.items()):
                direction = "over-vocalizes" if r > 1 else "under-vocalizes"
                print(f"    {sp}: {r:.3f} ({direction})")

        v1_results = []
        v2_results = []

        for survey in surveys:
            r1 = run_single(session, survey, reclassify=True, use_correction=False)
            if r1:
                v1_results.append(r1)

            r2 = run_single(session, survey, reclassify=True, use_correction=True)
            if r2:
                v2_results.append(r2)

        if v1_results:
            print_results("V1: UNCORRECTED (raw acoustic proportions)", v1_results)

        if v2_results:
            print_results("V2: VOCALIZATION RATE CORRECTED (leave-one-out CV)", v2_results)

        # Side-by-side comparison
        if v1_results and v2_results:
            print(f"\n{'=' * 70}")
            print(f"  COMPARISON: V1 vs V2")
            print(f"{'=' * 70}\n")
            print(f"  {'Metric':<30} {'V1':>12} {'V2':>12} {'Improvement':>14}")
            print(f"  {'-' * 68}")

            v1_mae = sum(r["abs_error"] for r in v1_results) / len(v1_results)
            v2_mae = sum(r["abs_error"] for r in v2_results) / len(v2_results)
            v1_mape = sum(r["pct_error"] for r in v1_results) / len(v1_results)
            v2_mape = sum(r["pct_error"] for r in v2_results) / len(v2_results)
            v1_cov = sum(1 for r in v1_results if r["ci_covers"]) / len(v1_results) * 100
            v2_cov = sum(1 for r in v2_results if r["ci_covers"]) / len(v2_results) * 100

            print(f"  {'MAE (birds)':<30} {v1_mae:>12.1f} {v2_mae:>12.1f} {((v1_mae - v2_mae) / v1_mae * 100):>+13.1f}%")
            print(f"  {'MAPE (%)':<30} {v1_mape:>12.1f} {v2_mape:>12.1f} {((v1_mape - v2_mape) / v1_mape * 100):>+13.1f}%")
            print(f"  {'95% CI Coverage (%)':<30} {v1_cov:>12.0f} {v2_cov:>12.0f} {(v2_cov - v1_cov):>+13.0f}pp")
            print()


if __name__ == "__main__":
    run_validation()
