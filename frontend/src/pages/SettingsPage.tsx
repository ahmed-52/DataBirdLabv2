import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, Loader2, Save, Settings } from "lucide-react"
import {
    Bar,
    CartesianGrid,
    ComposedChart,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Scatter,
    ScatterChart,
    Tooltip as ReTooltip,
    XAxis,
    YAxis,
} from "recharts"
import { Circle, CircleMarker, MapContainer, TileLayer, Tooltip as LeafletTooltip } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import {
    fetchARUDetections,
    fetchARUs,
    fetchSpeciesColorMapping,
    fetchSurveyMapData,
    fetchSurveys,
    updateSpeciesColorMapping,
} from "@/lib/api"
import type { AcousticDetection, ARU, Survey, SurveyMapDetection } from "@/types"
import { useCurrentColony } from "@/contexts/CurrentColonyContext"

const COLOR_BUCKETS = ["white", "black", "brown", "grey"] as const

type ColorBucket = (typeof COLOR_BUCKETS)[number]

type BucketMapping = Record<ColorBucket, string[]>

function approxDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const dLat = (lat2 - lat1) * 111_320
    const meanLat = (lat1 + lat2) / 2
    const dLon = (lon2 - lon1) * (111_320 * Math.max(0.1, Math.cos((meanLat * Math.PI) / 180)))
    return Math.hypot(dLat, dLon)
}

function normalizeLabel(input: string): string {
    return input
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/[^a-z0-9 ]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

function formatDroneClass(input: string): string {
    return input
        .replace(/_/g, " ")
        .replace(/\b\w/g, (m) => m.toUpperCase())
}

function classToBucket(className: string): ColorBucket | null {
    const c = className.toLowerCase()
    if (c.includes("white")) return "white"
    if (c.includes("black")) return "black"
    if (c.includes("brown")) return "brown"
    if (c.includes("grey") || c.includes("gray")) return "grey"
    return null
}

function classColor(className: string, selectedClass: string): string {
    if (className === selectedClass) return "#dc2626"
    const hash = className.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
    const hue = hash % 360
    return `hsl(${hue} 70% 45%)`
}

function normalizeBucketMapping(raw: Record<string, string[]>): BucketMapping {
    return {
        white: [...new Set(raw.white ?? [])],
        black: [...new Set(raw.black ?? [])],
        brown: [...new Set(raw.brown ?? [])],
        grey: [...new Set(raw.grey ?? [])],
    }
}

export default function SettingsPage() {
    const { currentColony } = useCurrentColony()
    const [arus, setArus] = useState<ARU[]>([])
    const [surveys, setSurveys] = useState<Survey[]>([])

    const [acousticDetections, setAcousticDetections] = useState<AcousticDetection[]>([])
    const [droneDetections, setDroneDetections] = useState<SurveyMapDetection[]>([])

    const [selectedAruId, setSelectedAruId] = useState<number | null>(null)
    const [selectedDroneSurveyId, setSelectedDroneSurveyId] = useState<number | null>(null)
    const [selectedAcousticSpecies, setSelectedAcousticSpecies] = useState("Asian Openbill")
    const [selectedDroneClass, setSelectedDroneClass] = useState("asian_openbill")
    const [localRadiusMeters, setLocalRadiusMeters] = useState(100)

    const [bucketMapping, setBucketMapping] = useState<BucketMapping>({
        white: [],
        black: [],
        brown: [],
        grey: [],
    })

    const [newSpeciesByBucket, setNewSpeciesByBucket] = useState<Record<ColorBucket, string>>({
        white: "",
        black: "",
        brown: "",
        grey: "",
    })

    const [loadingBase, setLoadingBase] = useState(true)
    const [loadingAcoustic, setLoadingAcoustic] = useState(false)
    const [loadingDrone, setLoadingDrone] = useState(false)
    const [savingMapping, setSavingMapping] = useState(false)

    const [baseError, setBaseError] = useState<string | null>(null)
    const [acousticError, setAcousticError] = useState<string | null>(null)
    const [droneError, setDroneError] = useState<string | null>(null)
    const [mappingMessage, setMappingMessage] = useState<string | null>(null)

    const surveyById = useMemo(() => {
        const m = new Map<number, Survey>()
        surveys.forEach((s) => m.set(s.id, s))
        return m
    }, [surveys])

    const selectedAru = useMemo(
        () => (selectedAruId == null ? null : arus.find((a) => a.id === selectedAruId) ?? null),
        [arus, selectedAruId]
    )

    const droneSurveyOptions = useMemo(
        () => surveys.filter((s) => s.type === "drone"),
        [surveys]
    )

    const selectedDroneSurvey = useMemo(
        () =>
            selectedDroneSurveyId == null
                ? null
                : surveys.find((s) => s.id === selectedDroneSurveyId) ?? null,
        [surveys, selectedDroneSurveyId]
    )

    const loadBaseData = useCallback(async () => {
        setLoadingBase(true)
        setBaseError(null)

        try {
            const [surveysData, arusData, mappingData] = await Promise.all([
                fetchSurveys(),
                fetchARUs(),
                fetchSpeciesColorMapping(),
            ])

            const drones = surveysData.filter((s) => s.type === "drone")
            const defaultAru =
                arusData.find((a) => normalizeLabel(a.name).includes("beta")) ?? arusData[0] ?? null
            const defaultDrone =
                drones.find((s) => normalizeLabel(s.name).includes("aru2clipped")) ??
                drones[0] ??
                null

            setSurveys(surveysData)
            setArus(arusData)
            setBucketMapping(normalizeBucketMapping(mappingData))

            setSelectedAruId((prev) => {
                if (prev != null && arusData.some((a) => a.id === prev)) return prev
                return defaultAru?.id ?? null
            })

            setSelectedDroneSurveyId((prev) => {
                if (prev != null && drones.some((s) => s.id === prev)) return prev
                return defaultDrone?.id ?? null
            })
        } catch (e: any) {
            setBaseError(e?.message ?? "Failed to load calibration data")
        } finally {
            setLoadingBase(false)
        }
    }, [])

    useEffect(() => {
        loadBaseData()
    }, [loadBaseData])

    useEffect(() => {
        if (selectedAruId == null) {
            setAcousticDetections([])
            return
        }

        let active = true
        setLoadingAcoustic(true)
        setAcousticError(null)

        fetchARUDetections(selectedAruId, 3650)
            .then((data) => {
                if (active) setAcousticDetections(data)
            })
            .catch((e: any) => {
                if (active) {
                    setAcousticDetections([])
                    setAcousticError(e?.message ?? "Failed to load ARU detections")
                }
            })
            .finally(() => {
                if (active) setLoadingAcoustic(false)
            })

        return () => {
            active = false
        }
    }, [selectedAruId])

    useEffect(() => {
        if (selectedDroneSurveyId == null) {
            setDroneDetections([])
            return
        }

        let active = true
        setLoadingDrone(true)
        setDroneError(null)

        fetchSurveyMapData(selectedDroneSurveyId)
            .then((data) => {
                if (active) setDroneDetections(data)
            })
            .catch((e: any) => {
                if (active) {
                    setDroneDetections([])
                    setDroneError(e?.message ?? "Failed to load drone map data")
                }
            })
            .finally(() => {
                if (active) setLoadingDrone(false)
            })

        return () => {
            active = false
        }
    }, [selectedDroneSurveyId])

    const acousticSpeciesOptions = useMemo(
        () => [...new Set(acousticDetections.map((d) => d.species))].sort((a, b) => a.localeCompare(b)),
        [acousticDetections]
    )

    const droneClassOptions = useMemo(
        () => [...new Set(droneDetections.map((d) => d.class))].sort((a, b) => a.localeCompare(b)),
        [droneDetections]
    )

    useEffect(() => {
        if (acousticSpeciesOptions.length === 0) return
        if (acousticSpeciesOptions.includes(selectedAcousticSpecies)) return

        const preferred = acousticSpeciesOptions.find((s) => normalizeLabel(s) === "asian openbill")
        setSelectedAcousticSpecies(preferred ?? acousticSpeciesOptions[0])
    }, [acousticSpeciesOptions, selectedAcousticSpecies])

    useEffect(() => {
        if (droneClassOptions.length === 0) return
        if (droneClassOptions.includes(selectedDroneClass)) return

        const preferred = droneClassOptions.find((s) => normalizeLabel(s) === "asian openbill")
        setSelectedDroneClass(preferred ?? droneClassOptions[0])
    }, [droneClassOptions, selectedDroneClass])

    const localDroneDetections = useMemo(() => {
        if (!selectedAru) return []
        return droneDetections.filter(
            (d) => approxDistanceMeters(selectedAru.lat, selectedAru.lon, d.lat, d.lon) <= localRadiusMeters
        )
    }, [droneDetections, localRadiusMeters, selectedAru])

    const droneLocalCounts = useMemo(() => {
        const m = new Map<string, number>()
        localDroneDetections.forEach((d) => m.set(d.class, (m.get(d.class) ?? 0) + 1))
        return m
    }, [localDroneDetections])

    const droneSurveyCounts = useMemo(() => {
        const m = new Map<string, number>()
        droneDetections.forEach((d) => m.set(d.class, (m.get(d.class) ?? 0) + 1))
        return m
    }, [droneDetections])

    const selectedDroneTruthCount = droneLocalCounts.get(selectedDroneClass) ?? 0

    const acousticCountsBySpecies = useMemo(() => {
        const m = new Map<string, number>()
        acousticDetections.forEach((d) => m.set(d.species, (m.get(d.species) ?? 0) + 1))
        return m
    }, [acousticDetections])

    const timelineRows = useMemo(() => {
        const bySurvey = new Map<number, { speciesCount: number; totalCount: number }>()

        acousticDetections.forEach((d) => {
            const row = bySurvey.get(d.survey_id) ?? { speciesCount: 0, totalCount: 0 }
            row.totalCount += 1
            if (d.species === selectedAcousticSpecies) row.speciesCount += 1
            bySurvey.set(d.survey_id, row)
        })

        return [...bySurvey.entries()]
            .map(([surveyId, counts]) => {
                const survey = surveyById.get(surveyId)
                const dateObj = survey?.date ? new Date(survey.date) : null
                const dateLabel = dateObj && Number.isFinite(dateObj.getTime())
                    ? dateObj.toLocaleDateString(undefined, { month: "short", day: "numeric" })
                    : `Survey ${surveyId}`

                return {
                    surveyId,
                    surveyName: survey?.name ?? `Survey #${surveyId}`,
                    date: survey?.date ?? "",
                    label: `${dateLabel} #${surveyId}`,
                    acousticCount: counts.speciesCount,
                    totalCount: counts.totalCount,
                    droneTruthCount: selectedDroneTruthCount,
                    ratioToTruth:
                        selectedDroneTruthCount > 0
                            ? counts.speciesCount / selectedDroneTruthCount
                            : null,
                }
            })
            .sort((a, b) => {
                const da = new Date(a.date).getTime()
                const db = new Date(b.date).getTime()
                if (Number.isFinite(da) && Number.isFinite(db) && da !== db) return da - db
                return a.surveyId - b.surveyId
            })
    }, [acousticDetections, selectedAcousticSpecies, selectedDroneTruthCount, surveyById])

    const acousticBreakdownRows = useMemo(() => {
        const total = acousticDetections.length
        return [...acousticCountsBySpecies.entries()]
            .map(([species, count]) => ({
                species,
                count,
                sharePct: total > 0 ? (count / total) * 100 : 0,
            }))
            .sort((a, b) => b.count - a.count)
    }, [acousticCountsBySpecies, acousticDetections.length])

    const droneBreakdownRows = useMemo(() => {
        const localTotal = localDroneDetections.length
        return [...droneLocalCounts.entries()]
            .map(([className, localCount]) => ({
                className,
                localCount,
                surveyCount: droneSurveyCounts.get(className) ?? 0,
                localSharePct: localTotal > 0 ? (localCount / localTotal) * 100 : 0,
            }))
            .sort((a, b) => b.localCount - a.localCount)
    }, [droneLocalCounts, droneSurveyCounts, localDroneDetections.length])

    const classRelationshipRows = useMemo(() => {
        const allAcousticSpecies = acousticSpeciesOptions

        return droneBreakdownRows.map((row) => {
            const bucket = classToBucket(row.className)
            const mappedSpecies =
                bucket != null
                    ? bucketMapping[bucket]
                    : allAcousticSpecies.filter(
                          (sp) => normalizeLabel(sp) === normalizeLabel(row.className)
                      )

            const mappedAcousticCount = mappedSpecies.reduce(
                (sum, sp) => sum + (acousticCountsBySpecies.get(sp) ?? 0),
                0
            )

            return {
                ...row,
                bucket,
                mappedSpecies,
                mappedAcousticCount,
            }
        })
    }, [acousticSpeciesOptions, acousticCountsBySpecies, bucketMapping, droneBreakdownRows])

    const relationshipScatter = useMemo(
        () =>
            classRelationshipRows.map((r) => ({
                className: formatDroneClass(r.className),
                x: r.mappedAcousticCount,
                y: r.localCount,
            })),
        [classRelationshipRows]
    )

    const localAreaHectares = useMemo(
        () => (Math.PI * localRadiusMeters * localRadiusMeters) / 10_000,
        [localRadiusMeters]
    )

    const addSpeciesToBucket = (bucket: ColorBucket) => {
        const species = newSpeciesByBucket[bucket].trim()
        if (!species) return

        setBucketMapping((prev) => {
            const current = prev[bucket]
            if (current.includes(species)) return prev
            return { ...prev, [bucket]: [...current, species] }
        })

        setNewSpeciesByBucket((prev) => ({ ...prev, [bucket]: "" }))
    }

    const removeSpeciesFromBucket = (bucket: ColorBucket, species: string) => {
        setBucketMapping((prev) => ({
            ...prev,
            [bucket]: prev[bucket].filter((s) => s !== species),
        }))
    }

    const saveBucketMapping = async () => {
        setSavingMapping(true)
        setMappingMessage(null)
        try {
            const saved = await updateSpeciesColorMapping(bucketMapping)
            setBucketMapping(normalizeBucketMapping(saved))
            setMappingMessage("Saved class linking for white/black/brown/grey buckets")
        } catch (e: any) {
            setMappingMessage(e?.message ?? "Failed to save class linking")
        } finally {
            setSavingMapping(false)
        }
    }

    const loadingAny = loadingBase || loadingAcoustic || loadingDrone

    return (
        <div className="p-6 md:p-10 max-w-[1500px] mx-auto space-y-5 min-h-screen bg-background">
            <div className="flex items-end justify-between border-b border-border pb-4">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <Settings className="h-4 w-4 text-zinc-400" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 font-mono">
                            System
                        </span>
                    </div>
                    <h1 className="text-3xl font-display font-bold text-zinc-900 tracking-tight leading-none">
                        Calibration Simplified
                    </h1>
                    <p className="text-xs text-zinc-500 font-mono mt-1">
                        Station + survey analysis: acoustic detections vs drone truth within local ARU radius
                    </p>
                </div>
                <button
                    onClick={loadBaseData}
                    disabled={loadingBase}
                    className="px-3 py-1.5 text-xs font-bold uppercase border border-zinc-200 rounded-sm hover:bg-zinc-50 disabled:opacity-50 font-mono"
                >
                    Reload
                </button>
            </div>

            {(baseError || acousticError || droneError) && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-sm text-xs font-mono border bg-rose-50 border-rose-200 text-rose-800">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{baseError ?? acousticError ?? droneError}</span>
                </div>
            )}

            <div className="tech-card rounded-lg p-5 space-y-4">
                <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-700">Query Controls</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                        <label className="block text-[10px] font-bold uppercase text-zinc-500 mb-1.5 font-mono">
                            Acoustic Station
                        </label>
                        <select
                            value={selectedAruId ?? ""}
                            onChange={(e) => setSelectedAruId(e.target.value ? Number(e.target.value) : null)}
                            className="w-full rounded-sm border border-zinc-200 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-zinc-400"
                        >
                            <option value="">Select station</option>
                            {arus.map((a) => (
                                <option key={a.id} value={a.id}>
                                    {a.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-[10px] font-bold uppercase text-zinc-500 mb-1.5 font-mono">
                            Drone Survey
                        </label>
                        <select
                            value={selectedDroneSurveyId ?? ""}
                            onChange={(e) =>
                                setSelectedDroneSurveyId(e.target.value ? Number(e.target.value) : null)
                            }
                            className="w-full rounded-sm border border-zinc-200 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-zinc-400"
                        >
                            <option value="">Select survey</option>
                            {droneSurveyOptions.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-[10px] font-bold uppercase text-zinc-500 mb-1.5 font-mono">
                            Acoustic Species
                        </label>
                        <select
                            value={selectedAcousticSpecies}
                            onChange={(e) => setSelectedAcousticSpecies(e.target.value)}
                            className="w-full rounded-sm border border-zinc-200 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-zinc-400"
                        >
                            {acousticSpeciesOptions.map((s) => (
                                <option key={s} value={s}>
                                    {s}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-[10px] font-bold uppercase text-zinc-500 mb-1.5 font-mono">
                            Drone Truth Class
                        </label>
                        <select
                            value={selectedDroneClass}
                            onChange={(e) => setSelectedDroneClass(e.target.value)}
                            className="w-full rounded-sm border border-zinc-200 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-zinc-400"
                        >
                            {droneClassOptions.map((c) => (
                                <option key={c} value={c}>
                                    {formatDroneClass(c)}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-4 items-end">
                    <div>
                        <label className="block text-[10px] font-bold uppercase text-zinc-500 mb-1.5 font-mono">
                            Local Radius (meters)
                        </label>
                        <input
                            type="range"
                            min={20}
                            max={400}
                            step={5}
                            value={localRadiusMeters}
                            onChange={(e) => setLocalRadiusMeters(Number(e.target.value))}
                            className="w-full"
                        />
                    </div>
                    <div>
                        <input
                            type="number"
                            min={20}
                            max={2000}
                            value={localRadiusMeters}
                            onChange={(e) => setLocalRadiusMeters(Math.max(1, Number(e.target.value) || 1))}
                            className="w-full rounded-sm border border-zinc-200 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-zinc-400"
                        />
                    </div>
                </div>

                <div className="text-[10px] font-mono text-zinc-500">
                    Radius reference point: <strong>{selectedAru?.name ?? "Selected ARU"}</strong> at
                    {selectedAru ? ` (${selectedAru.lat.toFixed(5)}, ${selectedAru.lon.toFixed(5)})` : " N/A"}.
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="tech-card rounded-lg p-4">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1 font-mono">
                        Acoustic Surveys
                    </div>
                    <div className="text-3xl font-mono font-bold text-zinc-900">{timelineRows.length}</div>
                </div>
                <div className="tech-card rounded-lg p-4">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1 font-mono">
                        {selectedAcousticSpecies || "Species"} Calls
                    </div>
                    <div className="text-3xl font-mono font-bold text-zinc-900">
                        {timelineRows.reduce((sum, row) => sum + row.acousticCount, 0)}
                    </div>
                </div>
                <div className="tech-card rounded-lg p-4">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1 font-mono">
                        Drone Truth ({formatDroneClass(selectedDroneClass)})
                    </div>
                    <div className="text-3xl font-mono font-bold text-zinc-900">{selectedDroneTruthCount}</div>
                </div>
                <div className="tech-card rounded-lg p-4">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1 font-mono">
                        Local Drone Detections
                    </div>
                    <div className="text-3xl font-mono font-bold text-zinc-900">{localDroneDetections.length}</div>
                </div>
            </div>

            <div className="tech-card rounded-lg p-5 space-y-3">
                <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-700">
                    {selectedAcousticSpecies || "Selected Species"} Over Time ({selectedAru?.name ?? "Station"})
                </h2>
                {!timelineRows.length ? (
                    <div className="h-[260px] flex items-center justify-center text-xs font-mono text-zinc-400 border border-dashed border-zinc-200 rounded-sm">
                        No acoustic detections for this station
                    </div>
                ) : (
                    <div className="h-[280px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={timelineRows} margin={{ top: 8, right: 20, left: 0, bottom: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                                <XAxis dataKey="label" tick={{ fontSize: 10, fontFamily: "monospace" }} />
                                <YAxis tick={{ fontSize: 10, fontFamily: "monospace" }} />
                                <ReTooltip
                                    contentStyle={{ fontSize: 11, fontFamily: "monospace" }}
                                    formatter={(value: number) => Number(value).toFixed(0)}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="acousticCount"
                                    name={`${selectedAcousticSpecies} calls`}
                                    stroke="#0f766e"
                                    strokeWidth={2}
                                    dot={{ r: 3 }}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>

            <div className="tech-card rounded-lg p-5 space-y-3">
                <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-700">
                    Acoustic vs Drone Truth (Selected Radius)
                </h2>
                <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={timelineRows} margin={{ top: 8, right: 20, left: 0, bottom: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                            <XAxis dataKey="label" tick={{ fontSize: 10, fontFamily: "monospace" }} />
                            <YAxis tick={{ fontSize: 10, fontFamily: "monospace" }} />
                            <Legend wrapperStyle={{ fontSize: 11, fontFamily: "monospace" }} />
                            <ReTooltip
                                contentStyle={{ fontSize: 11, fontFamily: "monospace" }}
                                formatter={(value: number) => Number(value).toFixed(0)}
                            />
                            <Bar
                                dataKey="acousticCount"
                                name={`${selectedAcousticSpecies} acoustic`}
                                fill="#0f766e"
                                opacity={0.8}
                            />
                            <Line
                                type="monotone"
                                dataKey="droneTruthCount"
                                name={`${formatDroneClass(selectedDroneClass)} drone truth`}
                                stroke="#dc2626"
                                strokeWidth={2}
                                dot={{ r: 2 }}
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
                <div className="text-[10px] font-mono text-zinc-500">
                    Drone truth is the local class count from survey <strong>{selectedDroneSurvey?.name ?? "-"}</strong>
                    within {localRadiusMeters}m of {selectedAru?.name ?? "the selected ARU"}. Area ={" "}
                    {localAreaHectares.toFixed(2)} ha.
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="tech-card rounded-lg p-5 space-y-3">
                    <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-700">Quick Drone Map</h2>
                    <div className="h-[380px] w-full rounded-sm overflow-hidden border border-zinc-200">
                        <MapContainer
                            center={
                                selectedAru
                                    ? [selectedAru.lat, selectedAru.lon]
                                    : currentColony
                                        ? [currentColony.lat, currentColony.lon]
                                        : [11.40547, 105.39735]
                            }
                            zoom={17}
                            style={{ height: "100%", width: "100%" }}
                            zoomControl={false}
                        >
                            <TileLayer
                                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                                attribution="Tiles © Esri"
                            />

                            {selectedAru && (
                                <>
                                    <Circle
                                        center={[selectedAru.lat, selectedAru.lon]}
                                        radius={localRadiusMeters}
                                        pathOptions={{ color: "#f59e0b", weight: 2, fillOpacity: 0.06 }}
                                    />
                                    <CircleMarker
                                        center={[selectedAru.lat, selectedAru.lon]}
                                        radius={6}
                                        pathOptions={{ color: "#111827", weight: 2, fillColor: "#fde68a", fillOpacity: 1 }}
                                    >
                                        <LeafletTooltip direction="top" offset={[0, -8]}>
                                            <div className="text-xs font-mono">{selectedAru.name}</div>
                                        </LeafletTooltip>
                                    </CircleMarker>
                                </>
                            )}

                            {droneDetections.map((d) => (
                                <CircleMarker
                                    key={d.id}
                                    center={[d.lat, d.lon]}
                                    radius={d.class === selectedDroneClass ? 4 : 2.7}
                                    pathOptions={{
                                        color: "#ffffff",
                                        weight: 0.8,
                                        fillColor: classColor(d.class, selectedDroneClass),
                                        fillOpacity: d.class === selectedDroneClass ? 0.95 : 0.75,
                                    }}
                                >
                                    <LeafletTooltip direction="top" offset={[0, -8]}>
                                        <div className="text-xs font-mono">
                                            <div className="font-bold">{formatDroneClass(d.class)}</div>
                                            <div>conf: {d.confidence.toFixed(2)}</div>
                                        </div>
                                    </LeafletTooltip>
                                </CircleMarker>
                            ))}
                        </MapContainer>
                    </div>
                    <div className="text-[10px] font-mono text-zinc-500">
                        Survey: {selectedDroneSurvey?.name ?? "-"} • Points: {droneDetections.length} • Highlighted:
                        {" "}
                        {formatDroneClass(selectedDroneClass)}
                    </div>
                </div>

                <div className="tech-card rounded-lg p-5 space-y-3">
                    <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-700">
                        Drone Class Breakdown (Local vs Survey)
                    </h2>
                    <div className="overflow-x-auto border border-zinc-200 rounded-sm">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-zinc-200 bg-zinc-50/70">
                                    {[
                                        "Drone Class",
                                        `Local (${localRadiusMeters}m)`,
                                        "Survey Total",
                                        "Local Share",
                                    ].map((h) => (
                                        <th
                                            key={h}
                                            className="text-left px-3 py-2 font-bold uppercase text-zinc-500 text-[10px] font-mono whitespace-nowrap"
                                        >
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {droneBreakdownRows.map((r) => (
                                    <tr
                                        key={r.className}
                                        className={`border-b border-zinc-100 ${
                                            r.className === selectedDroneClass ? "bg-amber-50/60" : ""
                                        }`}
                                    >
                                        <td className="px-3 py-2.5 font-mono">{formatDroneClass(r.className)}</td>
                                        <td className="px-3 py-2.5 font-mono font-bold">{r.localCount}</td>
                                        <td className="px-3 py-2.5 font-mono">{r.surveyCount}</td>
                                        <td className="px-3 py-2.5 font-mono">{r.localSharePct.toFixed(1)}%</td>
                                    </tr>
                                ))}
                                {!droneBreakdownRows.length && (
                                    <tr>
                                        <td colSpan={4} className="px-3 py-8 text-center text-zinc-400 font-mono">
                                            No drone detections in local radius
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="tech-card rounded-lg p-5 space-y-3">
                    <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-700">
                        Acoustic Species Breakdown ({selectedAru?.name ?? "Station"})
                    </h2>
                    <div className="overflow-x-auto border border-zinc-200 rounded-sm">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-zinc-200 bg-zinc-50/70">
                                    {["Acoustic Species", "Count", "%"].map((h) => (
                                        <th
                                            key={h}
                                            className="text-left px-3 py-2 font-bold uppercase text-zinc-500 text-[10px] font-mono whitespace-nowrap"
                                        >
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {acousticBreakdownRows.slice(0, 20).map((r) => (
                                    <tr
                                        key={r.species}
                                        className={`border-b border-zinc-100 ${
                                            r.species === selectedAcousticSpecies ? "bg-emerald-50/60" : ""
                                        }`}
                                    >
                                        <td className="px-3 py-2.5 font-mono">{r.species}</td>
                                        <td className="px-3 py-2.5 font-mono font-bold">{r.count}</td>
                                        <td className="px-3 py-2.5 font-mono">{r.sharePct.toFixed(1)}%</td>
                                    </tr>
                                ))}
                                {!acousticBreakdownRows.length && (
                                    <tr>
                                        <td colSpan={3} className="px-3 py-8 text-center text-zinc-400 font-mono">
                                            No acoustic detections for this station
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="tech-card rounded-lg p-5 space-y-3">
                    <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-700">
                        Drone-Class vs Acoustic-Link Relationship
                    </h2>
                    <div className="h-[260px] w-full border border-zinc-200 rounded-sm p-2">
                        <ResponsiveContainer width="100%" height="100%">
                            <ScatterChart margin={{ top: 10, right: 12, bottom: 20, left: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                                <XAxis
                                    type="number"
                                    dataKey="x"
                                    name="Mapped acoustic detections"
                                    tick={{ fontSize: 10, fontFamily: "monospace" }}
                                    label={{ value: "Mapped acoustic detections", position: "insideBottom", offset: -14, fontSize: 10 }}
                                />
                                <YAxis
                                    type="number"
                                    dataKey="y"
                                    name="Local drone detections"
                                    tick={{ fontSize: 10, fontFamily: "monospace" }}
                                    label={{ value: "Local drone detections", angle: -90, position: "insideLeft", fontSize: 10 }}
                                />
                                <ReTooltip
                                    contentStyle={{ fontSize: 11, fontFamily: "monospace" }}
                                    formatter={(value: number) => Number(value).toFixed(0)}
                                    labelFormatter={(_, payload) => payload?.[0]?.payload?.className ?? ""}
                                />
                                <Scatter data={relationshipScatter} fill="#2563eb" />
                            </ScatterChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            <div className="tech-card rounded-lg p-5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-700">
                        Link Acoustic Species to Drone Color Classes
                    </h2>
                    <button
                        onClick={saveBucketMapping}
                        disabled={savingMapping}
                        className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold uppercase rounded-sm disabled:opacity-60 flex items-center gap-2 font-mono"
                    >
                        {savingMapping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        Save Class Linking
                    </button>
                </div>

                {mappingMessage && (
                    <div className="text-[11px] font-mono px-3 py-2 rounded-sm border border-zinc-200 bg-zinc-50 text-zinc-700">
                        {mappingMessage}
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    {COLOR_BUCKETS.map((bucket) => {
                        const usedSpecies = bucketMapping[bucket]
                        const pickable = acousticSpeciesOptions.filter((s) => !usedSpecies.includes(s))
                        return (
                            <div key={bucket} className="border border-zinc-200 rounded-sm p-3 space-y-2">
                                <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 font-mono">
                                    {bucket} birds
                                </div>

                                <div className="min-h-[56px] flex flex-wrap gap-1 border border-zinc-100 rounded-sm p-2 bg-zinc-50/50">
                                    {usedSpecies.map((species) => (
                                        <button
                                            key={species}
                                            onClick={() => removeSpeciesFromBucket(bucket, species)}
                                            className="px-2 py-0.5 text-[10px] font-mono rounded-sm border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100"
                                            title="Remove mapping"
                                        >
                                            {species} ×
                                        </button>
                                    ))}
                                    {usedSpecies.length === 0 && (
                                        <span className="text-[10px] text-zinc-400 font-mono">No species linked</span>
                                    )}
                                </div>

                                <div className="flex gap-2">
                                    <select
                                        value={newSpeciesByBucket[bucket]}
                                        onChange={(e) =>
                                            setNewSpeciesByBucket((prev) => ({
                                                ...prev,
                                                [bucket]: e.target.value,
                                            }))
                                        }
                                        className="flex-1 rounded-sm border border-zinc-200 bg-white px-2 py-1.5 text-xs font-mono"
                                    >
                                        <option value="">Select species</option>
                                        {pickable.map((species) => (
                                            <option key={species} value={species}>
                                                {species}
                                            </option>
                                        ))}
                                    </select>
                                    <button
                                        onClick={() => addSpeciesToBucket(bucket)}
                                        className="px-2 py-1.5 text-xs font-bold uppercase rounded-sm border border-zinc-200 bg-zinc-100 hover:bg-zinc-200 font-mono"
                                    >
                                        Add
                                    </button>
                                </div>
                            </div>
                        )
                    })}
                </div>

                <div className="overflow-x-auto border border-zinc-200 rounded-sm">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-zinc-200 bg-zinc-50/70">
                                {[
                                    "Drone Class",
                                    "Local Drone Count",
                                    "Linked Acoustic Species",
                                    "Linked Acoustic Count",
                                ].map((h) => (
                                    <th
                                        key={h}
                                        className="text-left px-3 py-2 font-bold uppercase text-zinc-500 text-[10px] font-mono whitespace-nowrap"
                                    >
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {classRelationshipRows.map((r) => (
                                <tr key={r.className} className="border-b border-zinc-100">
                                    <td className="px-3 py-2.5 font-mono">{formatDroneClass(r.className)}</td>
                                    <td className="px-3 py-2.5 font-mono font-bold">{r.localCount}</td>
                                    <td className="px-3 py-2.5 font-mono">
                                        {r.mappedSpecies.length ? r.mappedSpecies.join(", ") : "-"}
                                    </td>
                                    <td className="px-3 py-2.5 font-mono">{r.mappedAcousticCount}</td>
                                </tr>
                            ))}
                            {!classRelationshipRows.length && (
                                <tr>
                                    <td colSpan={4} className="px-3 py-8 text-center text-zinc-400 font-mono">
                                        No class relationship rows
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {!loadingAny && (
                <div className="text-[10px] font-mono text-zinc-500">
                    Station: {selectedAru?.name ?? "-"} • Drone survey: {selectedDroneSurvey?.name ?? "-"} •
                    Acoustic detections loaded: {acousticDetections.length} • Drone detections loaded:{" "}
                    {droneDetections.length}
                </div>
            )}
        </div>
    )
}
