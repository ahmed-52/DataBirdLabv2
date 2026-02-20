import { useEffect, useState } from "react"
import { Settings, RefreshCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    CartesianGrid,
    ComposedChart,
    Legend,
    Line,
    ResponsiveContainer,
    Scatter,
    Tooltip as ReTooltip,
    XAxis,
    YAxis,
} from "recharts"
import {
    fetchARUs,
    fetchCalibrationBacktest,
    fetchCalibrationSummary,
    fetchCalibrationWindows,
    fetchSurveys,
    rebuildCalibrationWindows,
} from "@/lib/api"
import type { ARU, CalibrationBacktestReport, CalibrationSummary, CalibrationWindow, Survey } from "@/types"
import CalibrationMap from "@/components/CalibrationMap"

export default function SettingsPage() {
    const [summary, setSummary] = useState<CalibrationSummary | null>(null)
    const [windows, setWindows] = useState<CalibrationWindow[]>([])
    const [loading, setLoading] = useState(true)
    const [rebuilding, setRebuilding] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)
    const [backtest, setBacktest] = useState<CalibrationBacktestReport | null>(null)
    const [backtesting, setBacktesting] = useState(false)
    const [topSpecies, setTopSpecies] = useState(5)
    const [surveys, setSurveys] = useState<Survey[]>([])
    const [arus, setArus] = useState<ARU[]>([])
    const [selectedWindowId, setSelectedWindowId] = useState<number | null>(null)
    const [daysApartFilter, setDaysApartFilter] = useState(30)

    const [maxDaysApart, setMaxDaysApart] = useState(14)
    const [bufferMeters, setBufferMeters] = useState(150)
    const [minAcousticCalls, setMinAcousticCalls] = useState(1)

    const loadCalibrationData = async () => {
        setLoading(true)
        setError(null)
        try {
            const [summaryData, windowData, surveyData, aruData] = await Promise.all([
                fetchCalibrationSummary(1),
                fetchCalibrationWindows({ min_calls: 1, limit: 200 }),
                fetchSurveys(),
                fetchARUs(),
            ])
            setSummary(summaryData)
            setWindows(windowData)
            setSurveys(surveyData)
            setArus(aruData)
            if (windowData.length > 0) {
                const maxDays = Math.max(...windowData.map((w) => w.days_apart))
                setDaysApartFilter(maxDays)
            }
            if (windowData.length > 0 && selectedWindowId == null) {
                setSelectedWindowId(windowData[0].id)
            }
        } catch (e: any) {
            setError(e?.message || "Failed to load calibration data")
        } finally {
            setLoading(false)
        }
    }

    const runBacktest = async () => {
        setBacktesting(true)
        setError(null)
        try {
            const out = await fetchCalibrationBacktest({
                min_calls: minAcousticCalls,
                top_species: topSpecies,
            })
            setBacktest(out)
        } catch (e: any) {
            setError(e?.message || "Failed to run backtest")
        } finally {
            setBacktesting(false)
        }
    }

    const filteredWindows = windows.filter((w) => w.days_apart <= daysApartFilter)

    const scatterData = filteredWindows.map((w) => ({
        x: w.acoustic_calls_per_asset,
        y: w.drone_density_per_hectare,
        id: w.id,
        days_apart: w.days_apart,
    }))

    const fitData = (() => {
        if (scatterData.length < 2) return [] as Array<{ x: number; linear: number; quadratic: number }>
        const xs = scatterData.map((d) => d.x)
        const ys = scatterData.map((d) => d.y)
        const n = xs.length

        const sumX = xs.reduce((a, b) => a + b, 0)
        const sumY = ys.reduce((a, b) => a + b, 0)
        const sumXY = xs.reduce((a, b, i) => a + b * ys[i], 0)
        const sumX2 = xs.reduce((a, b) => a + b * b, 0)
        const denom = n * sumX2 - sumX * sumX
        const m = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0
        const b = (sumY - m * sumX) / n

        const xMin = Math.min(...xs)
        const xMax = Math.max(...xs)
        const samples = 40

        // Quadratic least squares y = a0 + a1*x + a2*x^2
        const s1 = n
        const sx = sumX
        const sx2 = sumX2
        const sx3 = xs.reduce((a, x) => a + x * x * x, 0)
        const sx4 = xs.reduce((a, x) => a + x * x * x * x, 0)
        const sy = sumY
        const sxy = sumXY
        const sx2y = xs.reduce((a, x, i) => a + x * x * ys[i], 0)

        // Solve 3x3 via Cramer's rule
        const det =
            s1 * (sx2 * sx4 - sx3 * sx3) -
            sx * (sx * sx4 - sx2 * sx3) +
            sx2 * (sx * sx3 - sx2 * sx2)
        let a0 = 0
        let a1 = 0
        let a2 = 0
        if (det !== 0) {
            const det0 =
                sy * (sx2 * sx4 - sx3 * sx3) -
                sx * (sxy * sx4 - sx3 * sx2y) +
                sx2 * (sxy * sx3 - sx2 * sx2y)
            const det1 =
                s1 * (sxy * sx4 - sx3 * sx2y) -
                sy * (sx * sx4 - sx2 * sx3) +
                sx2 * (sx * sx2y - sxy * sx2)
            const det2 =
                s1 * (sx2 * sx2y - sxy * sx3) -
                sx * (sx * sx2y - sxy * sx2) +
                sy * (sx * sx3 - sx2 * sx2)
            a0 = det0 / det
            a1 = det1 / det
            a2 = det2 / det
        }

        const out: Array<{ x: number; linear: number; quadratic: number }> = []
        for (let i = 0; i < samples; i++) {
            const x = xMin + ((xMax - xMin) * i) / (samples - 1)
            out.push({
                x,
                linear: Math.max(0, m * x + b),
                quadratic: Math.max(0, a0 + a1 * x + a2 * x * x),
            })
        }
        return out
    })()

    useEffect(() => {
        loadCalibrationData()
    }, [])

    const onRebuild = async () => {
        setRebuilding(true)
        setError(null)
        setSuccess(null)
        try {
            const out = await rebuildCalibrationWindows({
                max_days_apart: maxDaysApart,
                buffer_meters: bufferMeters,
                min_acoustic_calls: minAcousticCalls,
            })
            setSuccess(`Rebuilt windows: ${out.created_windows} created, ${out.skipped_candidates} skipped`)
            await loadCalibrationData()
        } catch (e: any) {
            setError(e?.message || "Failed to rebuild windows")
        } finally {
            setRebuilding(false)
        }
    }

    return (
        <div className="p-6 md:p-10 max-w-[1600px] mx-auto space-y-6 min-h-screen bg-background">
            <div className="flex items-end justify-between border-b border-border pb-4">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <Settings className="h-5 w-5 text-zinc-500" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">System Settings</span>
                    </div>
                    <h1 className="text-3xl font-display font-bold text-zinc-900 tracking-tight leading-none">Calibration</h1>
                    <p className="text-xs text-zinc-500 font-mono mt-1 uppercase tracking-wide">
                        Acoustic Call Rate vs Drone Density Windows
                    </p>
                </div>
                <Button
                    onClick={loadCalibrationData}
                    variant="outline"
                    className="rounded-sm border-zinc-200 text-xs font-bold uppercase"
                >
                    <RefreshCcw className="mr-2 h-3.5 w-3.5" />
                    Refresh
                </Button>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div className="tech-card rounded-lg p-4">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Window Count</div>
                    <div className="text-3xl font-mono font-bold text-zinc-900">
                        {loading ? "..." : (summary?.window_count ?? 0)}
                    </div>
                </div>
                <div className="tech-card rounded-lg p-4">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Usable Windows</div>
                    <div className="text-3xl font-mono font-bold text-zinc-900">
                        {loading ? "..." : (summary?.usable_count ?? 0)}
                    </div>
                </div>
                <div className="tech-card rounded-lg p-4">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">
                        Simple Factor
                    </div>
                    <div className="text-3xl font-mono font-bold text-zinc-900">
                        {loading
                            ? "..."
                            : summary?.simple_factor_density_per_call_per_asset?.toFixed(2) ?? "N/A"}
                    </div>
                    <div className="text-[10px] font-mono text-zinc-400 mt-1">density / (calls per asset)</div>
                </div>
            </div>

            <div className="tech-card rounded-lg p-4 space-y-4">
                <div>
                    <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-700">Rebuild Calibration Windows</h2>
                    <p className="text-xs font-mono text-zinc-500 mt-1">
                        Recompute paired acoustic/drone windows using date + spatial buffer criteria.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <label className="text-xs font-mono text-zinc-600">
                        Max days apart
                        <input
                            type="number"
                            min={0}
                            max={120}
                            value={maxDaysApart}
                            onChange={(e) => setMaxDaysApart(Number(e.target.value))}
                            className="mt-1 w-full rounded-sm border border-zinc-200 bg-white px-2 py-1.5"
                        />
                    </label>
                    <label className="text-xs font-mono text-zinc-600">
                        Buffer (meters)
                        <input
                            type="number"
                            min={0}
                            max={5000}
                            value={bufferMeters}
                            onChange={(e) => setBufferMeters(Number(e.target.value))}
                            className="mt-1 w-full rounded-sm border border-zinc-200 bg-white px-2 py-1.5"
                        />
                    </label>
                    <label className="text-xs font-mono text-zinc-600">
                        Min acoustic calls
                        <input
                            type="number"
                            min={0}
                            value={minAcousticCalls}
                            onChange={(e) => setMinAcousticCalls(Number(e.target.value))}
                            className="mt-1 w-full rounded-sm border border-zinc-200 bg-white px-2 py-1.5"
                        />
                    </label>
                    <label className="text-xs font-mono text-zinc-600">
                        Top species features
                        <input
                            type="number"
                            min={0}
                            max={20}
                            value={topSpecies}
                            onChange={(e) => setTopSpecies(Number(e.target.value))}
                            className="mt-1 w-full rounded-sm border border-zinc-200 bg-white px-2 py-1.5"
                        />
                    </label>
                </div>

                <div className="flex items-center gap-3">
                    <Button
                        onClick={onRebuild}
                        disabled={rebuilding}
                        className="bg-zinc-900 hover:bg-zinc-800 text-white rounded-sm text-xs font-bold uppercase"
                    >
                        {rebuilding ? "Rebuilding..." : "Rebuild Windows"}
                    </Button>
                    <Button
                        onClick={runBacktest}
                        disabled={backtesting}
                        variant="outline"
                        className="rounded-sm border-zinc-200 text-xs font-bold uppercase"
                    >
                        {backtesting ? "Running..." : "Run Backtest"}
                    </Button>
                    {error && <div className="text-xs text-rose-700 font-mono">{error}</div>}
                    {success && <div className="text-xs text-emerald-700 font-mono">{success}</div>}
                </div>
                <div className="pt-2">
                    <label className="text-xs font-mono text-zinc-600">
                        Days apart filter (map + table + chart): ≤ {daysApartFilter} days
                    </label>
                    <input
                        type="range"
                        min={0}
                        max={Math.max(1, windows.length > 0 ? Math.max(...windows.map((w) => w.days_apart)) : 1)}
                        value={daysApartFilter}
                        onChange={(e) => setDaysApartFilter(Number(e.target.value))}
                        className="w-full mt-2"
                    />
                </div>
            </div>

            <div className="tech-card rounded-lg p-4 space-y-3">
                <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-700">Model Backtest</h2>
                {!backtest ? (
                    <div className="text-xs font-mono text-zinc-500">
                        Run backtest to compare linear vs quadratic calibration.
                    </div>
                ) : backtest.message ? (
                    <div className="text-xs font-mono text-zinc-500">{backtest.message}</div>
                ) : (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="border border-zinc-200 rounded-sm p-3">
                                <div className="text-[10px] uppercase font-bold text-zinc-500 mb-1">Linear RMSE</div>
                                <div className="font-mono text-lg">
                                    {backtest.overall?.linear.rmse.toFixed(2)}
                                </div>
                            </div>
                            <div className="border border-zinc-200 rounded-sm p-3">
                                <div className="text-[10px] uppercase font-bold text-zinc-500 mb-1">Quadratic RMSE</div>
                                <div className="font-mono text-lg">
                                    {backtest.overall?.quadratic.rmse.toFixed(2)}
                                </div>
                            </div>
                            <div className="border border-zinc-200 rounded-sm p-3">
                                <div className="text-[10px] uppercase font-bold text-zinc-500 mb-1">Recommended</div>
                                <div className="font-mono text-lg uppercase">
                                    {backtest.overall?.recommended_model || "N/A"}
                                </div>
                            </div>
                        </div>
                        {backtest.species_features && backtest.species_features.length > 0 && (
                            <div className="text-xs font-mono text-zinc-600">
                                Species features: {backtest.species_features.join(", ")}
                            </div>
                        )}
                    </>
                )}
            </div>

            <div className="tech-card rounded-lg p-4 space-y-3">
                <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-700">
                    Call-Rate vs Density
                </h2>
                <p className="text-xs font-mono text-zinc-500">
                    Scatter shows calibration windows (`x=calls/asset`, `y=density/ha`) with fitted linear and quadratic curves.
                </p>
                <div className="h-[360px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                            <XAxis
                                type="number"
                                dataKey="x"
                                name="Calls per asset"
                                tick={{ fontSize: 11 }}
                                label={{ value: "Calls per Asset", position: "insideBottom", offset: -6 }}
                            />
                            <YAxis
                                type="number"
                                dataKey="y"
                                tick={{ fontSize: 11 }}
                                label={{ value: "Density per ha", angle: -90, position: "insideLeft" }}
                            />
                            <ReTooltip
                                formatter={(value: any, name: any) => [Number(value).toFixed(2), name]}
                                labelFormatter={(label) => `x=${Number(label).toFixed(2)}`}
                            />
                            <Legend />
                            <Scatter name="Windows" data={scatterData} fill="#0f766e" />
                            <Line
                                name="Linear fit"
                                data={fitData}
                                type="monotone"
                                dataKey="linear"
                                dot={false}
                                stroke="#1d4ed8"
                                strokeWidth={2}
                            />
                            <Line
                                name="Quadratic fit"
                                data={fitData}
                                type="monotone"
                                dataKey="quadratic"
                                dot={false}
                                stroke="#b45309"
                                strokeWidth={2}
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="tech-card rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-200 bg-zinc-50">
                    <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-600">
                        Calibration Windows
                    </h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="bg-zinc-50">
                            <tr className="border-b border-zinc-200">
                                <th className="text-left p-2 font-bold uppercase text-zinc-500">ID</th>
                                <th className="text-left p-2 font-bold uppercase text-zinc-500">Acoustic</th>
                                <th className="text-left p-2 font-bold uppercase text-zinc-500">Drone</th>
                                <th className="text-left p-2 font-bold uppercase text-zinc-500">ARU</th>
                                <th className="text-left p-2 font-bold uppercase text-zinc-500">Days</th>
                                <th className="text-left p-2 font-bold uppercase text-zinc-500">Calls</th>
                                <th className="text-left p-2 font-bold uppercase text-zinc-500">Calls/Asset</th>
                                <th className="text-left p-2 font-bold uppercase text-zinc-500">Detections</th>
                                <th className="text-left p-2 font-bold uppercase text-zinc-500">Area (ha)</th>
                                <th className="text-left p-2 font-bold uppercase text-zinc-500">Density/ha</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={10} className="p-4 font-mono text-zinc-500">
                                        Loading...
                                    </td>
                                </tr>
                            ) : windows.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="p-4 font-mono text-zinc-500">
                                        No calibration windows found.
                                    </td>
                                </tr>
                            ) : (
                                filteredWindows.map((w) => (
                                    <tr
                                        key={w.id}
                                        className={`border-b border-zinc-100 hover:bg-zinc-50 cursor-pointer ${selectedWindowId === w.id ? "bg-zinc-100" : ""}`}
                                        onClick={() => setSelectedWindowId(w.id)}
                                    >
                                        <td className="p-2 font-mono">{w.id}</td>
                                        <td className="p-2 font-mono">{w.acoustic_survey_id}</td>
                                        <td className="p-2 font-mono">{w.visual_survey_id}</td>
                                        <td className="p-2 font-mono">{w.aru_id}</td>
                                        <td className="p-2 font-mono">{w.days_apart}</td>
                                        <td className="p-2 font-mono">{w.acoustic_call_count}</td>
                                        <td className="p-2 font-mono">{w.acoustic_calls_per_asset.toFixed(2)}</td>
                                        <td className="p-2 font-mono">{w.drone_detection_count}</td>
                                        <td className="p-2 font-mono">{w.drone_area_hectares.toFixed(3)}</td>
                                        <td className="p-2 font-mono">{w.drone_density_per_hectare.toFixed(2)}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="tech-card rounded-lg p-4 space-y-3">
                <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-700">
                    Spatial Calibration Diagnostics
                </h2>
                <p className="text-xs font-mono text-zinc-500">
                    Scientific view of paired windows. Drone survey extents are rectangles. ARUs are colored by mean
                    paired density. Each line is a calibration window and is color-encoded by drone density per hectare.
                </p>
                <CalibrationMap
                    windows={filteredWindows}
                    surveys={surveys}
                    arus={arus}
                    selectedWindowId={selectedWindowId}
                    onSelectWindow={setSelectedWindowId}
                />
            </div>
        </div>
    )
}
