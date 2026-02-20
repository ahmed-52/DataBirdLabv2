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

export interface CalibrationWindow {
    id: number
    acoustic_survey_id: number
    visual_survey_id: number
    aru_id: number
    days_apart: number
    buffer_meters: number
    acoustic_call_count: number
    acoustic_asset_count: number
    acoustic_calls_per_asset: number
    drone_detection_count: number
    drone_area_hectares: number
    drone_density_per_hectare: number
    created_at: string
}

export interface CalibrationSummary {
    window_count: number
    usable_count?: number
    simple_factor_density_per_call_per_asset?: number
    message?: string
}

export interface CalibrationBacktestReport {
    window_count: number
    feature_names?: string[]
    species_features?: string[]
    message?: string
    folds: Array<{
        held_out_visual_survey_id: number
        train_windows: number
        test_windows: number
        linear_metrics: { rmse: number; mae: number; r2: number }
        quadratic_metrics: { rmse: number; mae: number; r2: number }
    }>
    overall?: {
        linear: { rmse: number; mae: number; r2: number }
        quadratic: { rmse: number; mae: number; r2: number }
        recommended_model: "linear" | "quadratic"
    }
}

// Filter state type
export interface FilterState {
    mode: "7d" | "30d"
    selectedSurveyIds: number[]
}
