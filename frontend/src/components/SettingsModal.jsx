import React, { useState, useEffect } from 'react';
import { Upload, X, Loader2, Settings, Save, AlertTriangle, FileCode } from 'lucide-react';

const SettingsModal = ({ isOpen, onClose }) => {
    const [minConfidence, setMinConfidence] = useState(0.25);
    const [defaultLat, setDefaultLat] = useState(11.406949);
    const [defaultLon, setDefaultLon] = useState(105.394883);

    // File states
    const [acousticModel, setAcousticModel] = useState(null);
    const [visualModel, setVisualModel] = useState(null);

    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [message, setMessage] = useState(null); // { type: 'success' | 'error', text: '' }

    // Fetch Settings
    useEffect(() => {
        if (isOpen) {
            fetchSettings();
        }
    }, [isOpen]);

    const fetchSettings = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/settings');
            if (res.ok) {
                const data = await res.json();
                setMinConfidence(data.min_confidence);
                setDefaultLat(data.default_lat);
                setDefaultLon(data.default_lon);
            }
        } catch (err) {
            console.error("Failed to fetch settings:", err);
            setMessage({ type: 'error', text: 'Failed to load settings.' });
        } finally {
            setLoading(false);
        }
    };

    const handleSaveSettings = async (e) => {
        e.preventDefault();
        setUploading(true);
        setMessage(null);

        try {
            // 1. Save Basic Settings
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    min_confidence: parseFloat(minConfidence),
                    default_lat: parseFloat(defaultLat),
                    default_lon: parseFloat(defaultLon),
                    // ID is fixed to 1 in backend usually
                    id: 1
                })
            });

            if (!res.ok) throw new Error("Failed to save configuration");

            // 2. Upload Acoustic Model if selected
            if (acousticModel) {
                const formData = new FormData();
                formData.append('file', acousticModel);
                formData.append('type', 'acoustic');
                const upRes = await fetch('/api/settings/upload-model', {
                    method: 'POST',
                    body: formData
                });
                if (!upRes.ok) throw new Error("Failed to upload acoustic model");
            }

            // 3. Upload Visual Model if selected
            if (visualModel) {
                const formData = new FormData();
                formData.append('file', visualModel);
                formData.append('type', 'visual');
                const upRes = await fetch('/api/settings/upload-model', {
                    method: 'POST',
                    body: formData
                });
                if (!upRes.ok) throw new Error("Failed to upload visual model");
            }

            setMessage({ type: 'success', text: 'Settings saved successfully!' });

            // Clear files after successful upload
            setAcousticModel(null);
            setVisualModel(null);

            // Close after short delay? No, user might want to see confirmation
        } catch (err) {
            console.error(err);
            setMessage({ type: 'error', text: err.message || "An error occurred." });
        } finally {
            setUploading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
            <div className="bg-white border border-zinc-300 shadow-none rounded-lg w-full max-w-2xl m-4 relative animate-in fade-in zoom-in duration-100 overflow-y-auto max-h-[90vh]">
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
                    <div className="flex items-center gap-3">
                        <div className="bg-zinc-100 p-2 rounded-sm border border-zinc-200">
                            <Settings className="text-zinc-700" size={18} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-zinc-900 font-display uppercase tracking-tight">System Configuration</h2>
                            <p className="text-xs text-zinc-500 font-mono mt-0.5">PIPELINE_PARAMS // MODEL_REGISTRY</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-zinc-400 hover:text-zinc-600 transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {loading ? (
                    <div className="flex justify-center p-8">
                        <Loader2 className="animate-spin text-zinc-400" size={24} />
                    </div>
                ) : (
                    <form onSubmit={handleSaveSettings} className="p-6 space-y-8">

                        {/* Pipeline Parameters */}
                        <div className="space-y-4">
                            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest border-b border-zinc-100 pb-2">Analysis Pipeline</h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-zinc-700 mb-1.5 uppercase font-mono">Detection Confidence</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            max="1"
                                            value={minConfidence}
                                            onChange={(e) => setMinConfidence(e.target.value)}
                                            className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-sm focus:outline-none focus:border-primary text-zinc-900 text-sm font-mono focus:ring-1 focus:ring-primary"
                                        />
                                        <div className="absolute right-3 top-2.5 text-[10px] text-zinc-400 font-mono">THRESHOLD</div>
                                    </div>
                                    <p className="text-[10px] text-zinc-400 mt-1 font-mono">RANGE: 0.0 - 1.0 (DEFAULT: 0.25)</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-zinc-700 mb-1.5 uppercase font-mono">Default Latitude</label>
                                    <input
                                        type="number"
                                        step="any"
                                        value={defaultLat}
                                        onChange={(e) => setDefaultLat(e.target.value)}
                                        className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-sm focus:outline-none focus:border-primary text-zinc-900 text-sm font-mono focus:ring-1 focus:ring-primary"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-zinc-700 mb-1.5 uppercase font-mono">Default Longitude</label>
                                    <input
                                        type="number"
                                        step="any"
                                        value={defaultLon}
                                        onChange={(e) => setDefaultLon(e.target.value)}
                                        className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-sm focus:outline-none focus:border-primary text-zinc-900 text-sm font-mono focus:ring-1 focus:ring-primary"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Model Management */}
                        <div className="space-y-4">
                            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest border-b border-zinc-100 pb-2">Inference Engines</h3>

                            {/* Acoustic Model */}
                            <div className="bg-zinc-50 border border-zinc-200 rounded-sm p-4">
                                <label className="block text-xs font-bold text-zinc-700 mb-2 flex items-center gap-2 uppercase font-mono">
                                    <FileCode size={14} className="text-primary" />
                                    Acoustic Classifier Override
                                </label>
                                <div className="flex items-center gap-4">
                                    <div className="flex-1">
                                        <input
                                            type="file"
                                            accept=".tflite,.pt,.onnx"
                                            onChange={(e) => setAcousticModel(e.target.files[0])}
                                            className="block w-full text-xs text-zinc-500 font-mono file:mr-4 file:py-2 file:px-4 file:rounded-sm file:border-0 file:text-xs file:font-bold file:uppercase file:bg-zinc-200 file:text-zinc-700 hover:file:bg-zinc-300"
                                        />
                                    </div>
                                </div>
                                <p className="text-[10px] text-zinc-400 mt-2 font-mono">TARGET: BirdNET Custom Classifier (.tflite)</p>
                            </div>

                            {/* Visual Model */}
                            <div className="bg-zinc-50 border border-zinc-200 rounded-sm p-4">
                                <label className="block text-xs font-bold text-zinc-700 mb-2 flex items-center gap-2 uppercase font-mono">
                                    <FileCode size={14} className="text-primary" />
                                    Visual Object Detector Override
                                </label>
                                <div className="flex items-center gap-4">
                                    <div className="flex-1">
                                        <input
                                            type="file"
                                            accept=".pt,.onnx"
                                            onChange={(e) => setVisualModel(e.target.files[0])}
                                            className="block w-full text-xs text-zinc-500 font-mono file:mr-4 file:py-2 file:px-4 file:rounded-sm file:border-0 file:text-xs file:font-bold file:uppercase file:bg-zinc-200 file:text-zinc-700 hover:file:bg-zinc-300"
                                        />
                                    </div>
                                </div>
                                <p className="text-[10px] text-zinc-400 mt-2 font-mono">TARGET: YOLOv8 Custom Weights (.pt)</p>
                            </div>
                        </div>

                        {/* Species Color Mapping */}
                        <SpeciesColorMapping />

                        {/* Status Message */}
                        {message && (
                            <div className={`text-xs font-mono px-4 py-3 rounded-sm flex items-center gap-2 border ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'
                                }`}>
                                {message.type === 'error' && <AlertTriangle size={14} />}
                                {message.text}
                            </div>
                        )}

                        {/* Actions */}
                        <div className="pt-4 border-t border-zinc-200 flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 text-zinc-600 hover:bg-zinc-100 font-bold uppercase text-xs rounded-sm transition-colors border border-transparent"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={uploading}
                                className="px-6 py-2 bg-zinc-900 hover:bg-zinc-800 text-white font-bold uppercase text-xs rounded-sm shadow-none transition-all flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed border border-zinc-900"
                            >
                                {uploading ? (
                                    <>
                                        <Loader2 className="animate-spin" size={14} />
                                        SAVING_CONFIG...
                                    </>
                                ) : (
                                    <>
                                        <Save size={14} />
                                        COMMIT_CHANGES
                                    </>
                                )}
                            </button>
                        </div>

                    </form>
                )}
            </div>
        </div>
    );
};

/**
 * Species Color Mapping Sub-Component
 * Allows users to configure which species belong to which color category for fusion inference.
 */
const SpeciesColorMapping = () => {
    const [mapping, setMapping] = useState({
        white: [],
        black: [],
        brown: [],
        grey: []
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [newSpecies, setNewSpecies] = useState({ white: '', black: '', brown: '', grey: '' });

    useEffect(() => {
        // Fetch existing mapping
        fetch('/api/settings/species_colors')
            .then(res => res.json())
            .then(data => {
                if (data.mapping) {
                    setMapping({
                        white: data.mapping.white || [],
                        black: data.mapping.black || [],
                        brown: data.mapping.brown || [],
                        grey: data.mapping.grey || []
                    });
                }
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    const handleAddSpecies = (color) => {
        const species = newSpecies[color].trim();
        if (!species) return;
        if (mapping[color].includes(species)) return;

        setMapping(prev => ({
            ...prev,
            [color]: [...prev[color], species]
        }));
        setNewSpecies(prev => ({ ...prev, [color]: '' }));
    };

    const handleRemoveSpecies = (color, species) => {
        setMapping(prev => ({
            ...prev,
            [color]: prev[color].filter(s => s !== species)
        }));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await fetch('/api/settings/species_colors', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(mapping)
            });
        } catch (err) {
            console.error('Failed to save species colors:', err);
        } finally {
            setSaving(false);
        }
    };

    const colorLabels = {
        white: { label: 'Class: White', bg: 'bg-zinc-100', text: 'text-zinc-700', border: 'border-zinc-200' },
        black: { label: 'Class: Black', bg: 'bg-zinc-800', text: 'text-white', border: 'border-zinc-700' },
        brown: { label: 'Class: Brown', bg: 'bg-amber-100', text: 'text-amber-900', border: 'border-amber-200' },
        grey: { label: 'Class: Grey', bg: 'bg-zinc-200', text: 'text-zinc-800', border: 'border-zinc-300' }
    };

    if (loading) return <div className="text-xs font-mono text-zinc-400 py-4">LOADING_MAPPING_MATRIX...</div>;

    return (
        <div className="space-y-4 pt-6">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Fusion Taxonomy Mapping</h3>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="text-[10px] px-3 py-1 bg-zinc-100 text-zinc-700 border border-zinc-200 rounded-sm font-bold uppercase hover:bg-zinc-200 disabled:opacity-50"
                >
                    {saving ? 'SAVING...' : 'SAVE_TAXONOMY'}
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(colorLabels).map(([color, style]) => (
                    <div key={color} className={`p-3 rounded-sm border ${style.border} bg-white`}>
                        <div className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${style.text === 'text-white' ? 'text-zinc-900' : style.text} flex items-center justify-between`}>
                            <span>{style.label}</span>
                            <div className={`w-3 h-3 rounded-full border border-black/10 ${style.bg}`}></div>
                        </div>
                        <div className="flex flex-wrap gap-1 mb-2 min-h-[32px] bg-zinc-50/50 p-2 rounded-sm border border-zinc-100">
                            {mapping[color].map(sp => (
                                <span
                                    key={sp}
                                    className={`px-2 py-0.5 text-[10px] font-mono rounded-sm border ${style.border} ${style.bg} ${style.text} cursor-pointer hover:opacity-70 flex items-center gap-1`}
                                    onClick={() => handleRemoveSpecies(color, sp)}
                                    title="REMOVE_NODE"
                                >
                                    {sp} <span className="opacity-50">×</span>
                                </span>
                            ))}
                            {mapping[color].length === 0 && (
                                <span className="text-[10px] text-zinc-300 font-mono italic">NO_DATA_NODES</span>
                            )}
                        </div>

                        <div className="flex gap-1">
                            <input
                                type="text"
                                placeholder={`ADD_SPECIES...`}
                                value={newSpecies[color]}
                                onChange={(e) => setNewSpecies(prev => ({ ...prev, [color]: e.target.value }))}
                                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddSpecies(color))}
                                className="flex-1 px-2 py-1 text-xs font-mono bg-white border border-zinc-200 rounded-sm focus:outline-none focus:border-primary"
                            />
                            <button
                                type="button"
                                onClick={() => handleAddSpecies(color)}
                                className="px-2 py-1 text-xs bg-zinc-100 text-zinc-600 border border-zinc-200 rounded-sm hover:bg-zinc-200"
                            >
                                +
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default SettingsModal;
