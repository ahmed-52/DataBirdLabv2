import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Layers } from 'lucide-react';

interface DensityControlProps {
    droneVisible: boolean;
    acousticVisible: boolean;
    onDroneToggle: () => void;
    onAcousticToggle: () => void;
    droneCount: number;
    acousticCount: number;
    coverageVisible: boolean;
    acousticRangeVisible: boolean;
    onCoverageToggle: () => void;
    onAcousticRangeToggle: () => void;
}

const DensityControl: React.FC<DensityControlProps> = ({
    droneVisible,
    acousticVisible,
    onDroneToggle,
    onAcousticToggle,
    droneCount,
    acousticCount,
    coverageVisible,
    acousticRangeVisible,
    onCoverageToggle,
    onAcousticRangeToggle,
}) => {
    const [expanded, setExpanded] = useState(true);

    return (
        <div className="bg-white/95 backdrop-blur-sm border border-zinc-200 shadow-sm rounded-sm text-[10px] font-mono text-zinc-600 uppercase tracking-wide overflow-hidden">
            {/* Header */}
            <button
                onClick={() => setExpanded(p => !p)}
                className="flex items-center gap-2 w-full px-3 py-2 hover:bg-zinc-50 transition-colors"
            >
                <Layers size={10} className="text-zinc-400 shrink-0" />
                <span className="flex-1 text-left">Density</span>
                <motion.span
                    animate={{ rotate: expanded ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                    className="text-zinc-400 leading-none"
                >
                    ▲
                </motion.span>
            </button>

            <AnimatePresence initial={false}>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                        className="overflow-hidden"
                    >
                        <div className="border-t border-zinc-100 divide-y divide-zinc-100">
                            {/* Aerial coverage row */}
                            <div className="px-3 py-2">
                                <button
                                    onClick={onCoverageToggle}
                                    className="flex items-center justify-between w-full gap-3 group"
                                    title={coverageVisible ? 'Hide aerial coverage' : 'Show aerial coverage'}
                                >
                                    <span className={`flex items-center gap-1.5 transition-colors ${coverageVisible ? 'text-teal-600' : 'text-zinc-300'}`}>
                                        {coverageVisible ? <Eye size={11} /> : <EyeOff size={11} />}
                                        <span className={coverageVisible ? 'text-zinc-700' : 'text-zinc-300'}>
                                            Aerial Cov.
                                        </span>
                                    </span>
                                    <div className={`w-2.5 h-2.5 rounded-sm border transition-opacity ${coverageVisible ? 'bg-teal-500/20 border-teal-600 opacity-100' : 'bg-zinc-100 border-zinc-300 opacity-40'}`} />
                                </button>
                            </div>

                            {/* Acoustic range row */}
                            <div className="px-3 py-2">
                                <button
                                    onClick={onAcousticRangeToggle}
                                    className="flex items-center justify-between w-full gap-3 group"
                                    title={acousticRangeVisible ? 'Hide acoustic range' : 'Show acoustic range'}
                                >
                                    <span className={`flex items-center gap-1.5 transition-colors ${acousticRangeVisible ? 'text-orange-500' : 'text-zinc-300'}`}>
                                        {acousticRangeVisible ? <Eye size={11} /> : <EyeOff size={11} />}
                                        <span className={acousticRangeVisible ? 'text-zinc-700' : 'text-zinc-300'}>
                                            Acoustic Rng
                                        </span>
                                    </span>
                                    <div className={`w-2.5 h-2.5 rounded-full border border-dashed transition-opacity ${acousticRangeVisible ? 'bg-orange-500/20 border-orange-500 opacity-100' : 'bg-zinc-100 border-zinc-300 opacity-40'}`} />
                                </button>
                            </div>
                            {/* Drone row */}
                            <div className="px-3 py-2 space-y-1.5">
                                <div className="flex items-center justify-between gap-3">
                                    <button
                                        onClick={onDroneToggle}
                                        className={`flex items-center gap-1.5 transition-colors ${droneVisible ? 'text-teal-600' : 'text-zinc-300'}`}
                                        title={droneVisible ? 'Hide drone density' : 'Show drone density'}
                                    >
                                        {droneVisible
                                            ? <Eye size={11} />
                                            : <EyeOff size={11} />
                                        }
                                        <span className={droneVisible ? 'text-zinc-700' : 'text-zinc-300'}>
                                            Drone
                                        </span>
                                    </button>
                                    <span className={`tabular-nums transition-colors ${droneVisible ? 'text-zinc-500' : 'text-zinc-300'}`}>
                                        {droneCount.toLocaleString()} pts
                                    </span>
                                </div>
                                {/* Gradient swatch */}
                                <motion.div
                                    animate={{ opacity: droneVisible ? 1 : 0.25 }}
                                    transition={{ duration: 0.2 }}
                                    className="flex items-center gap-1.5"
                                >
                                    <span className="text-zinc-400 shrink-0">lo</span>
                                    <div
                                        className="flex-1 h-2 rounded-sm"
                                        style={{
                                            background: 'linear-gradient(to right, transparent, #0d9488 35%, #22d3ee 60%, #a5f3fc 80%, #ecfeff)',
                                        }}
                                    />
                                    <span className="text-zinc-400 shrink-0">hi</span>
                                </motion.div>
                            </div>

                            {/* Acoustic row */}
                            <div className="px-3 py-2 space-y-1.5">
                                <div className="flex items-center justify-between gap-3">
                                    <button
                                        onClick={onAcousticToggle}
                                        className={`flex items-center gap-1.5 transition-colors ${acousticVisible ? 'text-orange-500' : 'text-zinc-300'}`}
                                        title={acousticVisible ? 'Hide acoustic density' : 'Show acoustic density'}
                                    >
                                        {acousticVisible
                                            ? <Eye size={11} />
                                            : <EyeOff size={11} />
                                        }
                                        <span className={acousticVisible ? 'text-zinc-700' : 'text-zinc-300'}>
                                            Acoustic
                                        </span>
                                    </button>
                                    <span className={`tabular-nums transition-colors ${acousticVisible ? 'text-zinc-500' : 'text-zinc-300'}`}>
                                        {acousticCount.toLocaleString()} pts
                                    </span>
                                </div>
                                {/* Gradient swatch */}
                                <motion.div
                                    animate={{ opacity: acousticVisible ? 1 : 0.25 }}
                                    transition={{ duration: 0.2 }}
                                    className="flex items-center gap-1.5"
                                >
                                    <span className="text-zinc-400 shrink-0">lo</span>
                                    <div
                                        className="flex-1 h-2 rounded-sm"
                                        style={{
                                            background: 'linear-gradient(to right, transparent, #ea580c 35%, #fbbf24 60%, #fde68a 80%, #fffbeb)',
                                        }}
                                    />
                                    <span className="text-zinc-400 shrink-0">hi</span>
                                </motion.div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default DensityControl;
