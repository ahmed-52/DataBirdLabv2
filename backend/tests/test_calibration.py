import unittest
from datetime import datetime

from sqlmodel import Session, SQLModel, create_engine

from app.calibration import (
    calibration_backtest_report,
    calibration_predict_density,
    calibration_curve_summary,
    list_calibration_windows,
    rebuild_calibration_windows,
)
from app.models import ARU, AcousticDetection, Colony, MediaAsset, Survey, VisualDetection


class CalibrationWindowsTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(self.engine)
        # Create a Colony — every Survey/ARU/CalibrationWindow needs one.
        with Session(self.engine) as s:
            colony = Colony(slug="test-colony", name="Test Colony", lat=11.4, lon=105.4)
            s.add(colony)
            s.commit()
            s.refresh(colony)
            self.colony_id = colony.id

    def _seed_overlap_case(self):
        with Session(self.engine) as s:
            aru = ARU(colony_id=self.colony_id, name="ARU-1", lat=11.405, lon=105.395)
            s.add(aru)
            s.commit()
            s.refresh(aru)

            acoustic = Survey(
                colony_id=self.colony_id,
                name="Acoustic A",
                type="acoustic",
                date=datetime(2025, 2, 5, 6, 0, 0),
                status="completed",
            )
            drone = Survey(
                colony_id=self.colony_id,
                name="Drone A",
                type="drone",
                date=datetime(2025, 2, 8, 7, 0, 0),
                status="completed",
            )
            s.add(acoustic)
            s.add(drone)
            s.commit()
            s.refresh(acoustic)
            s.refresh(drone)

            acoustic_asset = MediaAsset(
                survey_id=acoustic.id,
                file_path="static/uploads/survey_a/audio.wav",
                aru_id=aru.id,
                lat_tl=aru.lat,
                lon_tl=aru.lon,
                is_processed=True,
                is_validated=False,
            )
            s.add(acoustic_asset)
            s.commit()
            s.refresh(acoustic_asset)

            s.add(
                AcousticDetection(
                    asset_id=acoustic_asset.id,
                    class_name="Great Egret",
                    confidence=0.9,
                    start_time=1.0,
                    end_time=2.0,
                )
            )
            s.add(
                AcousticDetection(
                    asset_id=acoustic_asset.id,
                    class_name="Great Egret",
                    confidence=0.8,
                    start_time=3.0,
                    end_time=4.0,
                )
            )

            drone_asset = MediaAsset(
                survey_id=drone.id,
                file_path="static/tiles/1/tile_0_0.jpg",
                lat_tl=11.404,
                lon_tl=105.394,
                lat_br=11.406,
                lon_br=105.396,
                is_processed=True,
                is_validated=False,
            )
            s.add(drone_asset)
            s.commit()
            s.refresh(drone_asset)

            s.add(
                VisualDetection(
                    asset_id=drone_asset.id,
                    confidence=0.85,
                    class_name="white_birds",
                    bbox_json="[0.5,0.5,0.1,0.1]",
                )
            )
            s.commit()

    def test_rebuild_windows_creates_paired_window(self):
        self._seed_overlap_case()
        with Session(self.engine) as s:
            out = rebuild_calibration_windows(
                colony_id=self.colony_id,
                session=s,
                max_days_apart=14,
                buffer_meters=200.0,
                min_acoustic_calls=1,
            )
            self.assertEqual(out["created_windows"], 1)

            rows = list_calibration_windows(
                colony_id=self.colony_id, session=s, min_calls=1, limit=10
            )
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["acoustic_call_count"], 2)
            self.assertEqual(rows[0]["drone_detection_count"], 1)
            self.assertGreater(rows[0]["drone_density_per_hectare"], 0.0)

            summary = calibration_curve_summary(
                colony_id=self.colony_id, session=s, min_calls=1
            )
            self.assertEqual(summary["window_count"], 1)
            self.assertEqual(summary["usable_count"], 1)
            self.assertGreater(summary["simple_factor_density_per_call_per_asset"], 0.0)

    def test_rebuild_windows_respects_date_window(self):
        self._seed_overlap_case()
        with Session(self.engine) as s:
            out = rebuild_calibration_windows(
                colony_id=self.colony_id,
                session=s,
                max_days_apart=1,
                buffer_meters=200.0,
                min_acoustic_calls=1,
            )
            self.assertEqual(out["created_windows"], 0)

            rows = list_calibration_windows(
                colony_id=self.colony_id, session=s, min_calls=0, limit=10
            )
            self.assertEqual(len(rows), 0)

    def test_backtest_and_predict_do_not_crash(self):
        self._seed_overlap_case()
        with Session(self.engine) as s:
            rebuild_calibration_windows(
                colony_id=self.colony_id,
                session=s,
                max_days_apart=14,
                buffer_meters=200.0,
                min_acoustic_calls=1,
            )
            report = calibration_backtest_report(
                colony_id=self.colony_id, session=s, min_calls=1, top_species=3
            )
            self.assertIn("window_count", report)
            self.assertIn("folds", report)

            pred = calibration_predict_density(
                colony_id=self.colony_id,
                session=s,
                acoustic_survey_id=1,
                aru_id=1,
                model="best",
                min_calls=1,
                top_species=3,
            )
            # With tiny synthetic data this may return message-only output.
            self.assertTrue(
                "estimated_density_per_hectare" in pred or "message" in pred
            )


if __name__ == "__main__":
    unittest.main()
