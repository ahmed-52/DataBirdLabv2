// Centralized API layer for DataBirdLab
// Replaces scattered fetch calls and mockData.ts

import type {
    Survey,
    VisualDetection,
    AcousticDetection,
    ARU,
    SystemSettings,
    FusionReport,
    CalibrationWindow,
    CalibrationSummary,
    CalibrationBacktestReport,
} from "@/types"

const API_BASE = "" // Uses Vite proxy, no need for http://localhost:8000

// --- Surveys ---

export async function fetchSurveys(): Promise<Survey[]> {
    const res = await fetch(`${API_BASE}/api/surveys`)
    if (!res.ok) throw new Error("Failed to fetch surveys")
    return res.json()
}

export async function deleteSurvey(surveyId: number): Promise<void> {
    const res = await fetch(`${API_BASE}/api/surveys/${surveyId}`, { method: "DELETE" })
    if (!res.ok) throw new Error("Failed to delete survey")
}

export async function fetchSurveyStatus(surveyId: number) {
    const res = await fetch(`${API_BASE}/api/surveys/${surveyId}/status`)
    if (!res.ok) throw new Error("Failed to fetch survey status")
    return res.json()
}

// --- Detections ---

export async function fetchVisualDetections(
    days: number = 7,
    surveyIds?: number[]
): Promise<VisualDetection[]> {
    let url = `${API_BASE}/api/detections/visual?days=${days}`
    if (surveyIds && surveyIds.length > 0) {
        url += `&survey_ids=${surveyIds.join(",")}`
    }
    const res = await fetch(url)
    if (!res.ok) throw new Error("Failed to fetch visual detections")
    return res.json()
}

export async function fetchAcousticDetections(
    days: number = 7,
    surveyIds?: number[]
): Promise<AcousticDetection[]> {
    let url = `${API_BASE}/api/detections/acoustic?days=${days}`
    if (surveyIds && surveyIds.length > 0) {
        url += `&survey_ids=${surveyIds.join(",")}`
    }
    const res = await fetch(url)
    if (!res.ok) throw new Error("Failed to fetch acoustic detections")
    return res.json()
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
    const res = await fetch(`${API_BASE}/api/arus`)
    if (!res.ok) throw new Error("Failed to fetch ARUs")
    return res.json()
}

export async function fetchARUDetections(
    aruId: number,
    days: number = 7,
    surveyIds?: number[]
): Promise<AcousticDetection[]> {
    let url = `${API_BASE}/api/arus/${aruId}/detections?days=${days}`
    if (surveyIds && surveyIds.length > 0) {
        url += `&survey_ids=${surveyIds.join(",")}`
    }
    const res = await fetch(url)
    if (!res.ok) throw new Error("Failed to fetch ARU detections")
    return res.json()
}

// --- Stats ---

export async function fetchSpeciesStats(days: number = 7, surveyId?: number) {
    let url = `${API_BASE}/api/stats/species?days=${days}`
    if (surveyId) url += `&survey_id=${surveyId}`
    const res = await fetch(url)
    if (!res.ok) throw new Error("Failed to fetch species stats")
    return res.json()
}

export async function fetchOverviewStats(days: number = 7, surveyId?: number) {
    let url = `${API_BASE}/api/stats/overview?days=${days}`
    if (surveyId) url += `&survey_id=${surveyId}`
    const res = await fetch(url)
    if (!res.ok) throw new Error("Failed to fetch overview stats")
    return res.json()
}

export async function fetchHourlyActivity(surveyId: number, aruId?: number) {
    let url = `${API_BASE}/api/acoustic/activity/hourly?survey_id=${surveyId}`
    if (aruId) url += `&aru_id=${aruId}`
    const res = await fetch(url)
    if (!res.ok) throw new Error("Failed to fetch hourly activity")
    return res.json()
}

export async function fetchSpeciesHistory(
    speciesName: string,
    days: number = 7,
    type: "visual" | "acoustic" = "visual"
) {
    const url = `${API_BASE}/api/stats/species_history?species_name=${encodeURIComponent(speciesName)}&days=${days}&type=${type}`
    const res = await fetch(url)
    if (!res.ok) throw new Error("Failed to fetch species history")
    return res.json()
}

export async function fetchSpeciesList(type: "visual" | "acoustic" = "visual") {
    const url = `${API_BASE}/api/species_list?type=${type}`
    const res = await fetch(url)
    if (!res.ok) throw new Error("Failed to fetch species list")
    return res.json()
}

// --- Settings ---

export async function fetchSettings(): Promise<SystemSettings> {
    const res = await fetch(`${API_BASE}/api/settings`)
    if (!res.ok) throw new Error("Failed to fetch settings")
    return res.json()
}

export async function updateSettings(
    settings: Partial<SystemSettings>
): Promise<SystemSettings> {
    const res = await fetch(`${API_BASE}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
    })
    if (!res.ok) throw new Error("Failed to update settings")
    return res.json()
}

// --- Fusion ---

export async function fetchFusionReport(
    visualSurveyId: number,
    acousticSurveyId: number
): Promise<FusionReport> {
    const url = `${API_BASE}/api/fusion/report?visual_survey_id=${visualSurveyId}&acoustic_survey_id=${acousticSurveyId}`
    const res = await fetch(url)
    if (!res.ok) throw new Error("Failed to fetch fusion report")
    return res.json()
}

// --- Survey Import (Multipart) ---

export async function importSurvey(formData: FormData) {
    const res = await fetch(`${API_BASE}/api/surveys/import`, {
        method: "POST",
        body: formData,
    })
    if (!res.ok) {
        const text = await res.text()
        throw new Error(text || "Failed to import survey")
    }
    return res.json()
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
    const res = await fetch(`${API_BASE}/api/calibration/windows/rebuild${suffix}`, {
        method: "POST",
    })
    if (!res.ok) throw new Error("Failed to rebuild calibration windows")
    return res.json()
}

export async function fetchCalibrationWindows(params?: {
    min_calls?: number
    limit?: number
}): Promise<CalibrationWindow[]> {
    const query = new URLSearchParams()
    if (params?.min_calls !== undefined) query.set("min_calls", String(params.min_calls))
    if (params?.limit !== undefined) query.set("limit", String(params.limit))
    const suffix = query.toString() ? `?${query.toString()}` : ""

    const res = await fetch(`${API_BASE}/api/calibration/windows${suffix}`)
    if (!res.ok) throw new Error("Failed to fetch calibration windows")
    return res.json()
}

export async function fetchCalibrationSummary(minCalls: number = 1): Promise<CalibrationSummary> {
    const res = await fetch(`${API_BASE}/api/calibration/summary?min_calls=${minCalls}`)
    if (!res.ok) throw new Error("Failed to fetch calibration summary")
    return res.json()
}

export async function fetchCalibrationBacktest(params?: {
    min_calls?: number
    top_species?: number
}): Promise<CalibrationBacktestReport> {
    const query = new URLSearchParams()
    if (params?.min_calls !== undefined) query.set("min_calls", String(params.min_calls))
    if (params?.top_species !== undefined) query.set("top_species", String(params.top_species))
    const suffix = query.toString() ? `?${query.toString()}` : ""

    const res = await fetch(`${API_BASE}/api/calibration/backtest${suffix}`)
    if (!res.ok) throw new Error("Failed to fetch calibration backtest")
    return res.json()
}
