// Shared type definitions for DataBirdLab

export interface Survey {
    id: number
    name: string
    date: string
    type: "drone" | "acoustic"
    aru?: {
        id: number
        name: string
    } | null
    bounds?: {
        min_lat: number | null
        max_lat: number | null
        min_lon: number | null
        max_lon: number | null
    }
}

export interface VisualDetection {
    id: string
    species: string
    confidence: number
    lat: number
    lon: number
    bbox: { cx: number; cy: number; w: number; h: number }
    imageUrl: string
    timestamp: string
    survey_id: number
    survey_name: string
    asset_id: number
    validation_status?: "pending" | "validated" | "rejected"
}

export interface AcousticDetection {
    id: string
    species: string
    confidence: number
    lat: number
    lon: number
    radius: number
    timestamp: string
    audioUrl: string
    aru_id: number | null
    survey_id: number
    validation_status?: "pending" | "validated" | "rejected"
}

export interface ARU {
    id: number
    name: string
    lat: number
    lon: number
}

export interface SystemSettings {
    id: number
    confidence_threshold: number
    default_lat: number
    default_lon: number
    acoustic_model_path: string | null
    visual_model_path: string | null
    species_color_mapping: Record<string, string[]>
}

export interface FusionReport {
    visual_survey_id: number
    acoustic_survey_id: number
    visual_counts: Record<string, number>
    acoustic_counts: Record<string, number>
    species_color_mapping: Record<string, string[]>
}

// Filter state type
export interface FilterState {
    mode: "7d" | "30d"
    selectedSurveyIds: number[]
}
