"""
Data Fusion Module

Combines acoustic (BirdNET) and visual (Drone) detection data
to generate richer ecological insights.
"""

import json
from typing import Optional, Dict, List, Any
from sqlmodel import Session, select
from .models import Survey, MediaAsset, ARU, VisualDetection, AcousticDetection, SystemSettings

# Default species-color mapping (used if no custom mapping is set)
DEFAULT_SPECIES_COLOR_MAPPING = {
    "white": [
        "Great Egret",
        "Intermediate Egret", 
        "Little Egret",
        "Painted Stork",
        "Cattle Egret"
    ],
    "black": [
        "Oriental Darter",
        "Little Cormorant",
        "Indian Cormorant"
    ],
    "brown": [
        "Purple Heron",
        "Cinnamon Bittern"
    ],
    "grey": [
        "Grey Heron",
        "Black-crowned Night Heron"
    ]
}

# Species that the drone already classifies specifically (excluded from color inference)
DRONE_SPECIFIC_SPECIES = ["Asian Openbill", "Black-headed Ibis"]


def get_species_color_mapping(session: Session) -> Dict[str, List[str]]:
    """
    Get the species-color mapping from database settings.
    Falls back to default if not configured.
    """
    settings = session.exec(select(SystemSettings).where(SystemSettings.id == 1)).first()
    
    if settings and settings.species_color_mapping:
        try:
            return json.loads(settings.species_color_mapping)
        except json.JSONDecodeError:
            pass
    
    return DEFAULT_SPECIES_COLOR_MAPPING


def get_color_for_species(species_name: str, mapping: Dict[str, List[str]]) -> Optional[str]:
    """
    Given a species name, return its color category.
    Returns None if species not in mapping.
    """
    for color, species_list in mapping.items():
        if species_name in species_list:
            return color
    return None


def find_overlapping_arus(session: Session, survey_id: int) -> List[ARU]:
    """
    Find ARUs that fall within or near a survey's bounding box.
    """
    # Get survey bounds from its media assets
    assets = session.exec(
        select(MediaAsset).where(MediaAsset.survey_id == survey_id)
    ).all()
    
    if not assets:
        return []
    
    # Calculate survey bounding box from all assets
    min_lat = min(a.lat_tl for a in assets if a.lat_tl is not None)
    max_lat = max(a.lat_br for a in assets if a.lat_br is not None)
    min_lon = min(a.lon_tl for a in assets if a.lon_tl is not None)
    max_lon = max(a.lon_br for a in assets if a.lon_br is not None)
    
    if None in (min_lat, max_lat, min_lon, max_lon):
        return []
    
    # Add buffer (approx 100m = 0.001 degrees)
    buffer = 0.001
    
    # Find ARUs within bounds
    arus = session.exec(
        select(ARU).where(
            ARU.lat >= min_lat - buffer,
            ARU.lat <= max_lat + buffer,
            ARU.lon >= min_lon - buffer,
            ARU.lon <= max_lon + buffer
        )
    ).all()
    
    return list(arus)


def generate_fusion_report(
    session: Session,
    visual_survey_id: int,
    acoustic_survey_id: int = None,
    aru_id: int = None
) -> Dict[str, Any]:
    """
    Generate a combined analysis report for overlapping survey/ARU data.
    
    Args:
        visual_survey_id: The drone/visual survey ID
        acoustic_survey_id: The acoustic survey ID (optional, uses aru_id if not provided)
        aru_id: The ARU ID to filter acoustic detections (optional)
    """
    mapping = get_species_color_mapping(session)
    
    # Get visual detections for drone survey
    visual_query = (
        select(VisualDetection)
        .join(MediaAsset)
        .where(MediaAsset.survey_id == visual_survey_id)
    )
    visual_detections = session.exec(visual_query).all()
    
    # Get acoustic detections - either by survey_id or aru_id
    if acoustic_survey_id:
        acoustic_query = (
            select(AcousticDetection)
            .join(MediaAsset)
            .where(MediaAsset.survey_id == acoustic_survey_id)
        )
    elif aru_id:
        acoustic_query = (
            select(AcousticDetection)
            .join(MediaAsset)
            .where(MediaAsset.aru_id == aru_id)
        )
    else:
        acoustic_query = select(AcousticDetection).where(False)  # Empty result
    
    acoustic_detections = session.exec(acoustic_query).all()
    
    # Count visual detections by class
    visual_counts: Dict[str, int] = {}
    for det in visual_detections:
        cls = det.corrected_class or det.class_name
        visual_counts[cls] = visual_counts.get(cls, 0) + 1
    
    # Count acoustic detections by class
    acoustic_counts: Dict[str, int] = {}
    for det in acoustic_detections:
        cls = det.corrected_class or det.class_name
        acoustic_counts[cls] = acoustic_counts.get(cls, 0) + 1
    
    # Generate inferences
    # For each generic color class (white_bird, black_bird, etc.) seen by drone,
    # try to break it down using audio species
    inferences = []
    
    for color in ["white", "black", "brown", "grey"]:
        drone_key = f"{color}_birds"  # Match actual class names from drone (plural)
        drone_count = visual_counts.get(drone_key, 0)
        
        if drone_count == 0:
            continue
        
        # Find audio species that match this color
        species_in_color = mapping.get(color, [])
        audio_matches = {
            sp: acoustic_counts.get(sp, 0)
            for sp in species_in_color
            if acoustic_counts.get(sp, 0) > 0
        }
        
        total_audio_matches = sum(audio_matches.values())
        
        inferences.append({
            "color": color,
            "drone_class": drone_key,
            "drone_count": drone_count,
            "audio_species": audio_matches,
            "audio_total": total_audio_matches,
            "unidentified": max(0, drone_count - total_audio_matches)
        })
    
    return {
        "visual_survey_id": visual_survey_id,
        "acoustic_survey_id": acoustic_survey_id,
        "aru_id": aru_id,
        "visual_counts": visual_counts,
        "acoustic_counts": acoustic_counts,
        "inferences": inferences,
        "species_color_mapping": mapping
    }
