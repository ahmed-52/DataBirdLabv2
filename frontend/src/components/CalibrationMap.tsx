import { useMemo } from "react"
import { MapContainer, TileLayer, Rectangle, CircleMarker, Polyline, Tooltip } from "react-leaflet"
import type { LatLngExpression } from "leaflet"
import "leaflet/dist/leaflet.css"
import type { ARU, CalibrationWindow, Survey } from "@/types"

interface CalibrationMapProps {
    windows: CalibrationWindow[]
    surveys: Survey[]
    arus: ARU[]
    selectedWindowId: number | null
    onSelectWindow: (windowId: number) => void
}

function getDensityColor(value: number, min: number, max: number): string {
    if (!Number.isFinite(value)) return "#9ca3af"
    if (max <= min) return "#21918c"
    const t = Math.max(0, Math.min(1, (Math.log10(value + 1) - Math.log10(min + 1)) / (Math.log10(max + 1) - Math.log10(min + 1))))
    if (t < 0.25) return "#440154"
    if (t < 0.5) return "#3b528b"
    if (t < 0.75) return "#21918c"
    return "#5ec962"
}

function surveyCentroid(s: Survey): [number, number] | null {
    const b = s.bounds
    if (!b || b.min_lat == null || b.max_lat == null || b.min_lon == null || b.max_lon == null) return null
    return [(b.min_lat + b.max_lat) / 2, (b.min_lon + b.max_lon) / 2]
}

export default function CalibrationMap({
    windows,
    surveys,
    arus,
    selectedWindowId,
    onSelectWindow,
}: CalibrationMapProps) {
    const densityStats = useMemo(() => {
        const vals = windows.map((w) => w.drone_density_per_hectare).filter((v) => Number.isFinite(v))
        if (vals.length === 0) return { min: 0, max: 1 }
        return { min: Math.min(...vals), max: Math.max(...vals) }
    }, [windows])

    const surveyById = useMemo(() => {
        const m = new Map<number, Survey>()
        surveys.forEach((s) => m.set(s.id, s))
        return m
    }, [surveys])

    const aruById = useMemo(() => {
        const m = new Map<number, ARU>()
        arus.forEach((a) => m.set(a.id, a))
        return m
    }, [arus])

    const center: LatLngExpression = useMemo(() => {
        if (arus.length > 0) return [arus[0].lat, arus[0].lon]
        const first = surveys.find((s) => s.bounds?.min_lat != null)
        if (first?.bounds?.min_lat != null && first?.bounds?.min_lon != null) {
            return [first.bounds.min_lat, first.bounds.min_lon]
        }
        return [11.40547, 105.39735]
    }, [arus, surveys])

    const uniqueSurveyIds = Array.from(new Set(windows.map((w) => w.visual_survey_id)))

    return (
        <div className="h-[520px] w-full rounded-lg overflow-hidden border border-zinc-200 bg-white relative">
            <MapContainer center={center} zoom={15} style={{ height: "100%", width: "100%" }} zoomControl={false}>
                <TileLayer
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                    attribution="Tiles © Esri"
                />

                {uniqueSurveyIds.map((surveyId) => {
                    const s = surveyById.get(surveyId)
                    const b = s?.bounds
                    if (!s || !b || b.min_lat == null || b.max_lat == null || b.min_lon == null || b.max_lon == null) return null
                    return (
                        <Rectangle
                            key={`survey-${surveyId}`}
                            bounds={[[b.min_lat, b.min_lon], [b.max_lat, b.max_lon]]}
                            pathOptions={{ color: "#0f766e", weight: 1, fillOpacity: 0.06 }}
                        >
                            <Tooltip sticky>
                                <div className="text-xs font-mono">
                                    <div className="font-bold">Drone Survey #{surveyId}</div>
                                    <div>{s.name}</div>
                                </div>
                            </Tooltip>
                        </Rectangle>
                    )
                })}

                {windows.map((w) => {
                    const aru = aruById.get(w.aru_id)
                    const survey = surveyById.get(w.visual_survey_id)
                    const centroid = survey ? surveyCentroid(survey) : null
                    if (!aru || !centroid) return null

                    const color = getDensityColor(w.drone_density_per_hectare, densityStats.min, densityStats.max)
                    const selected = selectedWindowId === w.id
                    return (
                        <Polyline
                            key={`link-${w.id}`}
                            positions={[[aru.lat, aru.lon], centroid]}
                            pathOptions={{
                                color,
                                weight: selected ? 4 : 2,
                                opacity: selected ? 0.95 : 0.65,
                                dashArray: selected ? undefined : "4 6",
                            }}
                            eventHandlers={{ click: () => onSelectWindow(w.id) }}
                        >
                            <Tooltip sticky>
                                <div className="text-xs font-mono">
                                    <div className="font-bold">Window #{w.id}</div>
                                    <div>Density: {w.drone_density_per_hectare.toFixed(2)} / ha</div>
                                    <div>Calls/Asset: {w.acoustic_calls_per_asset.toFixed(2)}</div>
                                    <div>Days Apart: {w.days_apart}</div>
                                </div>
                            </Tooltip>
                        </Polyline>
                    )
                })}

                {arus.map((aru) => {
                    const aruWindows = windows.filter((w) => w.aru_id === aru.id)
                    const avgDensity =
                        aruWindows.length > 0
                            ? aruWindows.reduce((acc, w) => acc + w.drone_density_per_hectare, 0) / aruWindows.length
                            : 0
                    const color = getDensityColor(avgDensity, densityStats.min, densityStats.max)

                    return (
                        <CircleMarker
                            key={`aru-${aru.id}`}
                            center={[aru.lat, aru.lon]}
                            radius={Math.max(5, Math.min(14, 4 + Math.sqrt(Math.max(avgDensity, 0)) / 8))}
                            pathOptions={{
                                color: "#111827",
                                weight: 1,
                                fillColor: color,
                                fillOpacity: 0.9,
                            }}
                        >
                            <Tooltip sticky>
                                <div className="text-xs font-mono">
                                    <div className="font-bold">{aru.name}</div>
                                    <div>Windows: {aruWindows.length}</div>
                                    <div>Mean density: {avgDensity.toFixed(2)} / ha</div>
                                </div>
                            </Tooltip>
                        </CircleMarker>
                    )
                })}
            </MapContainer>

            <div className="absolute bottom-3 left-3 z-[400] bg-white/95 border border-zinc-200 rounded-sm p-2 text-[10px] font-mono text-zinc-700 space-y-1">
                <div className="font-bold uppercase tracking-wide">Density Scale</div>
                <div className="flex items-center gap-1">
                    <span className="inline-block w-3 h-2 bg-[#440154]" />
                    <span className="inline-block w-3 h-2 bg-[#3b528b]" />
                    <span className="inline-block w-3 h-2 bg-[#21918c]" />
                    <span className="inline-block w-3 h-2 bg-[#5ec962]" />
                </div>
                <div>Min: {densityStats.min.toFixed(2)} / ha</div>
                <div>Max: {densityStats.max.toFixed(2)} / ha</div>
                <div>Line = calibration window</div>
                <div>Point = ARU (mean density)</div>
            </div>
        </div>
    )
}
