// Re-export interfaces for use in components
export interface VisualDetection {
    id: string;
    species: string;
    confidence: number;
    bbox: { x: number; y: number; w: number; h: number };
    lat: number;
    lon: number;
    imageUrl: string;
    timestamp: string;
    survey_id?: number;
    survey_name?: string;
}

export interface AcousticDetection {
    id: string;
    species: string;
    confidence: number;
    lat: number;
    lon: number;
    radius: number; // meters
    timestamp: string;
    audioUrl: string;
    aru_id?: number; // ARU database ID
    survey_id?: number;
}

// Initial Empty State (Data will be fetched in Dashboard)
export let visualDetections: VisualDetection[] = [];
export let acousticDetections: AcousticDetection[] = [];

export const fetchSurveys = async () => {
    try {
        const res = await fetch('/api/surveys');
        if (!res.ok) throw new Error('Failed to fetch surveys');
        return await res.json();
    } catch (e) {
        console.error(e);
        return [];
    }
};

export const fetchEcologicalData = async (days = 7, surveyIds: number[] = []) => {
    try {
        let query = `?days=${days}`;
        if (surveyIds.length > 0) {
            query += `&survey_ids=${surveyIds.join(',')}`;
        }

        const [visRes, audRes] = await Promise.all([
            fetch(`/api/detections/visual${query}`),
            fetch(`/api/detections/acoustic${query}`)
        ]);

        if (visRes.ok) {
            visualDetections = await visRes.json();
        }
        if (audRes.ok) {
            acousticDetections = await audRes.json();
        }

        return { visualDetections, acousticDetections };
    } catch (e) {
        console.error("Failed to fetch ecological data", e);
        return { visualDetections: [], acousticDetections: [] };
    }
};
