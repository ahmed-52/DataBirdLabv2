from typing import Optional, List
from sqlmodel import Field, SQLModel, Relationship
from datetime import datetime



class ARU(SQLModel, table=True):
    """Acoustic Recording Unit - predefined or custom locations"""
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    lat: float
    lon: float
    
    # Relationships
    media_assets: List["MediaAsset"] = Relationship(back_populates="aru")


class Survey(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    date: datetime = Field(default_factory=datetime.now)
    type: str # 'drone' or 'acoustic'
    
    # Status tracking
    status: str = Field(default="pending") # pending, processing, completed, failed
    error_message: Optional[str] = None
    
    media: List["MediaAsset"] = Relationship(back_populates="survey")



class MediaAsset(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    survey_id: int = Field(foreign_key="survey.id")
    file_path: str 
    
    # --- GEOSPATIAL DATA ---
    # TL = Top Left, BR = Bottom Right
    lat_tl: Optional[float] = None
    lon_tl: Optional[float] = None
    lat_br: Optional[float] = None
    lon_br: Optional[float] = None
    # ---------------------------------------
    
    # ARU link for acoustic recordings
    aru_id: Optional[int] = Field(default=None, foreign_key="aru.id")

    is_processed: bool = False
    
    # Granular status
    status: str = Field(default="pending")
    error_message: Optional[str] = None
    
    is_validated: bool = False  

    # Relationships
    survey: Survey = Relationship(back_populates="media")
    aru: Optional[ARU] = Relationship(back_populates="media_assets")
    visual_detections: List["VisualDetection"] = Relationship(back_populates="asset")
    acoustic_detections: List["AcousticDetection"] = Relationship(back_populates="asset")


# 3. YOLO detections
class VisualDetection(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    asset_id: int = Field(foreign_key="mediaasset.id")

    confidence: float
    
    # AI Prediction
    class_name: str
    # bbox_json stores pixels: [x, y, w, h] inside the 1280x1280 image
    bbox_json: str  
    
    # We allow corrections here 
    # But the "Validated" status lives on the parent Asset
    corrected_class: Optional[str] = None
    corrected_bbox: Optional[str] = None

    asset: MediaAsset = Relationship(back_populates="visual_detections")


# 4. Acoustic Detection 
class AcousticDetection(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    asset_id: int = Field(foreign_key="mediaasset.id")
    
    # AI Prediction -- Have TO REVIEW THE OUTPUT OF MODEL
    class_name: str
    confidence: float
    
    start_time: float
    end_time: float
    
    # Human Correction
    is_human_reviewed: bool = True
    corrected_class: Optional[str] = None

    # Absolute timestamp of the detection
    absolute_start_time: Optional[datetime] = None

    asset: MediaAsset = Relationship(back_populates="acoustic_detections")


class SystemSettings(SQLModel, table=True):
    """
    Stores global configuration.
    Logic: We will always use the row with id=1.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    min_confidence: float = 0.25
    default_lat: float = 11.406949  # Boeung Sne
    default_lon: float = 105.394883
    
    # Path to custom weights (optional)
    # If None, use default 'BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite' or 'best.pt'
    acoustic_model_path: Optional[str] = None
    visual_model_path: Optional[str] = None
    
    # JSON string storing species-to-color mappings for fusion inference
    # Format: {"white": ["Great Egret", ...], "black": ["Oriental Darter", ...]}
    species_color_mapping: Optional[str] = None


class CalibrationWindow(SQLModel, table=True):
    """
    Paired acoustic/drone window used for calibration analysis.
    Each row links one ARU acoustic survey window with one nearby drone survey.
    """
    id: Optional[int] = Field(default=None, primary_key=True)

    # Pair references
    acoustic_survey_id: int = Field(foreign_key="survey.id")
    visual_survey_id: int = Field(foreign_key="survey.id")
    aru_id: int = Field(foreign_key="aru.id")

    # Pairing diagnostics
    days_apart: int
    buffer_meters: float

    # Acoustic metrics
    acoustic_call_count: int = 0
    acoustic_asset_count: int = 0
    acoustic_calls_per_asset: float = 0.0

    # Drone metrics
    drone_detection_count: int = 0
    drone_area_hectares: float = 0.0
    drone_density_per_hectare: float = 0.0

    created_at: datetime = Field(default_factory=datetime.now)
