import os
import shutil
from datetime import date
from fastapi import FastAPI, UploadFile, File, Form, BackgroundTasks, Depends, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from sqlmodel import Session
from app.database import engine, create_db_and_tables
from app.models import Survey, MediaAsset, VisualDetection, AcousticDetection, ARU, SystemSettings, CalibrationWindow

from typing import Optional
from sqlmodel import select, func
from datetime import timedelta
from pipeline import PipelineManager

import json
from multiprocessing import Process
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="DataBirdLab API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

@app.on_event("startup")
def on_startup():
    create_db_and_tables()



def get_session():
    with Session(engine) as session:
        yield session

def run_in_process(target, **kwargs):
    """Helper to run a function in a separate process to avoid blocking the main thread"""
    p = Process(target=target, kwargs=kwargs)
    p.start()




@app.post("/api/surveys/import")
async def import_survey(
    survey_name: str = Form(..., description="'Boeung Sne - Zone 2'"),
    survey_type: str = Form(default="drone", description="Survey type: 'drone' or 'acoustic'"),
    survey_date: Optional[str] = Form(default=None, description="Survey date in YYYY-MM-DD format"),
    orthomosaics: list[UploadFile] = File(default=[], description="Orthomosaic GeoTIFF files"),
    audio_files: list[UploadFile] = File(default=[], description="Audio files (.wav, .mp3, .flac)"),
    audio_aru_mapping: Optional[str] = Form(default=None, description="JSON mapping of audio file index to ARU ID"),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    session: Session = Depends(get_session)
):
    # Validate at least one file is provided AND exclusive
    if not orthomosaics and not audio_files:
        raise HTTPException(status_code=400, detail="At least one orthomosaic or audio file must be provided")
    
    if orthomosaics and audio_files:
         raise HTTPException(status_code=400, detail="Survey cannot contain both drone and acoustic data simultaneously. Please upload separately.")
    
    if survey_type == "drone" and audio_files:
        raise HTTPException(status_code=400, detail="Survey type 'drone' cannot accept audio files.")
    
    if survey_type == "acoustic" and orthomosaics:
        raise HTTPException(status_code=400, detail="Survey type 'acoustic' cannot accept orthomosaic files.")

    # Parse survey date
    from datetime import datetime
    import re
    parsed_date = None
    
    # For acoustic surveys, try to extract date from first audio filename
    if survey_type == "acoustic" and audio_files:
        first_audio = audio_files[0].filename
        # Pattern: _YYYYMMDD_HHMMSS(...).wav
        pattern = r"_(\d{8})_(\d{6})\("
        match = re.search(pattern, first_audio)
        if match:
            date_str = match.group(1)  # YYYYMMDD
            try:
                parsed_date = datetime.strptime(date_str, "%Y%m%d")
            except ValueError:
                pass
    
    # Fallback: use provided date or today
    if not parsed_date:
        if survey_date:
            try:
                parsed_date = datetime.strptime(survey_date, "%Y-%m-%d")
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
        else:
            parsed_date = datetime.now()
    
    # Parse audio ARU mapping
    aru_mapping = {}
    if audio_aru_mapping:
        try:
            aru_mapping = json.loads(audio_aru_mapping)
            # Convert string keys to integers
            aru_mapping = {int(k): v for k, v in aru_mapping.items()}
        except (json.JSONDecodeError, ValueError):
            raise HTTPException(status_code=400, detail="Invalid audio_aru_mapping format")
    
    # 1. Create Survey entry in DB with explicit type and date
    new_survey = Survey(
        name=survey_name, 
        type=survey_type, 
        date=parsed_date,
        status="pending"
    )
    session.add(new_survey)
    session.commit()
    session.refresh(new_survey)
    
    # 2. Create upload directory for this survey
    upload_dir = Path("static/uploads") / f"survey_{new_survey.id}"
    upload_dir.mkdir(parents=True, exist_ok=True)
    
    uploaded_files = {"orthomosaics": [], "audio": []}
    
    # Process orthomosaic files
    for file in orthomosaics:
        # Validate file type
        if not file.filename.lower().endswith(('.tif', '.tiff')):
            continue
            
        safe_filename = file.filename.replace(" ", "_")
        input_path = str(upload_dir / safe_filename)
        
        # Save file
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Create MediaAsset entry
        media_asset = MediaAsset(
            survey_id=new_survey.id,
            file_path=input_path,
            is_processed=False,
            status="Processing"
        )
        session.add(media_asset)
        session.commit()
        session.refresh(media_asset)

        # Prepare tile output directory
        tile_dir = Path("static/tiles") / f"survey_{new_survey.id}"
        tile_dir.mkdir(parents=True, exist_ok=True)
        
        # Trigger drone processing pipeline in background
        background_tasks.add_task(
            run_in_process,
            target=execute_pipeline_task,
            survey_id=new_survey.id,
            input_path=input_path,
            output_dir=str(tile_dir)
        )
        
        uploaded_files["orthomosaics"].append({
            "filename": safe_filename,
            "asset_id": media_asset.id
        })
    
    # Create audio subdirectory
    audio_dir = upload_dir / "audio"
    audio_dir.mkdir(exist_ok=True)
    
    # Process audio files
    for index, file in enumerate(audio_files):
        # Validate file type
        if not file.filename.lower().endswith(('.wav', '.mp3', '.flac')):
            continue
            
        safe_filename = file.filename.replace(" ", "_")
        input_path = str(audio_dir / safe_filename)
        
        # Save file
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Get ARU ID for this audio file
        file_aru_id = aru_mapping.get(index)
        
        # Create MediaAsset for audio (IMPORTANT: Was missing before?)
        # Wait, previous code didn't create MediaAsset for audio explicitly here??
        # Checking... previous code only did `background_tasks.add_task`
        # Pipeline likely creates it? 
        # Pipeline manager.run_survey_processing calls pipeline.transform
        # BirdNetPipeline.transform likely creates assets?
        # If so, create_survey shouldn't create it twice.
        # But for status tracking, we probably want a record immediately.
        # Let's stick to existing pattern for now (pipeline handles creation if it wasn't here)
        # Actually, Drone loop created MediaAsset. Acoustic loop didn't.
        # BirdNetPipeline likely handles it.
        # I will leave as is but check Pipeline later.
        
        # Trigger acoustic processing pipeline in background
        background_tasks.add_task(
            run_in_process,
            target=execute_acoustic_pipeline_task,
            survey_id=new_survey.id,
            input_path=input_path,
            aru_id=file_aru_id
        )
        
        uploaded_files["audio"].append({
            "filename": safe_filename
        })

    return {
        "status": "success",
        "survey_id": new_survey.id,
        "message": f"Uploaded {len(uploaded_files['orthomosaics'])} orthomosaic(s) and {len(uploaded_files['audio'])} audio file(s). Processing...",
        "uploaded_files": uploaded_files
    }

def execute_pipeline_task(survey_id: int, input_path: str, output_dir: str):
    """Execution wrapper for BackgroundTasks with status tracking"""
    with Session(engine) as session:
        survey = session.get(Survey, survey_id)
        if survey:
            survey.status = "processing"
            session.add(survey)
            session.commit()

    try:
        manager = PipelineManager(pipeline_type="drone")
        manager.run_survey_processing(
            survey_id=survey_id, 
            input_path=input_path, 
            output_dir=output_dir
        )
        
        # DELETE THE ORTHOMOSAIC FILE TO SAVE SPACE
        try:
            if os.path.exists(input_path):
                os.remove(input_path)
                print(f"Deleted original orthomosaic: {input_path}")
        except Exception as delete_err:
            print(f"Failed to delete orthomosaic {input_path}: {delete_err}")

        
        with Session(engine) as session:
            survey = session.get(Survey, survey_id)
            if survey:
                survey.status = "completed"
                
                session.add(survey)
                session.commit()
                
    except Exception as e:
        print(f"Pipeline Failed: {e}")
        with Session(engine) as session:
            survey = session.get(Survey, survey_id)
            if survey:
                survey.status = "failed"
                survey.error_message = str(e)
                session.add(survey)
                session.commit()
            
            # Also mark assets as failed?
            # Ideally we find the specific asset but input_path is unique enough
            assets = session.exec(select(MediaAsset).where(MediaAsset.survey_id == survey_id)).all()
            for asset in assets:
                # Naive matching of input path to uploaded file might be tricky if path changed
                # But we can mark all pending assets as failed
                if asset.status == "pending":
                    asset.status = "failed"
                    asset.error_message = str(e)
                    session.add(asset)
            session.commit()

def execute_acoustic_pipeline_task(survey_id: int, input_path: str, aru_id: Optional[int] = None):
    """Execution wrapper for acoustic processing BackgroundTasks with status tracking"""
    with Session(engine) as session:
        survey = session.get(Survey, survey_id)
        if survey:
            survey.status = "processing"
            session.add(survey)
            session.commit()

    try:
        manager = PipelineManager(pipeline_type="birdnet")
        manager.run_survey_processing(
            survey_id=survey_id,
            input_path=input_path,
            output_dir=None,  # Audio doesn't need output_dir
            aru_id=aru_id
        )
        
        with Session(engine) as session:
            survey = session.get(Survey, survey_id)
            if survey:
                survey.status = "completed"
                session.add(survey)
                session.commit()

    except Exception as e:
        print(f"Acoustic Pipeline Failed: {e}")
        with Session(engine) as session:
            survey = session.get(Survey, survey_id)
            if survey:
                survey.status = "failed"
                survey.error_message = str(e)
                session.add(survey)
                session.commit()


@app.get("/api/surveys/{survey_id}/status")
def get_survey_status(survey_id: int, session: Session = Depends(get_session)):
    survey = session.get(Survey, survey_id)
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")
    
    # Count how many assets are processed
    # (This assumes you added a relationship or query logic)
    total_assets = len(survey.media)
    processed = sum(1 for asset in survey.media if asset.is_processed)
    
    return {
        "id": survey.id,
        "name": survey.name,
        "total_tiles": total_assets,
        "processed_tiles": processed,
        "is_complete": survey.status == "completed",
        "status": survey.status,
        "error_message": survey.error_message
    }

    return {
        "id": survey.id,
        "name": survey.name,
        "total_tiles": total_assets,
        "processed_tiles": processed,
        "is_complete": (total_assets > 0 and total_assets == processed)
    }

@app.get("/api/surveys/{survey_id}")
def get_survey_details(survey_id: int, session: Session = Depends(get_session)):
    """Get metadata for a specific survey"""
    survey = session.get(Survey, survey_id)
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")
    
    # Calculate bounds similar to list endpoint
    bounds = None
    if survey.type == 'drone':
        bounds_res = session.exec(
            select(
                func.min(MediaAsset.lat_tl),
                func.max(MediaAsset.lat_br),
                func.min(MediaAsset.lon_tl),
                func.max(MediaAsset.lon_br)
            ).where(MediaAsset.survey_id == survey.id)
        ).first()
        if bounds_res:
            bounds = {
                "min_lat": bounds_res[1] if bounds_res[1] is not None else None,
                "max_lat": bounds_res[0] if bounds_res[0] is not None else None,
                "min_lon": bounds_res[2] if bounds_res[2] is not None else None,
                "max_lon": bounds_res[3] if bounds_res[3] is not None else None
            }
    
    # Get associated ARU for acoustic surveys
    aru_details = None
    if survey.type == 'acoustic':
        aru_asset = session.exec(
            select(MediaAsset)
            .where(MediaAsset.survey_id == survey.id)
            .where(MediaAsset.aru_id.is_not(None))
        ).first()
        
        if aru_asset and aru_asset.aru:
            aru_details = {
                "id": aru_asset.aru.id,
                "name": aru_asset.aru.name,
                "lat": aru_asset.aru.lat,
                "lon": aru_asset.aru.lon,
                "status": "active"
            }

    return {
        "id": survey.id,
        "name": survey.name,
        "date": survey.date,
        "type": survey.type,
        "status": survey.status,
        "area": "Boeung Sne Restricted Zone", # Placeholder or derived
        "notes": "Survey data available.",
        "bounds": bounds or {
            "min_lat": None,
            "max_lat": None,
            "min_lon": None,
            "max_lon": None
        },
        "aru": aru_details
    }


@app.delete("/api/surveys/{survey_id}")
def delete_survey(survey_id: int, session: Session = Depends(get_session)):
    """
    Permanently delete a survey and all linked data:
    media assets, visual detections, acoustic detections,
    calibration windows, and tile files on disk.
    """
    survey = session.get(Survey, survey_id)
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")

    # Collect asset IDs before deleting anything
    assets = session.exec(
        select(MediaAsset).where(MediaAsset.survey_id == survey_id)
    ).all()
    asset_ids = [a.id for a in assets]

    # Delete child detections first (FK constraints)
    if asset_ids:
        for vd in session.exec(
            select(VisualDetection).where(VisualDetection.asset_id.in_(asset_ids))
        ).all():
            session.delete(vd)

        for ad in session.exec(
            select(AcousticDetection).where(AcousticDetection.asset_id.in_(asset_ids))
        ).all():
            session.delete(ad)

    # Delete calibration windows that reference this survey
    for cw in session.exec(
        select(CalibrationWindow).where(
            (CalibrationWindow.acoustic_survey_id == survey_id) |
            (CalibrationWindow.visual_survey_id == survey_id)
        )
    ).all():
        session.delete(cw)

    # Delete media assets
    for asset in assets:
        session.delete(asset)

    # Delete survey row
    session.delete(survey)
    session.commit()

    # Remove tile files from disk (drone surveys only, but safe to attempt always)
    tile_dir = Path("static/tiles") / f"survey_{survey_id}"
    if tile_dir.exists():
        shutil.rmtree(tile_dir)

    return {"ok": True, "deleted_survey_id": survey_id}


# --- ARU Endpoints ---

@app.get("/api/arus")
def get_arus(session: Session = Depends(get_session)):
    """Get all ARU locations"""
    arus = session.exec(select(ARU)).all()
    return arus


@app.post("/api/arus")
def create_aru(
    name: str = Form(...),
    lat: float = Form(...),
    lon: float = Form(...),
    session: Session = Depends(get_session)
):
    """Create a new ARU location"""
    new_aru = ARU(name=name, lat=lat, lon=lon)
    session.add(new_aru)
    session.commit()
    session.refresh(new_aru)
    return new_aru


@app.get("/api/surveys")
def get_surveys(session: Session = Depends(get_session)):
    surveys = session.exec(select(Survey).order_by(Survey.date.desc())).all()
    
    results = []
    for s in surveys:
        # Calculate bounds
        bounds = session.exec(
            select(
                func.min(MediaAsset.lat_tl),
                func.max(MediaAsset.lat_br),
                func.min(MediaAsset.lon_tl),
                func.max(MediaAsset.lon_br)
            ).where(MediaAsset.survey_id == s.id)
        ).first()
        
        # Get linked ARU info for acoustic surveys
        aru_info = None
        if s.type == "acoustic":
            # Find first ARU linked to this survey's media assets
            aru_asset = session.exec(
                select(MediaAsset)
                .where(MediaAsset.survey_id == s.id, MediaAsset.aru_id.is_not(None))
            ).first()
            if aru_asset and aru_asset.aru:
                aru_info = {
                    "id": aru_asset.aru.id,
                    "name": aru_asset.aru.name
                }
        
        results.append({
            "id": s.id,
            "name": s.name,
            "date": s.date,
            "type": s.type,
            "status": s.status,
            "aru": aru_info,
            "bounds": {
                "min_lat": bounds[1] if bounds[1] is not None else None,
                "max_lat": bounds[0] if bounds[0] is not None else None,
                "min_lon": bounds[2] if bounds[2] is not None else None,
                "max_lon": bounds[3] if bounds[3] is not None else None
            }
        })

    return results


@app.get("/api/surveys/{survey_id}/map_data")
def get_survey_map_data(survey_id: int, session: Session = Depends(get_session)):
    """
    Returns a list of detections with their estimated lat/lon based on the MediaAsset bounds.
    Scale: simple interpolation for now.
    """
    survey = session.get(Survey, survey_id)
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")

    detections_data = []
    
    # Pre-fetch assets to avoid N+1 query issues if lists are huge (keeping it simple for now)
    # Ideally should use a join, but python logic for geo-calc is easier to write explicitly here
    
    import json
    
    for asset in survey.media:
        if not asset.visual_detections:
            continue
            
        # Basic bounds checks
        if asset.lat_tl is None or asset.lat_br is None or asset.lon_tl is None or asset.lon_br is None:
            continue
            
        lat_diff = asset.lat_br - asset.lat_tl
        lon_diff = asset.lon_br - asset.lon_tl
        
        # Image dimensions assumed 1280x1280 based on models.py comments or defaults
        # If dynamic, need to store it. Assuming 1280x1280 for the thermal/drone slices
        IMG_W, IMG_H = 1280, 1280 
        
        for det in asset.visual_detections:
            try:
                # bbox_json is [x, y, w, h] (x,y is center? or top-left? usually top-left for xywh)
                # YOLO format varies, but usually center_x, center_y, w, h normalized OR pixel x1,y1,x2,y2
                # The model says "pixels: [x, y, w, h]" inside 1280x1280.
                # Let's assume x,y are center or top-left. Let's assume Top-Left for pixel coords usually
                # But safer to take the center of the box for the point on map.
                
                bbox = json.loads(det.bbox_json)
                # If bbox is [x, y, w, h]
                x, y, w, h = bbox
                
                cx = x + w / 2
                cy = y + h / 2
                
                # Interpolate
                # latitude moves locally; 0 is TL, H is BR.
                # So relative_y = cy / IMG_H
                # feature_lat = lat_tl + (relative_y * lat_diff)
                
                relative_x = cx / IMG_W
                relative_y = cy / IMG_H
                
                det_lat = asset.lat_tl + (relative_y * lat_diff)
                det_lon = asset.lon_tl + (relative_x * lon_diff)
                
                detections_data.append({
                    "id": det.id,
                    "lat": det_lat,
                    "lon": det_lon,
                    "class": det.class_name,
                    "confidence": det.confidence,
                    "asset_id": asset.id
                })
            except:
                continue
                
    return detections_data


@app.get("/api/stats/daily")
def get_daily_activity(
    session: Session = Depends(get_session),
    days: int = 7,
    survey_id: Optional[int] = None
):
    """
    Returns total visual detections grouped by day.
    """
    
    base_query = (
        select(func.date(Survey.date), func.count(VisualDetection.id))
        .join(MediaAsset, Survey.id == MediaAsset.survey_id)
        .join(VisualDetection, MediaAsset.id == VisualDetection.asset_id)
    )
    
    # Filter
    if survey_id:
        base_query = base_query.where(Survey.id == survey_id)
    
    # Date filter
    # If using sqlite func.date, be careful with comparison
    cutoff_date = date.today() - timedelta(days=days)
    base_query = base_query.where(Survey.date >= cutoff_date)

    query = (
        base_query
        .group_by(func.date(Survey.date))
        .order_by(func.date(Survey.date).desc())
    )
    
    results = session.exec(query).all()
    
    data = []
    
    for date_str, count in results:
        # date_str comes out as string 'YYYY-MM-DD' from func.date usually
        d = date_str if isinstance(date_str, str) else date_str.strftime("%Y-%m-%d")
        dt_obj = date.fromisoformat(d)
        
        data.append({
            "day": dt_obj.strftime("%a"), # Mon, Tue
            "full_date": d,
            "count": count
        })
        
    return data[::-1]


@app.get("/api/stats/acoustic")
def get_acoustic_activity(
    session: Session = Depends(get_session),
    days: int = 7,
    survey_id: Optional[int] = None
):
    """
    Returns acoustic detections grouped by class or time.
    For now, let's return top acoustic classes to display in a chart.
    """
    # Join needed
    base_query = (
        select(AcousticDetection.class_name, func.count(AcousticDetection.id))
        .join(MediaAsset, AcousticDetection.asset_id == MediaAsset.id)
        .join(Survey, MediaAsset.survey_id == Survey.id)
    )

    if survey_id:
        base_query = base_query.where(Survey.id == survey_id)

    cutoff_date = date.today() - timedelta(days=days)
    base_query = base_query.where(Survey.date >= cutoff_date)
    
    query = (
        base_query
        .group_by(AcousticDetection.class_name)
        .order_by(func.count(AcousticDetection.id).desc())
    )
    
    results = session.exec(query).all()
    
    data = []
    for class_name, count in results:
        data.append({"name": class_name, "value": count})
        
    return data


@app.get("/api/stats/species")
def get_species_stats(
    session: Session = Depends(get_session),
    days: int = 7,
    survey_id: Optional[int] = None
):
    """
    Returns breakdown of species detections.
    """
    # Join needed to filter by Survey Date/ID if filter applied
    base_query = (
        select(VisualDetection.class_name, func.count(VisualDetection.id))
        .join(MediaAsset, VisualDetection.asset_id == MediaAsset.id)
        .join(Survey, MediaAsset.survey_id == Survey.id)
    )
    
    if survey_id:
        base_query = base_query.where(Survey.id == survey_id)
    
    cutoff_date = date.today() - timedelta(days=days)
    base_query = base_query.where(Survey.date >= cutoff_date)
    
    query = (
        base_query
        .group_by(VisualDetection.class_name)
        .order_by(func.count(VisualDetection.id).desc())
    )
    
    results = session.exec(query).all()
    
    data = []
    for class_name, count in results:
        data.append({"name": class_name, "value": count})
        
    return data


@app.get("/api/stats/overview")
def get_overview_stats(
    session: Session = Depends(get_session),
    days: int = 7,
    survey_id: Optional[int] = None
):
    """
    Returns high-level aggregate stats.
    """
    
    # helper for constructing query
    def get_filtered_scalar(field):
        q = select(field).join(MediaAsset, VisualDetection.asset_id == MediaAsset.id).join(Survey, MediaAsset.survey_id == Survey.id)
        if survey_id:
            q = q.where(Survey.id == survey_id)
        q = q.where(Survey.date >= (date.today() - timedelta(days=days)))
        return q

    # Total Detections
    total_q = (
        select(func.count(VisualDetection.id))
        .join(MediaAsset, VisualDetection.asset_id == MediaAsset.id)
        .join(Survey, MediaAsset.survey_id == Survey.id)
        .where(Survey.date >= (date.today() - timedelta(days=days)))
    )
    if survey_id:
        total_q = total_q.where(Survey.id == survey_id)
        
    total_detections = session.exec(total_q).one()
    
    # Species
    species_q = (
        select(func.count(func.distinct(VisualDetection.class_name)))
        .join(MediaAsset, VisualDetection.asset_id == MediaAsset.id)
        .join(Survey, MediaAsset.survey_id == Survey.id)
        .where(Survey.date >= (date.today() - timedelta(days=days)))
    )
    if survey_id:
        species_q = species_q.where(Survey.id == survey_id)
        
    unique_species = session.exec(species_q).one()
    
    # Conf
    conf_q = (
        select(func.avg(VisualDetection.confidence))
        .join(MediaAsset, VisualDetection.asset_id == MediaAsset.id)
        .join(Survey, MediaAsset.survey_id == Survey.id)
        .where(Survey.date >= (date.today() - timedelta(days=days)))
    )
    if survey_id:
        conf_q = conf_q.where(Survey.id == survey_id)
        
    avg_conf = session.exec(conf_q).one()
    
    # Area Calculation (hectares)
    # Sum of (lat_diff * lon_diff) * conversion_factor?
    # Or just sum of tile areas? 
    # Approx: 1 deg lat ~ 111km. 1 deg lon ~ 111km * cos(11).
    # Area = sum( (lat_br-lat_tl) * (lon_br-lon_tl) ) * logic
    # Simplified: Just count Tiles * Approx Area Per Tile
    # Drone images 1280x1280, GSD ~? 
    # Let's say 1 tile = 0.5 Hectares for now as a constant if bounds not perfect
    
    # Count processed tiles in filter
    tiles_q = (
        select(func.count(MediaAsset.id))
        .join(Survey, MediaAsset.survey_id == Survey.id)
        .where(MediaAsset.is_processed == True)
        .where(Survey.date >= (date.today() - timedelta(days=days)))
    )
    if survey_id:
        tiles_q = tiles_q.where(Survey.id == survey_id)
    
    tile_count = session.exec(tiles_q).one()
    area_hectares = tile_count * 0.15 # Dummy factor
    
    
    return {
        "total_detections": total_detections,
        "unique_species": unique_species,
        "avg_confidence": avg_conf if avg_conf else 0.0,
        "storage_used": f"{area_hectares:.2f} ha" # Re-purposing this field or adding new
    }

@app.get("/api/detections/visual")
def get_visual_detections(
    session: Session = Depends(get_session),
    days: int = 7,
    survey_ids: Optional[str] = None # comma separated, e.g "1,2,3"
):
    """
    Returns individual visual detections for the map/inspector.
    """
    cutoff_date = date.today() - timedelta(days=days)
    
    query = (
        select(VisualDetection, MediaAsset, Survey)
        .join(MediaAsset, VisualDetection.asset_id == MediaAsset.id)
        .join(Survey, MediaAsset.survey_id == Survey.id)
        .where(Survey.date >= cutoff_date)
    )
    
    if survey_ids:
        try:
            ids = [int(x) for x in survey_ids.split(",") if x.strip()]
            if ids:
                query = query.where(Survey.id.in_(ids))
        except ValueError:
            pass # Ignore invalid format

    results = session.exec(query).all()
    
    data = []
    
    # Pre-define IMG dims
    IMG_W, IMG_H = 1280, 1280
    
    for det, asset, survey in results:
        # Interpolate Lat/Lon
        try:
            if not asset.lat_tl or not asset.lat_br or not asset.lon_tl or not asset.lon_br:
                continue

            lat_diff = asset.lat_br - asset.lat_tl
            lon_diff = asset.lon_br - asset.lon_tl
            
            bbox_list = json.loads(det.bbox_json)
            # YOLO Format: [center_x, center_y, width, height] (Normalized 0-1)
            cx, cy, w, h = bbox_list
            
            # Convert to Top-Left for bounding box drawing (if needed) but keep center for geo
            # cx is normalized (0-1)
            
            # Interpolate Geo-Coordinates based on Center of Box
            det_lat = asset.lat_tl + (cy * lat_diff)
            det_lon = asset.lon_tl + (cx * lon_diff)
            
            # Construct Image URL
            # stored path is likely "static/tiles/survey_ID/..."
            img_path = asset.file_path
            if not img_path.startswith("/"):
                img_path = "/" + img_path
            
            # Ensure it starts with /static if the stored path is relative like "static/..."
            # If stored as "static/tiles...", and we access via "/static/tiles...", we need leading /
            
            data.append({
                "id": f"vis-{det.id}",
                "species": det.class_name,
                "confidence": det.confidence,
                "lat": det_lat,
                "lon": det_lon,
                "bbox": {"cx": cx, "cy": cy, "w": w, "h": h}, # Send standard YOLO format
                "imageUrl": img_path, 
                "timestamp": survey.date.isoformat(),
                "survey_id": survey.id,
                "survey_name": survey.name,
                "asset_id": asset.id 
            })
            
        except Exception as e:
            continue
            
    return data

@app.get("/api/detections/acoustic")
def get_acoustic_detections(
    session: Session = Depends(get_session),
    days: int = 7,
    survey_ids: Optional[str] = None # comma separated
):
    """
    Returns individual acoustic detections for the map/inspector.
    """
    cutoff_date = date.today() - timedelta(days=days)
    
    query = (
        select(AcousticDetection, MediaAsset, Survey)
        .join(MediaAsset, AcousticDetection.asset_id == MediaAsset.id)
        .join(Survey, MediaAsset.survey_id == Survey.id)
        .where(Survey.date >= cutoff_date)
    )
    
    if survey_ids:
        try:
            ids = [int(x) for x in survey_ids.split(",") if x.strip()]
            if ids:
                query = query.where(Survey.id.in_(ids))
        except ValueError:
            pass

    results = session.exec(query).all()
    
    data = []
    
    for det, asset, survey in results:
        # Acoustic detections use the Audio Asset location (Point)
        # lat_tl/lon_tl should be the station location
        if not asset.lat_tl or not asset.lon_tl:
            continue
            
        # Timestamp: Survey Date + Start Time offset?
        # Survey.date is datetime. start_time is float seconds.
        # We can construct a rough timestamp
        det_time = survey.date + timedelta(seconds=det.start_time)
        
        data.append({
             "id": f"audio-{det.id}",
             "species": det.class_name,
             "confidence": det.confidence,
             "lat": asset.lat_tl, # Station lat
             "lon": asset.lon_tl, # Station lon
             "radius": 50, # Hardcoded range for now
             "timestamp": det_time.isoformat(),
             "audioUrl": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", # Placeholder
             "aru_id": asset.aru_id,  # Add ARU ID
             "survey_id": survey.id   # Add Survey ID
        })
        
    return data


# --- New Endpoints for Charts ---

@app.get("/api/surveys/{survey_id}/arus")
def get_survey_arus(
    survey_id: int,
    session: Session = Depends(get_session)
):
    """
    Returns list of ARU (Audio) assets for a specific survey.
    """
    # Find assets with .wav extension indicating ARU
    assets = session.exec(
        select(MediaAsset)
        .where(MediaAsset.survey_id == survey_id)
        .where(MediaAsset.file_path.like("%wav"))
    ).all()
    
    arus = []
    for asset in assets:
        name = f"Station #{asset.id}"
        arus.append({
            "id": asset.id,
            "name": name,
            "lat": asset.lat_tl,
            "lon": asset.lon_tl
        })
        
    return arus

@app.get("/api/acoustic/activity/hourly")
def get_hourly_activity(
    survey_id: int,
    aru_id: Optional[int] = None,
    session: Session = Depends(get_session)
):
    """
    Returns hourly aggregation of acoustic detections.
    """
    # Fetch detections for this asset
    query = select(AcousticDetection, Survey)\
        .join(MediaAsset, AcousticDetection.asset_id == MediaAsset.id)\
        .join(Survey, MediaAsset.survey_id == Survey.id)\
        .where(Survey.id == survey_id)
        
    if aru_id:
        query = query.where(MediaAsset.id == aru_id)
        
    detections = session.exec(query).all()
    
    # Initialize 24 hour buckets
    hourly_counts = {h: 0 for h in range(24)}
    
    for det, survey in detections:
        # Use survey date + start_time to determine hour
        base_time = survey.date
        det_time = base_time + timedelta(seconds=det.start_time)
        hour = det_time.hour
        hourly_counts[hour] += 1

    chart_data = []
    for h in range(24):
        if h == 0: label = "12am"
        elif h == 12: label = "12pm"
        elif h > 12: label = f"{h-12}pm"
        else: label = f"{h}am"
        
        chart_data.append({
            "hour": h,
            "count": hourly_counts[h],
            "label": label
        })
        
    return chart_data


@app.get("/api/arus/{aru_id}/detections")
def get_aru_detections(
    aru_id: int,
    days: int = 7,
    survey_ids: Optional[str] = None,
    session: Session = Depends(get_session)
):
    """
    Returns all acoustic detections for a specific ARU.
    Respects date filter and survey filter.
    """
    cutoff_date = date.today() - timedelta(days=days)
    
    # Build query
    query = (
        select(AcousticDetection, MediaAsset, Survey)
        .join(MediaAsset, AcousticDetection.asset_id == MediaAsset.id)
        .join(Survey, MediaAsset.survey_id == Survey.id)
        .where(MediaAsset.aru_id == aru_id)
        .where(Survey.date >= cutoff_date)
    )
    
    # Apply survey filter if provided
    if survey_ids:
        try:
            ids = [int(x) for x in survey_ids.split(",") if x.strip()]
            if ids:
                query = query.where(Survey.id.in_(ids))
        except ValueError:
            pass
    
    results = session.exec(query).all()
    
    detections = []
    for det, asset, survey in results:
        det_time = survey.date + timedelta(seconds=det.start_time)
        detections.append({
            "id": det.id,
            "species": det.class_name,
            "confidence": det.confidence,
            "start_time": det.start_time,
            "end_time": det.end_time,
            "timestamp": det_time.isoformat(),
            "audio_url": f"/static/uploads/survey_{survey.id}/audio/{Path(asset.file_path).name}",
            "survey_id": survey.id,
            "survey_name": survey.name
        })
    
    return detections

@app.get("/api/stats/species_history")
def get_species_history(
    species_name: str,
    days: int = 7,
    type: str = "visual",
    session: Session = Depends(get_session)
):
    """
    Returns daily counts for a specific species.
    """
    # Fix: To include today, we need to shift the window.
    # range(days) means we get N days. 
    # If we want the last one to be today, start = today - (days - 1)
    cutoff_date = date.today() - timedelta(days=days - 1)
    
    if type == "visual":
        Model = VisualDetection
    else:
        Model = AcousticDetection
        
    query = (
        select(func.date(Survey.date), func.count(Model.id))
        .join(MediaAsset, Model.asset_id == MediaAsset.id)
        .join(Survey, MediaAsset.survey_id == Survey.id)
        .where(Model.class_name == species_name)
        .where(Survey.date >= cutoff_date)
        .group_by(func.date(Survey.date))
        .order_by(func.date(Survey.date))
    )
    
    results = session.exec(query).all()
    
    # Fill in missing dates
    data_map = {r[0]: r[1] for r in results}
    
    chart_data = []
    for i in range(days):
        d = cutoff_date + timedelta(days=i)
        d_str = d.isoformat()
        
        # Format label
        label = d.strftime("%d %b") # 04 Feb
        
        count = 0
        # Check if date string matches typical SQL output
        # SQLite func.date returns YYYY-MM-DD
        if d_str in data_map:
            count = data_map[d_str]
            
        chart_data.append({
            "date": d_str,
            "label": label,
            "count": count
        })
        
    return chart_data


@app.get("/api/species_list")
def get_species_list(
    type: str = "visual",
    session: Session = Depends(get_session)
):
    """Returns list of all unique species detected"""
    if type == "visual":
        Model = VisualDetection
    else:
        Model = AcousticDetection
        
    query = select(func.distinct(Model.class_name)).order_by(Model.class_name)
    results = session.exec(query).all()
    return results


@app.get("/api/settings")
def get_settings(session: Session = Depends(get_session)):
    settings = session.get(SystemSettings, 1)
    if not settings:
        settings = SystemSettings(id=1)
        session.add(settings)
        session.commit()
        session.refresh(settings)
    return settings

@app.post("/api/settings")
def update_settings(new_settings: SystemSettings, session: Session = Depends(get_session)):
    settings = session.get(SystemSettings, 1)
    if not settings:
        settings = SystemSettings(id=1)
    
    settings.min_confidence = new_settings.min_confidence
    settings.default_lat = new_settings.default_lat
    settings.default_lon = new_settings.default_lon
    
    session.add(settings)
    session.commit()
    session.refresh(settings)
    return settings

@app.post("/api/settings/upload-model")
async def upload_model_weights(
    file: UploadFile = File(...),
    type: str = Form(...), # 'acoustic' or 'visual'
    session: Session = Depends(get_session)
):
    """
    Uploads a new model weights file and updates settings.
    """
    settings = session.get(SystemSettings, 1)
    if not settings:
        settings = SystemSettings(id=1)
        session.add(settings)
        session.commit()

    # Define path
    # backend/weights directory
    weights_dir = BASE_DIR / "weights"
    weights_dir.mkdir(exist_ok=True)
    
    filename = file.filename
    file_path = weights_dir / filename
    
    with open(file_path, "wb") as buffer:
        content = await file.read()
        buffer.write(content)
        
    # Update DB path
    if type == "visual":
        settings.visual_model_path = str(file_path)
    elif type == "acoustic":
        settings.acoustic_model_path = str(file_path)
        
    session.add(settings)
    session.commit()
    
    return {"message": "Model uploaded successfully", "path": str(file_path)}


# --- Fusion API Endpoints ---
from app.fusion import (
    get_species_color_mapping,
    find_overlapping_arus,
    generate_fusion_report,
    DEFAULT_SPECIES_COLOR_MAPPING
)
from app.calibration import (
    rebuild_calibration_windows,
    list_calibration_windows,
    calibration_curve_summary,
    build_calibration_feature_rows,
    calibration_backtest_report,
    calibration_train_summary,
    calibration_predict_density,
)


@app.get("/api/settings/species_colors")
def get_species_colors_mapping(session: Session = Depends(get_session)):
    """
    Returns the species-to-color mapping.
    """
    mapping = get_species_color_mapping(session)
    return {"mapping": mapping}


@app.post("/api/settings/species_colors")
def update_species_colors_mapping(
    mapping: dict,
    session: Session = Depends(get_session)
):
    """
    Updates the species-to-color mapping.
    Expected format: {"white": ["Great Egret", ...], "black": ["Oriental Darter", ...]}
    """
    settings = session.get(SystemSettings, 1)
    if not settings:
        settings = SystemSettings(id=1)
    
    settings.species_color_mapping = json.dumps(mapping)
    session.add(settings)
    session.commit()
    session.refresh(settings)
    
    return {"message": "Species color mapping updated", "mapping": mapping}


@app.get("/api/fusion/overlapping")
def get_overlapping_arus(
    survey_id: int,
    session: Session = Depends(get_session)
):
    """
    Returns ARUs that overlap with the given survey's bounding box.
    """
    arus = find_overlapping_arus(session, survey_id)
    return {
        "survey_id": survey_id,
        "overlapping_arus": [
            {"id": aru.id, "name": aru.name, "lat": aru.lat, "lon": aru.lon}
            for aru in arus
        ]
    }


@app.get("/api/fusion/report")
def get_fusion_report(
    visual_survey_id: int,
    acoustic_survey_id: Optional[int] = None,
    aru_id: Optional[int] = None,
    session: Session = Depends(get_session)
):
    """
    Generate a combined analysis report for overlapping survey/ARU data.
    
    Args:
        visual_survey_id: The drone/visual survey ID (required)
        acoustic_survey_id: The acoustic survey ID (optional)
        aru_id: The ARU ID for acoustic detections (optional, used if acoustic_survey_id not provided)
    """
    report = generate_fusion_report(session, visual_survey_id, acoustic_survey_id, aru_id)
    return report


@app.post("/api/calibration/windows/rebuild")
def rebuild_windows(
    max_days_apart: int = Query(default=14, ge=0, le=120),
    buffer_meters: float = Query(default=150.0, ge=0.0, le=5000.0),
    min_acoustic_calls: int = Query(default=1, ge=0, le=100000),
    session: Session = Depends(get_session),
):
    """
    Rebuilds paired acoustic/drone windows used for call-rate calibration.
    """
    return rebuild_calibration_windows(
        session=session,
        max_days_apart=max_days_apart,
        buffer_meters=buffer_meters,
        min_acoustic_calls=min_acoustic_calls,
    )


@app.get("/api/calibration/windows")
def get_calibration_windows(
    min_calls: int = Query(default=0, ge=0, le=100000),
    limit: int = Query(default=200, ge=1, le=2000),
    session: Session = Depends(get_session),
):
    """
    Returns paired calibration windows for inspection and downstream analysis.
    """
    return list_calibration_windows(session=session, min_calls=min_calls, limit=limit)


@app.get("/api/calibration/summary")
def get_calibration_summary(
    min_calls: int = Query(default=1, ge=0, le=100000),
    session: Session = Depends(get_session),
):
    """
    Returns a simple calibration factor from current windows.
    """
    return calibration_curve_summary(session=session, min_calls=min_calls)


@app.get("/api/calibration/features")
def get_calibration_features(
    min_calls: int = Query(default=1, ge=0, le=100000),
    top_species: int = Query(default=5, ge=0, le=20),
    session: Session = Depends(get_session),
):
    """
    Returns feature rows used for calibration (including species-specific rates).
    """
    return build_calibration_feature_rows(
        session=session, min_calls=min_calls, top_species=top_species
    )


@app.get("/api/calibration/backtest")
def get_calibration_backtest(
    min_calls: int = Query(default=1, ge=0, le=100000),
    top_species: int = Query(default=5, ge=0, le=20),
    session: Session = Depends(get_session),
):
    """
    Grouped backtest report for linear vs non-linear calibration models.
    """
    return calibration_backtest_report(
        session=session, min_calls=min_calls, top_species=top_species
    )


@app.get("/api/calibration/model")
def get_calibration_model_summary(
    min_calls: int = Query(default=1, ge=0, le=100000),
    top_species: int = Query(default=5, ge=0, le=20),
    session: Session = Depends(get_session),
):
    """
    Returns fitted model coefficients and training metrics.
    """
    return calibration_train_summary(
        session=session, min_calls=min_calls, top_species=top_species
    )


@app.get("/api/calibration/predict")
def predict_calibration_density(
    acoustic_survey_id: int = Query(..., ge=1),
    aru_id: int = Query(..., ge=1),
    model: str = Query(default="best", pattern="^(best|linear|quadratic)$"),
    min_calls: int = Query(default=1, ge=0, le=100000),
    top_species: int = Query(default=5, ge=0, le=20),
    session: Session = Depends(get_session),
):
    """
    Estimates drone-equivalent density from ARU acoustic activity.
    """
    return calibration_predict_density(
        session=session,
        acoustic_survey_id=acoustic_survey_id,
        aru_id=aru_id,
        model=model,
        min_calls=min_calls,
        top_species=top_species,
    )


BASE_DIR = Path(__file__).resolve().parent.parent
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
