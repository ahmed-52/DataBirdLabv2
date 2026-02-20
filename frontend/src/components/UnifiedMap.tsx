import React, { useMemo, useState } from 'react';
import { MapContainer, TileLayer, Circle, Tooltip, Rectangle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { VisualDetection, AcousticDetection, ARU } from '@/types';
import { useEffect } from 'react';
import HeatmapLayer from './HeatmapLayer';
import DensityControl from './DensityControl';
import SpeciesDensityLayer, { getDroneSpeciesLegend } from './SpeciesDensityLayer';

const ACOUSTIC_GRADIENT: Record<number, string> = {
    0.0: 'transparent',
    0.25: 'rgba(234, 88, 12, 0.5)',   // orange-600
    0.5: '#ea580c',
    0.7: '#fbbf24',                   // amber-400
    0.88: '#fde68a',                  // amber-200
    1.0: '#fffbeb',                   // amber-50
};

// Internal component to handle map interactions/animations
const MapController = ({ surveys, arus, autoZoom }: { surveys: any[], arus: ARU[], autoZoom: boolean }) => {
    const map = useMap();

    useEffect(() => {
        if (autoZoom && surveys.length > 0) {
            const bounds = L.latLngBounds([]);
            let hasBounds = false;

            surveys.forEach(s => {
                if (s.bounds && s.bounds.min_lat) {
                    bounds.extend([s.bounds.min_lat, s.bounds.min_lon]);
                    bounds.extend([s.bounds.max_lat, s.bounds.max_lon]);
                    hasBounds = true;
                }
            });

            if (arus.length > 0) {
                arus.forEach(aru => {
                    bounds.extend([aru.lat, aru.lon]);
                    hasBounds = true;
                });
            }

            if (hasBounds) {
                map.flyToBounds(bounds, {
                    padding: [50, 50],
                    duration: 1.5,
                    maxZoom: 18
                });
            }
        }
    }, [surveys, arus, map, autoZoom]);

    return null;
};

interface UnifiedMapProps {
    visualDetections: VisualDetection[];
    acousticDetections: AcousticDetection[];
    arus?: ARU[];
    onSelectVisual: (d: VisualDetection) => void;
    onSelectAcoustic: (d: AcousticDetection) => void;
    onSelectARU?: (aruData: { id: string, lat: number, lon: number, detectionCount: number, aru_id?: number }) => void;
    onSelectSurvey?: (survey: any) => void;
    surveys?: any[];
    autoZoom?: boolean;
}

const UnifiedMap: React.FC<UnifiedMapProps> = ({
    visualDetections,
    acousticDetections,
    arus = [],
    onSelectVisual,
    onSelectAcoustic,
    onSelectARU,
    onSelectSurvey,
    surveys = [],
    autoZoom = true
}) => {

    const centerPos: [number, number] = [11.40547, 105.39735];

    const mapBounds: L.LatLngBoundsExpression = [
        [11.39, 105.37],
        [11.43, 105.42]
    ];

    // ── Density layer visibility + opacity state ─────────────────────────────
    const [droneHeatVisible, setDroneHeatVisible] = useState(true);
    const [acousticHeatVisible, setAcousticHeatVisible] = useState(true);
    const [coverageVisible, setCoverageVisible] = useState(false);
    const [acousticRangeVisible, setAcousticRangeVisible] = useState(false);
    const [droneOpacity, setDroneOpacity] = useState(0.75);
    const [acousticOpacity, setAcousticOpacity] = useState(0.6);

    // ── Drone density: point count for the DensityControl badge ────────────
    const droneHeatPoints = useMemo(() =>
        visualDetections.filter(d => d.lat != null && d.lon != null),
        [visualDetections]
    );

    // ── Species legend entries (derived from current detections) ─────────
    const speciesLegend = useMemo(
        () => getDroneSpeciesLegend(visualDetections),
        [visualDetections]
    );

    // ── Acoustic heatmap: group by ARU location, intensity = detection count ─
    // Acoustic detections cluster at a small number of ARU stations, so we
    // aggregate count-per-station and normalise so the most-active station = 1.
    const acousticHeatPoints = useMemo<Array<[number, number, number]>>(() => {
        const locationMap = new Map<string, { lat: number; lon: number; count: number }>();

        acousticDetections.forEach(d => {
            if (d.lat == null || d.lon == null) return;
            // Round to ~1 m precision to merge detections at the same station
            const key = `${d.lat.toFixed(5)},${d.lon.toFixed(5)}`;
            const existing = locationMap.get(key);
            if (existing) {
                existing.count++;
            } else {
                locationMap.set(key, { lat: d.lat, lon: d.lon, count: 1 });
            }
        });

        const entries = Array.from(locationMap.values());
        const maxCount = Math.max(...entries.map(e => e.count), 1);

        return entries.map(e => [e.lat, e.lon, e.count / maxCount]);
    }, [acousticDetections]);

    return (
        <div className="h-full w-full rounded-2xl overflow-hidden relative z-0">
            <MapContainer
                center={centerPos}
                zoom={16}
                minZoom={15}
                maxZoom={19}
                scrollWheelZoom={true}
                maxBounds={mapBounds}
                maxBoundsViscosity={1.0}
                style={{ height: '100%', width: '100%' }}
                zoomControl={false}
                preferCanvas={true}
            >
                <MapController surveys={surveys} arus={arus} autoZoom={autoZoom} />
                <TileLayer
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                    attribution='Tiles &copy; Esri'
                    maxNativeZoom={18}
                    maxZoom={19}
                />

                {/* ── Drone species density (canvas, colored per species) ── */}
                <SpeciesDensityLayer
                    detections={visualDetections}
                    visible={droneHeatVisible}
                    radiusMeters={18}
                    opacity={droneOpacity}
                />
                <HeatmapLayer
                    points={acousticHeatPoints}
                    visible={acousticHeatVisible}
                    gradient={ACOUSTIC_GRADIENT}
                    radiusMeters={30}
                    max={1.0}
                    minOpacity={0.35}
                    opacity={acousticOpacity}
                />

                {/* ── Survey Bounds ─────────────────────────────────────── */}
                {coverageVisible && surveys.map(survey => {
                    const b = survey.bounds;
                    if (!b || !b.min_lat || !b.max_lat || !b.min_lon || !b.max_lon) return null;

                    const bounds: [[number, number], [number, number]] = [
                        [b.min_lat, b.min_lon],
                        [b.max_lat, b.max_lon]
                    ];

                    return (
                        <Rectangle
                            key={`survey-${survey.id}`}
                            bounds={bounds}
                            pathOptions={{
                                color: survey.type === 'drone' ? '#14b8a6' : '#f97316',
                                fillColor: survey.type === 'drone' ? '#14b8a6' : '#f97316',
                                fillOpacity: 0.1,
                                weight: 1,
                                dashArray: '4, 4'
                            }}
                            eventHandlers={{
                                click: () => { if (onSelectSurvey) onSelectSurvey(survey); },
                                mouseover: (e) => { e.target.setStyle({ weight: 2, fillOpacity: 0.2 }); e.target.openTooltip(); },
                                mouseout: (e) => { e.target.setStyle({ weight: 1, fillOpacity: 0.1 }); e.target.closeTooltip(); }
                            }}
                        >
                            <Tooltip sticky direction="center" className="bg-white/90 backdrop-blur border border-stone-200 shadow-lg rounded-xl px-3 py-2 text-center" opacity={1}>
                                <div>
                                    <div className="font-bold text-stone-800">{survey.name}</div>
                                    <div className="text-xs text-stone-500">{new Date(survey.date).toLocaleDateString()}</div>
                                </div>
                            </Tooltip>
                        </Rectangle>
                    );
                })}

                {/* ── ARU Stations ──────────────────────────────────────── */}
                {acousticRangeVisible && arus.map((aru) => (
                    <Circle
                        key={`aru-${aru.id}`}
                        center={[aru.lat, aru.lon]}
                        radius={40}
                        pathOptions={{
                            color: '#F97316',
                            fillColor: '#F97316',
                            fillOpacity: 0.3,
                            weight: 2,
                            dashArray: '5, 5'
                        }}
                        eventHandlers={{
                            click: () => {
                                if (onSelectARU) {
                                    onSelectARU({
                                        id: `ARU-${aru.id}`,
                                        lat: aru.lat,
                                        lon: aru.lon,
                                        detectionCount: acousticDetections.filter(d => d.aru_id === aru.id).length,
                                        aru_id: aru.id
                                    });
                                }
                            },
                        }}
                    >
                        <Tooltip sticky direction="top" offset={[0, -10]}>
                            <span className="font-bold text-xs">{aru.name}</span>
                        </Tooltip>
                    </Circle>
                ))}

            </MapContainer>

            {/* ── Bottom-left legend ──────────────────────────────────── */}
            <div className="absolute bottom-4 left-4 z-[400] bg-white/95 backdrop-blur-sm p-3 rounded-sm border border-zinc-200 shadow-sm text-[10px] font-mono text-zinc-600 space-y-1.5 uppercase tracking-wide">
                <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 bg-teal-500/20 border border-teal-600 rounded-sm"></div>
                    <span>Aerial Coverage</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 bg-orange-500/20 border border-orange-500 border-dashed rounded-full"></div>
                    <span>Acoustic Range</span>
                </div>
                {droneHeatVisible && speciesLegend.length > 0 && (
                    <>
                        <div className="border-t border-zinc-100 pt-1.5 text-zinc-400">Drone Species</div>
                        {speciesLegend.map(({ species, color }) => (
                            <div key={species} className="flex items-center gap-2">
                                <div
                                    className="w-2.5 h-2.5 rounded-full shrink-0"
                                    style={{ background: color, opacity: 0.85 }}
                                />
                                <span className="truncate max-w-[100px]">
                                    {species.replace(/_/g, ' ')}
                                </span>
                            </div>
                        ))}
                    </>
                )}
            </div>

            {/* ── Bottom-right density control ────────────────────────── */}
            <div className="absolute bottom-4 right-4 z-[400] w-44">
                <DensityControl
                    droneVisible={droneHeatVisible}
                    acousticVisible={acousticHeatVisible}
                    onDroneToggle={() => setDroneHeatVisible(v => !v)}
                    onAcousticToggle={() => setAcousticHeatVisible(v => !v)}
                    droneCount={droneHeatPoints.length}
                    droneOpacity={droneOpacity}
                    acousticOpacity={acousticOpacity}
                    onDroneOpacityChange={setDroneOpacity}
                    onAcousticOpacityChange={setAcousticOpacity}
                    acousticCount={acousticDetections.length}
                    coverageVisible={coverageVisible}
                    acousticRangeVisible={acousticRangeVisible}
                    onCoverageToggle={() => setCoverageVisible(v => !v)}
                    onAcousticRangeToggle={() => setAcousticRangeVisible(v => !v)}
                />
            </div>
        </div>
    );
};

export default UnifiedMap;
