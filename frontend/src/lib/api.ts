// Centralized API layer for DataBirdLab
// Replaces scattered fetch calls and mockData.ts

import type {
    Survey,
    SurveyMapDetection,
    VisualDetection,
    AcousticDetection,
    ARU,
    SystemSettings,
    FusionReport,
    CalibrationWindow,
    CalibrationSummary,
    CalibrationBacktestReport,
} from "@/types"
import { apiClient } from "./apiClient"

// --- Surveys ---

export async function fetchSurveys(): Promise<Survey[]> {
    return apiClient.get(`/api/surveys`)
}

export async function deleteSurvey(surveyId: number): Promise<void> {
    await apiClient.delete(`/api/surveys/${surveyId}`)
}

export async function fetchSurveyStatus(surveyId: number) {
    return apiClient.get(`/api/surveys/${surveyId}/status`)
}

export async function fetchSurveyMapData(surveyId: number): Promise<SurveyMapDetection[]> {
    return apiClient.get(`/api/surveys/${surveyId}/map_data`)
}

// --- Detections ---

export async function fetchVisualDetections(
    days: number = 7,
    surveyIds?: number[]
): Promise<VisualDetection[]> {
    let url = `/api/detections/visual?days=${days}`
    if (surveyIds && surveyIds.length > 0) {
        url += `&survey_ids=${surveyIds.join(",")}`
    }
    return apiClient.get(url)
}

export async function fetchAcousticDetections(
    days: number = 7,
    surveyIds?: number[]
): Promise<AcousticDetection[]> {
    let url = `/api/detections/acoustic?days=${days}`
    if (surveyIds && surveyIds.length > 0) {
        url += `&survey_ids=${surveyIds.join(",")}`
    }
    return apiClient.get(url)
}

// Convenience function to fetch both
export async function fetchEcologicalData(
    days: number = 7,
    surveyIds?: number[]
) {
    const [visualDetections, acousticDetections] = await Promise.all([
        fetchVisualDetections(days, surveyIds),
        fetchAcousticDetections(days, surveyIds),
    ])
    return { visualDetections, acousticDetections }
}

// --- ARUs ---

export async function fetchARUs(): Promise<ARU[]> {
    return apiClient.get(`/api/arus`)
}

export async function fetchARUDetections(
    aruId: number,
    days: number = 7,
    surveyIds?: number[]
): Promise<AcousticDetection[]> {
    let url = `/api/arus/${aruId}/detections?days=${days}`
    if (surveyIds && surveyIds.length > 0) {
        url += `&survey_ids=${surveyIds.join(",")}`
    }
    return apiClient.get(url)
}

// --- Stats ---

export async function fetchSpeciesStats(days: number = 7, surveyId?: number) {
    let url = `/api/stats/species?days=${days}`
    if (surveyId) url += `&survey_id=${surveyId}`
    return apiClient.get(url)
}

export async function fetchOverviewStats(days: number = 7, surveyId?: number) {
    let url = `/api/stats/overview?days=${days}`
    if (surveyId) url += `&survey_id=${surveyId}`
    return apiClient.get(url)
}

export async function fetchHourlyActivity(surveyId: number, aruId?: number) {
    let url = `/api/acoustic/activity/hourly?survey_id=${surveyId}`
    if (aruId) url += `&aru_id=${aruId}`
    return apiClient.get(url)
}

export async function fetchSpeciesHistory(
    speciesName: string,
    days: number = 7,
    type: "visual" | "acoustic" = "visual"
) {
    const url = `/api/stats/species_history?species_name=${encodeURIComponent(speciesName)}&days=${days}&type=${type}`
    return apiClient.get(url)
}

export async function fetchSpeciesList(type: "visual" | "acoustic" = "visual") {
    return apiClient.get(`/api/species_list?type=${type}`)
}

// --- Settings ---

export async function fetchSettings(): Promise<SystemSettings> {
    return apiClient.get(`/api/settings`)
}

export async function updateSettings(
    settings: Partial<SystemSettings>
): Promise<SystemSettings> {
    // PUT verb is not exposed by apiClient — use patch as semantically closest
    // backend accepts both POST and PUT for /api/settings, so use POST to align
    return apiClient.post(`/api/settings`, settings)
}

export async function fetchSpeciesColorMapping(): Promise<Record<string, string[]>> {
    const data = await apiClient.get(`/api/settings/species_colors`)
    return data?.mapping ?? {}
}

export async function updateSpeciesColorMapping(
    mapping: Record<string, string[]>
): Promise<Record<string, string[]>> {
    const data = await apiClient.post(`/api/settings/species_colors`, mapping)
    return data?.mapping ?? mapping
}

// --- Fusion ---

export async function fetchFusionReport(
    visualSurveyId: number,
    acousticSurveyId: number
): Promise<FusionReport> {
    const url = `/api/fusion/report?visual_survey_id=${visualSurveyId}&acoustic_survey_id=${acousticSurveyId}`
    return apiClient.get(url)
}

// --- Survey Import (Multipart) ---

export async function importSurvey(formData: FormData) {
    return apiClient.post(`/api/surveys/import`, formData)
}

// --- Calibration ---

export async function rebuildCalibrationWindows(params?: {
    max_days_apart?: number
    buffer_meters?: number
    min_acoustic_calls?: number
}) {
    const query = new URLSearchParams()
    if (params?.max_days_apart !== undefined) {
        query.set("max_days_apart", String(params.max_days_apart))
    }
    if (params?.buffer_meters !== undefined) {
        query.set("buffer_meters", String(params.buffer_meters))
    }
    if (params?.min_acoustic_calls !== undefined) {
        query.set("min_acoustic_calls", String(params.min_acoustic_calls))
    }

    const suffix = query.toString() ? `?${query.toString()}` : ""
    return apiClient.post(`/api/calibration/windows/rebuild${suffix}`, {})
}

export async function fetchCalibrationWindows(params?: {
    min_calls?: number
    limit?: number
}): Promise<CalibrationWindow[]> {
    const query = new URLSearchParams()
    if (params?.min_calls !== undefined) query.set("min_calls", String(params.min_calls))
    if (params?.limit !== undefined) query.set("limit", String(params.limit))
    const suffix = query.toString() ? `?${query.toString()}` : ""

    return apiClient.get(`/api/calibration/windows${suffix}`)
}

export async function fetchCalibrationSummary(minCalls: number = 1): Promise<CalibrationSummary> {
    return apiClient.get(`/api/calibration/summary?min_calls=${minCalls}`)
}

export async function fetchCalibrationBacktest(params?: {
    min_calls?: number
    top_species?: number
}): Promise<CalibrationBacktestReport> {
    const query = new URLSearchParams()
    if (params?.min_calls !== undefined) query.set("min_calls", String(params.min_calls))
    if (params?.top_species !== undefined) query.set("top_species", String(params.top_species))
    const suffix = query.toString() ? `?${query.toString()}` : ""

    return apiClient.get(`/api/calibration/backtest${suffix}`)
}
