from ..pipeline import Pipeline
from typing import Any, Dict, List
import os
import re
from datetime import datetime
from sqlmodel import Session, select
from app.database import engine
from app.models import MediaAsset, AcousticDetection, Survey, Colony
from birdnetlib import Recording
from birdnetlib.analyzer import Analyzer

class BirdNetPipeline(Pipeline):
    def __init__(self):
        # Initialize Analyzer.
        self.analyzer = Analyzer()

        # Load defaults from acoustic config
        from app.acoustic_config import (
            ANALYSIS_MIN_CONFIDENCE,
            DEFAULT_SAVE_CONFIDENCE,
            SPECIES_CONFIDENCE_OVERRIDES,
        )
        self.analysis_min_conf = ANALYSIS_MIN_CONFIDENCE
        self.default_save_confidence = DEFAULT_SAVE_CONFIDENCE
        self.species_confidence_overrides = dict(SPECIES_CONFIDENCE_OVERRIDES)
        # Override year in parsed timestamps (None = use year from filename)
        self.year_override = None

    def ingest(self, source: Any) -> Any:
        return source

    def transform(self, survey_id: int, input_path: str, output_dir: str = None, aru_id: int = None) -> List[Dict[str, Any]]:
        """
        Processes the input audio file.
        For acoustic pipeline, we primarily identify the file and prepare metadata.
        If aru_id is provided, fetch GPS coordinates from the ARU.
        """
        from sqlmodel import Session
        from app.database import engine
        from app.models import ARU

        lat_tl, lon_tl = None, None

        # Get GPS coordinates from ARU if provided
        if aru_id:
            with Session(engine) as session:
                aru = session.get(ARU, aru_id)
                if aru:
                    lat_tl = aru.lat
                    lon_tl = aru.lon

        # Normalize file_path to a colony-relative path so storage.url_for()
        # can resolve it. The caller (main.py) already uploaded the file via
        # storage_module.upload(); we just need to record the relative path.
        rel_path = input_path
        if "static/" in rel_path:
            rel_path = rel_path.split("static/", 1)[1]
        rel_path = rel_path.lstrip("/")

        # Dictionary to hold the asset metadata
        asset_meta = {
            "file_path": rel_path,
            "absolute_path": input_path,  # used by run_inference to load the file
            "lat_tl": lat_tl,
            "lon_tl": lon_tl,
            "lat_br": None,
            "lon_br": None,
            "aru_id": aru_id
        }
        return [asset_meta]

    def save(self, survey_id: int, assets_metadata: List[Dict[str, Any]]) -> None:
        """Saves the MediaAsset to the database."""
        with Session(engine) as session:
            for meta in assets_metadata:
                new_asset = MediaAsset(
                    survey_id=survey_id,
                    file_path=meta["file_path"],
                    lat_tl=meta["lat_tl"],
                    lon_tl=meta["lon_tl"],
                    lat_br=meta["lat_br"],
                    lon_br=meta["lon_br"],
                    aru_id=meta.get("aru_id"),
                    is_processed=False
                )
                session.add(new_asset)
            session.commit()

    def run_inference(self, survey_id: int) -> None:
        """Runs BirdNET analysis on unprocessed assets."""
        print(f"--- Starting Acoustic Inference for Survey {survey_id} ---")
        
        from datetime import datetime
        import datetime as dt_module

        with Session(engine) as session:
            # Resolve colony-scoped config for this survey. The Colony FK is
            # required on Survey, so colony.lat/lon are guaranteed.
            survey = session.get(Survey, survey_id)
            if not survey:
                raise ValueError(f"Survey {survey_id} not found")
            colony = session.get(Colony, survey.colony_id)
            if not colony:
                raise ValueError(f"Colony {survey.colony_id} not found for survey {survey_id}")

            # Use pipeline override if set, otherwise fall back to colony.min_confidence.
            if self.analysis_min_conf is not None:
                min_conf = self.analysis_min_conf
            else:
                min_conf = colony.min_confidence if colony.min_confidence is not None else 0.25
            d_lat = colony.lat
            d_lon = colony.lon
            custom_model = colony.acoustic_model_path
            
            # Re-initialize analyzer if custom model provided and different?
            # For simplicity, let's just make a local analyzer instance here if dealing with custom models,
            # or rely on self.analyzer if no custom model.
            # To be safe and support dynamic model swapping, we instantiated it here.
            # Note: TFLite loading is relatively fast.
            
            current_analyzer = self.analyzer
            if custom_model and os.path.exists(custom_model):
                print(f"Using custom model: {custom_model}")
                try:
                    current_analyzer = Analyzer(classifier_model_path=custom_model)
                except Exception as e:
                    print(f"Failed to load custom model {custom_model}, using default. Error: {e}")

            # Fetch unprocessed assets for this survey
            statement = select(MediaAsset).where(
                MediaAsset.survey_id == survey_id,
                MediaAsset.is_processed == False
            )
            assets = session.exec(statement).all()

            for asset in assets:
                # MediaAsset.file_path is now a colony-relative path
                # (e.g. "uploads/survey_3/audio/foo.wav"). In local-mode storage
                # the file lives at static/<rel_path>; resolve both shapes.
                stored_path = asset.file_path
                if os.path.exists(stored_path):
                    input_path = stored_path
                elif stored_path.startswith("static/") and os.path.exists(stored_path):
                    input_path = stored_path
                elif os.path.exists(os.path.join("static", stored_path)):
                    input_path = os.path.join("static", stored_path)
                else:
                    print(f"File not found: {stored_path}")
                    continue

                # Parse date from filename for Recording object
                # Formats:
                # 1. ..._YYYYMMDD_HHMMSS(UTC+Offset).wav
                # 2. ..._YYYYMMDD_HHMMSS(+Offset).wav
                # Example: 1_S7899_20250204_004500(UTC+7).wav
                # Example: 5_S7903_20250205_060000(+0700).wav
                
                filename = os.path.basename(input_path)
                
                # Regex to capture: YYYYMMDD, HHMMSS, and Timestamp string
                # Group 1: YYYYMMDD
                # Group 2: HHMMSS
                # Group 3: (+HHMM or UTC+H...)
                pattern = r"_(\d{8})_(\d{6})\((.*?)\)\.wav$"
                match = re.search(pattern, filename)
                
                recording_start_time = datetime.now() # Fallback
                has_valid_time = False

                if match:
                    date_str = match.group(1)
                    time_str = match.group(2)
                    tz_str = match.group(3) # e.g. "UTC+7" or "+0700"
                    
                    try:
                        # 1. Parse base time
                        dt_naive = datetime.strptime(f"{date_str}{time_str}", "%Y%m%d%H%M%S")
                        
                        # 2. Handle Timezone manually since strptime %z can be picky with formats
                        # Expected formats in tz_str: "UTC+7", "+0700"
                        
                        tz_offset = dt_module.timedelta(0)
                        
                        # Normalize "UTC+7" -> "+0700" style if possible or parse manually
                        # Case 1: "UTC+7", "UTC-5"
                        if "UTC" in tz_str:
                            # Remove UTC
                            offset_part = tz_str.replace("UTC", "")
                            try:
                                offset_hours = int(offset_part)
                                tz_offset = dt_module.timedelta(hours=offset_hours)
                            except ValueError:
                                print(f"Could not parse UTC offset from {tz_str}")
                        
                        # Case 2: "+0700", "-0500"
                        elif len(tz_str) == 5 and (tz_str.startswith("+") or tz_str.startswith("-")):
                            try:
                                hours = int(tz_str[0:3])
                                minutes = int(tz_str[0] + tz_str[3:5]) # apply sign
                                tz_offset = dt_module.timedelta(hours=hours, minutes=minutes)
                            except ValueError:
                                print(f"Could not parse numeric offset from {tz_str}")
                        else:
                             print(f"Unknown timezone format: {tz_str}")

                        # Override year if configured
                        if self.year_override is not None:
                            dt_naive = dt_naive.replace(year=self.year_override)

                        # Keep original local timezone from the filename.
                        # No UTC conversion — absolute_start_time will be in local time.
                        recording_start_time = dt_naive
                        has_valid_time = True
                        
                    except ValueError as e:
                        print(f"Date parsing failed for {filename}: {e}")
                else:
                    print(f"Filename pattern did not match for {filename}")

                
                try:
                    # Create Recording instance
                    # birdnetlib uses 'date' for filtering mainly, but we can pass our calculated time
                    recording = Recording(
                        current_analyzer,
                        input_path,
                        lat=d_lat,  
                        lon=d_lon,
                        min_conf=min_conf,
                        date=recording_start_time, # accurate UTC start time
                    )
                    
                    # Run analysis
                    recording.analyze()
                    
                    # Save detections (with species-specific confidence filtering)
                    saved_count = 0
                    skipped_count = 0
                    for d in recording.detections:
                        class_name = d.get('common_name') or d.get('scientific_name') or 'Unknown'
                        conf = float(d.get('confidence', 0.0))

                        # Apply species-specific confidence threshold
                        if self.default_save_confidence is not None:
                            threshold = self.species_confidence_overrides.get(
                                class_name, self.default_save_confidence
                            )
                            if conf < threshold:
                                skipped_count += 1
                                continue

                        rel_start = float(d.get('start_time', 0.0))
                        rel_end = float(d.get('end_time', 0.0))

                        abs_start = None
                        if has_valid_time:
                            abs_start = recording_start_time + dt_module.timedelta(seconds=rel_start)

                        new_det = AcousticDetection(
                            asset_id=asset.id,
                            class_name=class_name,
                            confidence=conf,
                            start_time=rel_start,
                            end_time=rel_end,
                            absolute_start_time=abs_start
                        )
                        session.add(new_det)
                        saved_count += 1

                    asset.is_processed = True
                    session.add(asset)
                    session.commit()
                    print(f"Processed {filename}: {saved_count} saved, {skipped_count} filtered out (of {len(recording.detections)} raw).")
                    
                except Exception as e:
                    print(f"Error analyzing {filename}: {e}")
                    asset.is_processed = True
                    asset.status = "failed"
                    asset.error_message = str(e)[:500]
                    session.add(asset)
                    session.commit()
            
            print("Acoustic Inference Complete.")
