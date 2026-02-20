import React, { useMemo, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Mic, Image as ImageIcon, MapPin, ExternalLink, Activity, PlayCircle, BarChart3, List, PieChart } from 'lucide-react';
import { PieChart as RePieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, Legend } from 'recharts';
import { VisualDetection, AcousticDetection, visualDetections, acousticDetections } from '../mockData';

interface InspectorPanelProps {
    isOpen: boolean;
    onClose: () => void;
    selectedVisual: VisualDetection | null;
    selectedAcoustic: AcousticDetection | null;
    selectedARU: { id: string, lat: number, lon: number, detectionCount: number, aru_id?: number } | null;
    selectedSurvey?: { id: number, name: string, date: string } | null;
    filterDays: number;
    selectedSurveyIds: number[];
}

// Deterministic color generator for distinct species
const getSpeciesColor = (species: string) => {
    const colors = [
        { border: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)', text: '#b91c1c' }, // Red
        { border: '#f97316', bg: 'rgba(249, 115, 22, 0.1)', text: '#c2410c' }, // Orange
        { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)', text: '#b45309' }, // Amber
        { border: '#84cc16', bg: 'rgba(132, 204, 22, 0.1)', text: '#4d7c0f' }, // Lime
        { border: '#10b981', bg: 'rgba(16, 185, 129, 0.1)', text: '#047857' }, // Emerald
        { border: '#06b6d4', bg: 'rgba(6, 182, 212, 0.1)', text: '#0e7490' }, // Cyan
        { border: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)', text: '#1d4ed8' }, // Blue
        { border: '#6366f1', bg: 'rgba(99, 102, 241, 0.1)', text: '#4338ca' }, // Indigo
        { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)', text: '#6d28d9' }, // Violet
        { border: '#d946ef', bg: 'rgba(217, 70, 239, 0.1)', text: '#a21caf' }, // Fuchsia
        { border: '#f43f5e', bg: 'rgba(244, 63, 94, 0.1)', text: '#be123c' }, // Rose
    ];

    let hash = 0;
    for (let i = 0; i < species.length; i++) {
        hash = species.charCodeAt(i) + ((hash << 5) - hash);
    }

    return colors[Math.abs(hash) % colors.length];
};

// Haversine formula to calculate distance in meters
const getDistanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
};

const InspectorPanel: React.FC<InspectorPanelProps> = ({
    isOpen,
    onClose,
    selectedVisual,
    selectedAcoustic,
    selectedARU,
    selectedSurvey,
    filterDays,
    selectedSurveyIds
}) => {
    const [allDetections, setAllDetections] = useState<any[]>([]);
    const [isLoadingDetections, setIsLoadingDetections] = useState(false);
    const [selectedSurveyFilter, setSelectedSurveyFilter] = useState<number | 'all'>('all');
    const [viewMode, setViewMode] = useState<'summary' | 'details'>('summary');
    const [selectedTileId, setSelectedTileId] = useState<number | null>(null);
    const [filteredDetections, setFilteredDetections] = useState<any[]>([]);
    const [availableSurveys, setAvailableSurveys] = useState<any[]>([]);

    // Fetch detections for Selected Survey
    useEffect(() => {
        if (selectedSurvey) {
            setIsLoadingDetections(true);
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - filterDays);

            Promise.all([
                fetch(`/api/detections/visual?survey_ids=${selectedSurvey.id}&days=3650`).then(res => res.json()),
                fetch(`/api/detections/acoustic?survey_ids=${selectedSurvey.id}&days=3650`).then(res => res.json())
            ]).then(([visual, acoustic]) => {
                const combined = [
                    ...visual.map((d: any) => ({ ...d, type: 'visual', timestamp: d.timestamp || new Date().toISOString() })),
                    ...acoustic.map((d: any) => ({ ...d, type: 'acoustic', timestamp: d.timestamp || new Date().toISOString() }))
                ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                setAllDetections(combined);
            }).catch(err => {
                console.error("Failed to fetch detections:", err);
                setAllDetections([]);
            }).finally(() => {
                setIsLoadingDetections(false);
            });
        }
    }, [selectedSurvey, filterDays]);


    useEffect(() => {
        if (selectedARU) {
            setIsLoadingDetections(true);
            const targetId = selectedARU.aru_id;
            if (!targetId) {
                setIsLoadingDetections(false);
                return;
            }

            fetch(`/api/arus/${targetId}/detections?days=${filterDays}&survey_ids=${selectedSurveyIds.join(',')}`)
                .then(res => res.json())
                .then(data => {
                    if (!Array.isArray(data)) {
                        setFilteredDetections([]);
                        return;
                    }
                    setFilteredDetections(data);

                    const surveys: any = {};
                    data.forEach((d: any) => {
                        if (d.survey_id) {
                            surveys[d.survey_id] = { id: d.survey_id, name: d.survey_name, count: (surveys[d.survey_id]?.count || 0) + 1 };
                        }
                    });
                    setAvailableSurveys(Object.values(surveys));
                })
                .catch(console.error)
                .finally(() => setIsLoadingDetections(false));
        }
    }, [selectedARU, filterDays, selectedSurveyIds]);


    // Derived state for Tile View
    const detectionsByTile = useMemo(() => {
        const grouped: Record<number, any[]> = {};
        allDetections.forEach(det => {
            if (det.type === 'visual' && det.asset_id) {
                if (!grouped[det.asset_id]) {
                    grouped[det.asset_id] = [];
                }
                grouped[det.asset_id].push(det);
            }
        });
        return grouped;
    }, [allDetections]);

    const selectedTileDetections = useMemo(() => {
        if (!selectedTileId) return [];
        return detectionsByTile[selectedTileId] || [];
    }, [selectedTileId, detectionsByTile]);


    // Cross-reference logic
    const correlations = useMemo(() => {
        if (!selectedVisual && !selectedAcoustic) return [];

        const current = (selectedVisual || selectedAcoustic)!;
        const currentType = selectedVisual ? 'visual' : 'acoustic';
        const otherType = selectedVisual ? 'acoustic' : 'visual';

        const sourceData = currentType === 'visual' ? acousticDetections : visualDetections;

        return sourceData
            .map(d => {
                const dist = getDistanceMeters(current.lat, current.lon, d.lat, d.lon);
                const timeDiff = Math.abs(new Date(current.timestamp).getTime() - new Date(d.timestamp).getTime()) / 1000 / 60;
                return { data: d, dist, timeDiff, type: otherType };
            })
            .filter(item => item.dist < 500 && item.timeDiff < 30)
            .sort((a, b) => a.dist - b.dist);

    }, [selectedVisual, selectedAcoustic]);

    const detectionsBySurvey = useMemo(() => {
        const grouped: any = {};
        filteredDetections.forEach(det => {
            if (!grouped[det.survey_id]) grouped[det.survey_id] = [];
            grouped[det.survey_id].push(det);
        });
        return grouped;
    }, [filteredDetections]);

    if (!isOpen) return null;

    // Survey View
    if (selectedSurvey) {
        return (
            <div className="fixed right-0 top-0 bottom-0 w-96 bg-white outline-none z-[500] border-l border-zinc-200 transform transition-transform duration-300 overflow-y-auto">
                <div className="p-5 border-b border-zinc-200 bg-white sticky top-0 z-10 flex justify-between items-start">
                    <div>
                        <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm text-[10px] uppercase font-bold tracking-wide border border-teal-200 bg-teal-50 text-teal-700 mb-2">
                            <MapPin size={10} />
                            Orthomosaic Survey
                        </span>
                        <h2 className="text-lg font-bold text-zinc-900 font-display uppercase leading-tight">{selectedSurvey.name}</h2>
                        <p className="text-xs text-zinc-500 font-mono mt-1">{new Date(selectedSurvey.date).toLocaleDateString()} // ID: {selectedSurvey.id}</p>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 rounded-sm text-zinc-400 hover:text-zinc-600 transition-colors">
                        <X size={16} />
                    </button>
                </div>

                <div className="p-5 space-y-6">
                    {isLoadingDetections ? (
                        <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
                            <Activity className="animate-spin mb-3 text-zinc-300" size={32} />
                            <p className="text-xs font-mono uppercase">Loading Detections...</p>
                            <p className="text-[10px] font-mono text-zinc-300 mt-1">Fetching tiles and signatures</p>
                        </div>
                    ) : (
                        <>
                            <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-sm text-xs text-zinc-600">
                                <h4 className="font-bold text-zinc-800 mb-1 font-display uppercase">Survey Parameters</h4>
                                <p className="font-mono text-[10px] leading-relaxed mb-2">ORTHOMOSAIC_BOUNDING_BOX // PROCESSED</p>
                                <div className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                    <span className="text-[10px] font-bold text-zinc-700 uppercase">Analysis Complete</span>
                                </div>
                            </div>

                            {/* Species Summary */}
                            {allDetections.length > 0 && (
                                <div className="space-y-2">
                                    <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest border-b border-zinc-100 pb-1">Species Summary</h4>
                                    <div className="grid grid-cols-2 gap-2">
                                        {Object.entries(
                                            allDetections.reduce((acc: any, det) => {
                                                acc[det.species] = (acc[det.species] || 0) + 1;
                                                return acc;
                                            }, {})
                                        ).map(([species, count]: any) => {
                                            const color = getSpeciesColor(species);
                                            return (
                                                <div key={species} className="flex justify-between items-center text-xs p-2 rounded-sm bg-white border border-zinc-200 hover:border-zinc-300 transition-colors">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color.border }} />
                                                        <span className="text-zinc-700 font-medium font-mono truncate max-w-[80px]" title={species}>{species}</span>
                                                    </div>
                                                    <span className="font-mono font-bold text-zinc-900">{count}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Detections List (Grid View) */}
                            <div>
                                <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest border-b border-zinc-100 pb-1 mb-3 flex items-center justify-between">
                                    <span>Image Tiles</span>
                                    <span className="text-[10px] font-mono text-zinc-400">CNT: {Object.keys(detectionsByTile).length}</span>
                                </h3>

                                {Object.keys(detectionsByTile).length > 0 ? (
                                    <div className="grid grid-cols-2 gap-2">
                                        {Object.keys(detectionsByTile).map((tileId) => {
                                            const dets = detectionsByTile[parseInt(tileId)];
                                            const thumbnail = dets[0].imageUrl;

                                            return (
                                                <div
                                                    key={tileId}
                                                    onClick={() => setSelectedTileId(parseInt(tileId))}
                                                    className="group relative aspect-square bg-zinc-100 rounded-sm border border-zinc-200 overflow-hidden cursor-pointer hover:border-primary hover:ring-1 hover:ring-primary transition-all"
                                                >
                                                    <img src={thumbnail} alt="Tile" className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-300" />
                                                    <div className="absolute top-1 right-1 bg-zinc-900/80 text-white text-[9px] font-mono px-1.5 py-0.5 rounded-sm backdrop-blur-sm">
                                                        {dets.length}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-center py-6 text-zinc-400 text-xs font-mono border border-dashed border-zinc-200 rounded-sm">
                                        NO_VISUAL_SIGNATURES
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* Tile Detail Modal */}
                {selectedTileId && createPortal(
                    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-zinc-900/90 backdrop-blur-sm p-4 sm:p-8" onClick={() => setSelectedTileId(null)}>
                        <div
                            className="bg-white rounded-sm shadow-none max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-zinc-800"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="p-3 border-b border-zinc-200 flex justify-between items-center bg-zinc-50">
                                <div>
                                    <h3 className="font-bold text-zinc-900 font-display uppercase text-sm">Tile Inspection</h3>
                                    <p className="text-[10px] font-mono text-zinc-500">ID: {selectedTileId} // DETECTIONS: {selectedTileDetections.length}</p>
                                </div>
                                <button
                                    onClick={() => setSelectedTileId(null)}
                                    className="p-1.5 hover:bg-zinc-200 rounded-sm transition-colors text-zinc-500"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                            <div className="flex-1 overflow-auto p-4 bg-zinc-100 flex items-center justify-center relative">
                                <div className="relative inline-block border border-zinc-300 shadow-sm bg-white">
                                    {selectedTileDetections.length > 0 && (
                                        <img
                                            src={selectedTileDetections[0].imageUrl}
                                            alt="Full Tile"
                                            className="max-h-[75vh] object-contain"
                                        />
                                    )}
                                    {selectedTileDetections.map((det) => {
                                        const w_pct = det.bbox.w * 100;
                                        const h_pct = det.bbox.h * 100;
                                        const left_pct = (det.bbox.cx - det.bbox.w / 2) * 100;
                                        const top_pct = (det.bbox.cy - det.bbox.h / 2) * 100;
                                        const color = getSpeciesColor(det.species);
                                        return (
                                            <div
                                                key={det.id}
                                                className="absolute border transition-colors cursor-help group"
                                                style={{
                                                    left: `${left_pct}%`,
                                                    top: `${top_pct}%`,
                                                    width: `${w_pct}%`,
                                                    height: `${h_pct}%`,
                                                    borderColor: color.border,
                                                    borderWidth: '1px'
                                                }}
                                            >
                                                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ backgroundColor: color.bg }} />
                                                <div
                                                    className="absolute -top-5 left-0 text-white text-[9px] font-mono px-1 py-0.5 rounded-sm shadow-sm opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 whitespace-nowrap"
                                                    style={{ backgroundColor: color.border }}
                                                >
                                                    {det.species} {(det.confidence * 100).toFixed(0)}%
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
            </div>
        );
    }

    // ARU View
    if (selectedARU) {
        const totalDetections = filteredDetections.length;
        const uniqueSpecies = new Set(filteredDetections.map(d => d.species)).size;
        const speciesCounts = filteredDetections.reduce((acc, curr) => {
            acc[curr.species] = (acc[curr.species] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        const pieData = Object.entries(speciesCounts)
            .map(([name, value]) => ({ name, value }))
            .sort((a: any, b: any) => b.value - a.value)
            .slice(0, 8);
        const hourlyCounts = filteredDetections.reduce((acc, curr) => {
            const hour = new Date(curr.timestamp).getHours();
            acc[hour] = (acc[hour] || 0) + 1;
            return acc;
        }, {} as Record<number, number>);
        const barData = Array.from({ length: 24 }, (_, i) => ({
            hour: `${i}:00`,
            count: hourlyCounts[i] || 0
        }));

        return (
            <div className="fixed right-0 top-0 bottom-0 w-[450px] bg-white z-[500] border-l border-zinc-200 transform transition-transform duration-300 flex flex-col shadow-none">
                <div className="p-5 border-b border-zinc-200 bg-zinc-50 shrink-0">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm text-[10px] uppercase font-bold tracking-wide border border-orange-200 bg-orange-50 text-orange-700 mb-2">
                                <Mic size={10} />
                                Acoustic Unit
                            </span>
                            <h2 className="text-xl font-bold text-zinc-900 font-display uppercase tracking-tight">{selectedARU.id}</h2>
                            <div className="flex items-center gap-2 mt-1 text-zinc-500 text-xs font-mono">
                                <MapPin size={12} />
                                <span>{selectedARU.lat.toFixed(5)}, {selectedARU.lon.toFixed(5)}</span>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-1.5 hover:bg-zinc-200 rounded-sm text-zinc-400 hover:text-zinc-600 transition-colors">
                            <X size={16} />
                        </button>
                    </div>

                    <div className="flex p-0.5 bg-zinc-200/50 rounded-sm border border-zinc-200">
                        <button
                            onClick={() => setViewMode('summary')}
                            className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-[10px] uppercase font-bold tracking-wider rounded-sm transition-all ${viewMode === 'summary'
                                ? 'bg-white text-zinc-900 shadow-sm border border-zinc-200'
                                : 'text-zinc-500 hover:text-zinc-700'
                                }`}
                        >
                            <BarChart3 size={12} />
                            Metrics
                        </button>
                        <button
                            onClick={() => setViewMode('details')}
                            className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-[10px] uppercase font-bold tracking-wider rounded-sm transition-all ${viewMode === 'details'
                                ? 'bg-white text-zinc-900 shadow-sm border border-zinc-200'
                                : 'text-zinc-500 hover:text-zinc-700'
                                }`}
                        >
                            <List size={12} />
                            Log ({totalDetections})
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-white">
                    {isLoadingDetections ? (
                        <div className="h-full flex flex-col items-center justify-center text-zinc-400">
                            <Activity className="animate-spin mb-3 text-zinc-300" size={24} />
                            <p className="text-xs font-mono uppercase">Processing Signal...</p>
                        </div>
                    ) : filteredDetections.length === 0 ? (
                        <div className="text-center py-12 text-zinc-400 border border-dashed border-zinc-200 rounded-sm">
                            <p className="text-xs font-mono uppercase">No Acoustic Signatures</p>
                        </div>
                    ) : viewMode === 'summary' ? (
                        <div className="space-y-6 animate-in fade-in duration-300">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-zinc-50 p-3 rounded-sm border border-zinc-200">
                                    <div className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest mb-1">Total Events</div>
                                    <div className="text-2xl font-bold text-zinc-900 font-display">{totalDetections}</div>
                                </div>
                                <div className="bg-zinc-50 p-3 rounded-sm border border-zinc-200">
                                    <div className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest mb-1">Unique SPP</div>
                                    <div className="text-2xl font-bold text-zinc-900 font-display">{uniqueSpecies}</div>
                                </div>
                            </div>

                            <div className="bg-white p-4 rounded-sm border border-zinc-200">
                                <h4 className="font-bold text-zinc-800 text-xs uppercase tracking-wider mb-4 flex items-center gap-2">
                                    <PieChart size={14} className="text-zinc-400" />
                                    Species Distribution
                                </h4>
                                <div className="h-48 w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <RePieChart>
                                            <Pie
                                                data={pieData}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={40}
                                                outerRadius={70}
                                                paddingAngle={2}
                                                dataKey="value"
                                                stroke="none"
                                            >
                                                {pieData.map((entry, index) => {
                                                    const col = getSpeciesColor(entry.name);
                                                    return <Cell key={`cell-${index}`} fill={col.border} />;
                                                })}
                                            </Pie>
                                            <Tooltip
                                                contentStyle={{ borderRadius: '2px', border: '1px solid #e4e4e7', boxShadow: 'none', fontSize: '10px', textTransform: 'uppercase' }}
                                            />
                                            <Legend
                                                layout="vertical"
                                                verticalAlign="middle"
                                                align="right"
                                                iconSize={8}
                                                formatter={(value: any) => <span className="text-zinc-600 text-[10px] font-mono">{value}</span>}
                                            />
                                        </RePieChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            <div className="bg-white p-4 rounded-sm border border-zinc-200">
                                <h4 className="font-bold text-zinc-800 text-xs uppercase tracking-wider mb-4 flex items-center gap-2">
                                    <Activity size={14} className="text-zinc-400" />
                                    Temporal Distribution
                                </h4>
                                <div className="h-32 w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={barData}>
                                            <XAxis dataKey="hour" hide />
                                            <Tooltip
                                                cursor={{ fill: '#f4f4f5' }}
                                                contentStyle={{ borderRadius: '2px', border: '1px solid #e4e4e7', boxShadow: 'none', fontSize: '10px' }}
                                            />
                                            <Bar dataKey="count" fill="#27272a" radius={[2, 2, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="flex justify-between text-[9px] font-mono text-zinc-400 mt-1 px-1">
                                    <span>0000Z</span>
                                    <span>1200Z</span>
                                    <span>2300Z</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-2 animate-in fade-in duration-300">
                            <div className="mb-4">
                                <select
                                    value={selectedSurveyFilter}
                                    onChange={(e) => setSelectedSurveyFilter(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                                    className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-sm text-xs font-mono text-zinc-700 focus:outline-none focus:border-zinc-400"
                                >
                                    <option value="all">ALL_MISSIONS ({allDetections.length})</option>
                                    {availableSurveys.map(survey => (
                                        <option key={survey.id} value={survey.id}>
                                            {survey.name} ({survey.count})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* List */}
                            {selectedSurveyFilter === 'all' ? (
                                availableSurveys.map(survey => {
                                    const surveyDetections = detectionsBySurvey[survey.id] || [];
                                    if (surveyDetections.length === 0) return null;
                                    return (
                                        <div key={survey.id} className="mb-4">
                                            <h5 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2 sticky top-0 bg-white py-1 z-10 border-b border-zinc-100">{survey.name}</h5>
                                            <div className="border border-zinc-200 rounded-sm divide-y divide-zinc-100">
                                                {surveyDetections.map((det: any) => (
                                                    <DetectionRow key={det.id} detection={det} />
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="border border-zinc-200 rounded-sm divide-y divide-zinc-100">
                                    {filteredDetections.map((det: any) => (
                                        <DetectionRow key={det.id} detection={det} />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Single Detection View
    const isVisual = !!selectedVisual;
    const data = (selectedVisual || selectedAcoustic)!;

    return (
        <div className="fixed right-0 top-0 bottom-0 w-96 bg-white outline-none z-[500] border-l border-zinc-200 transform transition-transform duration-300 overflow-y-auto">
            <div className="p-5 border-b border-zinc-200 flex justify-between items-start bg-white">
                <div>
                    <span className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm text-[10px] uppercase font-bold tracking-wide border mb-2 ${isVisual ? 'bg-teal-50 border-teal-200 text-teal-700' : 'bg-orange-50 border-orange-200 text-orange-700'}`}>
                        {isVisual ? <ImageIcon size={10} /> : <Mic size={10} />}
                        {isVisual ? 'VISUAL_CONTACT' : 'ACOUSTIC_CONTACT'}
                    </span>
                    <h2 className="text-xl font-bold text-zinc-900 font-display uppercase">{data.species}</h2>
                    <p className="text-xs text-zinc-500 font-mono mt-1">ID: {data.id} // CONF: {(data.confidence * 100).toFixed(1)}%</p>
                </div>
                <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 rounded-sm text-zinc-400 hover:text-zinc-600 transition-colors">
                    <X size={16} />
                </button>
            </div>

            <div className="p-5 space-y-6">
                <div className="rounded-sm overflow-hidden bg-zinc-100 border border-zinc-200">
                    {isVisual ? (
                        <div className="relative aspect-video group cursor-pointer">
                            <img src={(data as VisualDetection).imageUrl} alt={data.species} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <div className="bg-white/10 backdrop-blur text-white px-3 py-1 rounded-sm border border-white/20 text-xs font-mono uppercase">
                                    Open Source
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="p-6 flex flex-col items-center justify-center gap-3">
                            <div className="w-12 h-12 rounded-full bg-zinc-200 flex items-center justify-center text-zinc-500">
                                <Mic size={20} />
                            </div>
                            <audio controls className="w-full h-8 mt-2" src={(data as AcousticDetection).audioUrl}></audio>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div className="p-2.5 bg-zinc-50 rounded-sm border border-zinc-200">
                        <div className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-1">Time Stamp</div>
                        <div className="font-mono text-zinc-700 text-xs">{new Date(data.timestamp).toLocaleTimeString()}</div>
                    </div>
                    <div className="p-2.5 bg-zinc-50 rounded-sm border border-zinc-200">
                        <div className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-1">Coordinates</div>
                        <div className="font-mono text-zinc-700 text-xs">{data.lat.toFixed(5)}, {data.lon.toFixed(5)}</div>
                    </div>
                    {(data as any).survey_name && (
                        <div className="col-span-2 p-2.5 bg-zinc-50 rounded-sm border border-zinc-200">
                            <div className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-1">Survey</div>
                            <div className="font-mono text-zinc-700 text-xs truncate">{(data as any).survey_name}</div>
                        </div>
                    )}
                </div>

                <div className="border-t border-zinc-200 pt-6">
                    <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                        Data Correlation Matches
                    </h3>

                    {correlations.length > 0 ? (
                        <div className="space-y-2">
                            <div className="p-2 bg-indigo-50 border border-indigo-100 rounded-sm text-xs text-indigo-800 flex gap-2">
                                <div className="font-mono font-bold">MATCH_FOUND</div>
                                <div className="opacity-80 font-mono">COUNT: {correlations.length}</div>
                            </div>

                            {correlations.map((c, i) => (
                                <div key={i} className="flex items-center gap-3 p-2 bg-white border border-zinc-200 rounded-sm hover:border-zinc-300 transition-colors">
                                    <div className={`w-8 h-8 rounded-sm flex items-center justify-center shrink-0 border ${c.type === 'visual' ? 'bg-teal-50 border-teal-100 text-teal-600' : 'bg-orange-50 border-orange-100 text-orange-600'}`}>
                                        {c.type === 'visual' ? <ImageIcon size={14} /> : <Mic size={14} />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-bold text-zinc-800 text-xs truncate font-display uppercase">{(c.data as any).species}</div>
                                        <div className="text-[10px] text-zinc-400 font-mono">{c.dist.toFixed(1)}m • {((c.data.confidence) * 100).toFixed(0)}% CONF</div>
                                    </div>
                                    <ExternalLink size={12} className="text-zinc-300" />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-6 text-zinc-400 text-[10px] font-mono border border-dashed border-zinc-200 rounded-sm uppercase">
                            NO_CORRELATED_SIGNALS
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
};

// Compact Detection Row for List View
const DetectionRow: React.FC<{ detection: any }> = ({ detection }) => {
    return (
        <div className="flex items-center gap-3 p-2.5 hover:bg-zinc-50 transition-colors group">
            <div className="shrink-0">
                {detection.audioUrl ? (
                    <div className="w-6 h-6 rounded-sm bg-zinc-100 text-zinc-600 border border-zinc-200 flex items-center justify-center cursor-pointer hover:bg-zinc-200 hover:text-zinc-900 transition-colors">
                        <PlayCircle size={12} />
                    </div>
                ) : (
                    <div className="w-6 h-6 rounded-sm bg-zinc-100 text-zinc-400 border border-zinc-200 flex items-center justify-center">
                        <Activity size={12} />
                    </div>
                )}
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                    <span className="font-bold text-zinc-700 text-xs font-display uppercase truncate">{detection.species}</span>
                    <span className="text-[10px] font-mono text-zinc-400">{new Date(detection.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                    <div className="w-12 h-1 bg-zinc-100 rounded-sm overflow-hidden border border-zinc-200">
                        <div
                            className={`h-full ${detection.confidence > 0.7 ? 'bg-zinc-800' : 'bg-zinc-400'}`}
                            style={{ width: `${detection.confidence * 100}%` }}
                        />
                    </div>
                    <span className="text-[9px] font-mono text-zinc-400">{(detection.confidence * 100).toFixed(0)}%</span>
                </div>
            </div>
        </div>
    );
};

export default InspectorPanel;
