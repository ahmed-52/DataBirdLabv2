from ..pipeline import Pipeline
from typing import Any, Dict
import os
import tempfile
import rasterio
from rasterio.windows import Window
from rasterio.warp import transform
import cv2
import numpy as np
from sqlmodel import Session
from app.database import engine
from app.models import MediaAsset, VisualDetection, Survey, Colony
from app import storage as storage_module
import json
from sqlmodel import Session, select
from ultralytics import YOLO


# Defaults — superseded by per-Colony config (tile_size, visual_model_path,
# min_confidence). Kept here only as fallbacks if a Colony field is unset.
DEFAULT_TILE_SIZE = 1280
OVERLAP = 0
OUTPUT_FORMAT = "jpg"
DEFAULT_MODEL_PATH = "weights/best.pt"
DEFAULT_CONF_THRESHOLD = 0.25



class DronePipeline(Pipeline):

    def __init__(self, ):
        # Config now resolved per-survey from the Colony row inside transform/
        # run_inference. The dict here just records pipeline-level defaults.
        self.config = {
            "TILE_SIZE": DEFAULT_TILE_SIZE,
            "MODEL_PATH": DEFAULT_MODEL_PATH,
            "CONF_THRESHOLD": DEFAULT_CONF_THRESHOLD,
            "OVERLAP": OVERLAP,
            "OUTPUT_FORMAT": OUTPUT_FORMAT,
        }



    """
    Slices a GeoTIFF into images and returns a list of metadata dicts.
    Each dict contains the file path and the Lat/Lon bounds.
    """
    def transform(self, survey_id, input_path, output_dir=None, aru_id=None):
        # Resolve colony-scoped config for this survey.
        with Session(engine) as session:
            survey = session.get(Survey, survey_id)
            if not survey:
                raise ValueError(f"Survey {survey_id} not found")
            colony = session.get(Colony, survey.colony_id)
            if not colony:
                raise ValueError(f"Colony {survey.colony_id} not found for survey {survey_id}")
            tile_size = colony.tile_size or DEFAULT_TILE_SIZE
            colony_slug = colony.slug

        generated_assets = []

        with rasterio.open(input_path) as src:
            print(f"[Slicer] Processing {input_path}")
            print(f"  - Size: {src.width}x{src.height}")
            print(f"  - CRS: {src.crs}")
            print(f"  - Transform: {src.transform}")

            # Get dimensions
            img_w = src.width
            img_h = src.height

            # Prepare coordinate transformer: File Projection -> Lat/Lon (WGS84)
            # Most drones output UTM. We need Lat/Lon for the database.
            src_crs = src.crs
            dst_crs = 'EPSG:4326' # Standard Lat/Lon

            if not src_crs:
                print("⚠️  WARNING: No CRS found in GeoTIFF! Lat/Lon will be Null.")

            # Loop through the image in steps of tile_size
            for row in range(0, img_h, tile_size):
                for col in range(0, img_w, tile_size):

                    # Define the Window
                    # Handle edges (don't go past the image end)
                    width = min(tile_size, img_w - col)
                    height = min(tile_size, img_h - row)
                    window = Window(col, row, width, height)

                    # Read the pixel data for just this window

                    img_array = src.read(window=window)

                    # Skip empty tiles (if the drone scanned a non-rectangular area)
                    if np.all(img_array == 0):
                        continue

                    # Calculate Geospatial Bounds
                    # Get the pixel coordinates of Top-Left (tl) and Bottom-Right (br)
                    # src.transform * (col, row) converts Pixel -> Projection Coords (Meters)
                    x_tl, y_tl = src.transform * (col, row)
                    x_br, y_br = src.transform * (col + width, row + height)

                    # Convert Meters -> Lat/Lon
                    # Convert Meters -> Lat/Lon
                    # transform returns (lon, lat) lists
                    if src_crs:
                        try:
                            lons, lats = transform(src_crs, dst_crs, [x_tl, x_br], [y_tl, y_br])

                            # Debuging print
                            if len(generated_assets) == 0:
                                print(f"[Slicer Debug] Tile 0:")
                                print(f"  Inputs (Meters): x={x_tl}, y={y_tl}")
                                print(f"  Outputs (Lat/Lon): lons={lons}, lats={lats}")

                            lon_tl, lon_br = lons
                            lat_tl, lat_br = lats
                        except Exception as e:
                            print(f"⚠️ [Slicer Error] Transform failed: {e}")
                            lon_tl, lon_br = None, None
                            lat_tl, lat_br = None, None
                    else:
                        lon_tl, lon_br = None, None
                        lat_tl, lat_br = None, None


                    # Save the Image
                    # Rasterio gives (Channels, H, W), OpenCV needs (H, W, Channels)
                    # Move axis 0 to axis 2
                    img_cv = np.moveaxis(img_array, 0, -1)

                    # Convert RGB to BGR (OpenCV standard)
                    img_cv = cv2.cvtColor(img_cv, cv2.COLOR_RGB2BGR)

                    filename = f"tile_{row}_{col}.jpg"
                    # Relative path (under colony root) — this is what we record in
                    # MediaAsset.file_path so storage.url_for(...) can resolve it.
                    tile_rel = f"tiles/survey_{survey_id}/{filename}"

                    # Write to a temp file first, then push through the storage layer.
                    # In local mode, storage_module.upload() is a no-op for the file
                    # itself, so we still need to copy to the canonical static/tiles
                    # location to keep /static/... URLs working.
                    with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
                        tmp_path = tmp.name
                    cv2.imwrite(tmp_path, img_cv)

                    if storage_module.STORAGE_BACKEND == "local":
                        local_dest = os.path.join("static", tile_rel)
                        os.makedirs(os.path.dirname(local_dest), exist_ok=True)
                        # shutil.copyfile preserves the temp -> dest semantics
                        import shutil
                        shutil.copyfile(tmp_path, local_dest)

                    storage_module.upload(colony_slug, tile_rel, tmp_path)
                    try:
                        os.unlink(tmp_path)
                    except OSError:
                        pass

                    # Prepare Metadata for DB — file_path is the RELATIVE path.
                    asset_meta = {
                        "file_path": tile_rel,
                        "lat_tl": lat_tl,
                        "lon_tl": lon_tl,
                        "lat_br": lat_br,
                        "lon_br": lon_br
                    }
                    print(asset_meta)
                    generated_assets.append(asset_meta)

        return generated_assets

    def save(self,survey_id, assets_metadata : list) -> None:
        with Session(engine) as session:
            for meta in assets_metadata:
                # Create the Database Row — file_path stays a relative path so
                # storage.url_for() can resolve it per backend (local /static or
                # GCS signed URL).
                new_asset = MediaAsset(
                    survey_id=survey_id,
                    file_path=meta["file_path"],
                    lat_tl=meta["lat_tl"],
                    lon_tl=meta["lon_tl"],
                    lat_br=meta["lat_br"],
                    lon_br=meta["lon_br"],
                    is_processed=False
                )
                session.add(new_asset)

            session.commit()



    def ingest(self, source: Any) -> Any:
        """Fetch or load raw data."""
        return source

    """Apply models or logic to the data."""
    def run_inference(self, survey_id):
        # Resolve colony-scoped config for this survey.
        with Session(engine) as session:
            survey = session.get(Survey, survey_id)
            if not survey:
                raise ValueError(f"Survey {survey_id} not found")
            colony = session.get(Colony, survey.colony_id)
            if not colony:
                raise ValueError(f"Colony {survey.colony_id} not found for survey {survey_id}")
            model_path = colony.visual_model_path or DEFAULT_MODEL_PATH
            conf_threshold = colony.min_confidence if colony.min_confidence is not None else DEFAULT_CONF_THRESHOLD

        print(f"--- Starting Inference for Survey {survey_id} ---")

        if not os.path.exists(model_path):
            print(f"Model not found at {os.path.abspath(model_path)}")
            return

        model = YOLO(model_path)

        with Session(engine) as session:

            statement = select(MediaAsset).where(
                MediaAsset.survey_id == survey_id,
                MediaAsset.is_processed == False
            )
            assets = session.exec(statement).all()

            for asset in assets:

                # MediaAsset.file_path is now a colony-relative path
                # (e.g. "tiles/survey_3/tile_0_0.jpg"). In local-mode storage we
                # mirror it to `static/<rel>` on disk so YOLO can read it.
                relative_path = asset.file_path.lstrip("/")
                if relative_path.startswith("static/"):
                    system_path = relative_path
                else:
                    system_path = os.path.join("static", relative_path)

                if not os.path.exists(system_path):
                    # Fall back to the raw stored path (legacy rows may still
                    # use absolute / static-prefixed paths).
                    if os.path.exists(relative_path):
                        system_path = relative_path
                    else:
                        continue

                # Skip non-image files (e.g. the original GeoTIFF)
                if not system_path.lower().endswith(('.jpg', '.jpeg', '.png')):
                    print(f"Skipping inference on non-image file: {system_path}")
                    asset.is_processed = True
                    session.add(asset)
                    continue

                # Run YOLO
                results = model.predict(system_path, conf=conf_threshold, verbose=False)

                for r in results:
                    for box in r.boxes:
                        # 1. Get Class
                        class_id = int(box.cls[0])
                        class_name = model.names[class_id]

                        # Get Confidence
                        conf = float(box.conf[0])

                        # Get RAW NORMALIZED Box (xywhn)
                        raw_bbox = box.xywhn[0].tolist()

                        # Save to DB
                        detection = VisualDetection(
                            asset_id=asset.id,
                            class_name=class_name,
                            confidence=conf,
                            bbox_json=json.dumps(raw_bbox),
                        )
                        session.add(detection)

                asset.is_processed = True
                session.add(asset)

            session.commit()
            print("Inference Complete.")


