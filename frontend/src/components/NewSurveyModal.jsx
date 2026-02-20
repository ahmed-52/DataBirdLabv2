import React, { useState, useEffect } from 'react';
import { Upload, X, Loader2, FileAudio, Image, Trash2, MapPin, Plus } from 'lucide-react';

const NewSurveyModal = ({ isOpen, onClose, onUploadComplete }) => {
    const [orthomosaicFiles, setOrthomosaicFiles] = useState([]);
    const [audioFiles, setAudioFiles] = useState([]);
    const [audioAruMap, setAudioAruMap] = useState({}); // Maps audio file index to ARU ID
    const [availableArus, setAvailableArus] = useState([]);
    const [name, setName] = useState('');
    const [surveyType, setSurveyType] = useState('drone'); // 'drone' or 'acoustic'
    const [surveyDate, setSurveyDate] = useState(''); // YYYY-MM-DD format
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState('');

    // New ARU form
    const [showNewAruForm, setShowNewAruForm] = useState(false);
    const [newAruName, setNewAruName] = useState('');
    const [newAruLat, setNewAruLat] = useState('');
    const [newAruLon, setNewAruLon] = useState('');

    // Fetch ARUs when modal opens
    useEffect(() => {
        if (isOpen) {
            fetchArus();
        }
    }, [isOpen]);

    const fetchArus = async () => {
        try {
            const res = await fetch('/api/arus');
            if (res.ok) {
                const arus = await res.json();
                setAvailableArus(arus);
            }
        } catch (err) {
            console.error('Failed to fetch ARUs:', err);
        }
    };

    const handleCreateAru = async () => {
        if (!newAruName || !newAruLat || !newAruLon) {
            setError('Please fill in all ARU fields');
            return;
        }

        const formData = new FormData();
        formData.append('name', newAruName);
        formData.append('lat', parseFloat(newAruLat));
        formData.append('lon', parseFloat(newAruLon));

        try {
            const res = await fetch('/api/arus', {
                method: 'POST',
                body: formData
            });

            if (res.ok) {
                const newAru = await res.json();
                setAvailableArus([...availableArus, newAru]);
                setShowNewAruForm(false);
                setNewAruName('');
                setNewAruLat('');
                setNewAruLon('');
                setError('');
            }
        } catch (err) {
            setError('Failed to create ARU');
        }
    };

    if (!isOpen) return null;

    const handleOrthomosaicChange = (e) => {
        const files = Array.from(e.target.files);
        const validFiles = files.filter(f =>
            f.name.toLowerCase().endsWith('.tif') || f.name.toLowerCase().endsWith('.tiff')
        );
        setOrthomosaicFiles([...orthomosaicFiles, ...validFiles]);
    };

    const handleAudioChange = (e) => {
        const files = Array.from(e.target.files);
        const validFiles = files.filter(f =>
            f.name.toLowerCase().endsWith('.wav') ||
            f.name.toLowerCase().endsWith('.mp3') ||
            f.name.toLowerCase().endsWith('.flac')
        );
        const startIndex = audioFiles.length;
        setAudioFiles([...audioFiles, ...validFiles]);

        // Auto-select first ARU if available
        if (availableArus.length > 0) {
            const newMap = { ...audioAruMap };
            validFiles.forEach((_, idx) => {
                newMap[startIndex + idx] = availableArus[0].id;
            });
            setAudioAruMap(newMap);
        }
    };

    const removeOrthomosaic = (index) => {
        setOrthomosaicFiles(orthomosaicFiles.filter((_, i) => i !== index));
    };

    const removeAudio = (index) => {
        setAudioFiles(audioFiles.filter((_, i) => i !== index));
        const newMap = { ...audioAruMap };
        delete newMap[index];
        setAudioAruMap(newMap);
    };

    const setAruForAudio = (audioIndex, aruId) => {
        setAudioAruMap({ ...audioAruMap, [audioIndex]: parseInt(aruId) });
    };

    const formatFileSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!name) {
            setError("Please provide a survey name.");
            return;
        }

        if (orthomosaicFiles.length === 0 && audioFiles.length === 0) {
            setError("Please upload at least one file.");
            return;
        }

        // Check all audio files have ARUs selected
        for (let i = 0; i < audioFiles.length; i++) {
            if (!audioAruMap[i]) {
                setError(`Please select an ARU for ${audioFiles[i].name}`);
                return;
            }
        }

        setIsUploading(true);
        setError('');

        const formData = new FormData();
        formData.append('survey_name', name);
        formData.append('survey_type', surveyType);
        if (surveyDate) {
            formData.append('survey_date', surveyDate);
        }

        // Append all orthomosaic files
        orthomosaicFiles.forEach(file => {
            formData.append('orthomosaics', file);
        });

        // Append all audio files
        audioFiles.forEach(file => {
            formData.append('audio_files', file);
        });

        // Send ARU mapping as JSON
        formData.append('audio_aru_mapping', JSON.stringify(audioAruMap));

        try {
            const res = await fetch('/api/surveys/import', {
                method: 'POST',
                body: formData,
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.detail || "Upload failed");
            }

            const data = await res.json();
            onUploadComplete(data);

            // Reset form
            setName('');
            setOrthomosaicFiles([]);
            setAudioFiles([]);
            setAudioAruMap({});
            onClose();
        } catch (err) {
            console.error(err);
            setError(err.message || "Failed to upload survey. Please try again.");
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
            <div className="bg-white border border-zinc-300 shadow-none rounded-lg w-full max-w-3xl m-4 relative animate-in fade-in zoom-in duration-100 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
                    <div>
                        <h2 className="text-lg font-bold text-zinc-900 font-display uppercase tracking-tight">Ingest Survey Data</h2>
                        <p className="text-xs text-zinc-500 font-mono mt-0.5">MANUAL UPLOAD PROTOCOL</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-zinc-400 hover:text-zinc-600 transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    {/* Survey Name */}
                    <div>
                        <label className="block text-xs font-bold text-zinc-600 mb-1.5 uppercase tracking-wide">Survey Identifier</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. SNE_ZONE2_2026_Q1"
                            className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-sm focus:outline-none focus:border-primary text-zinc-900 text-sm font-mono placeholder:text-zinc-400 focus:ring-1 focus:ring-primary"
                        />
                    </div>

                    {/* Survey Type Selector */}
                    <div>
                        <label className="block text-xs font-bold text-zinc-600 mb-1.5 uppercase tracking-wide">Data Source Type</label>
                        <div className="grid grid-cols-2 gap-4">
                            <button
                                type="button"
                                onClick={() => setSurveyType('drone')}
                                className={`px-4 py-3 rounded-sm border transition-all flex items-center justify-center gap-2 ${surveyType === 'drone' ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300'}`}
                            >
                                <Image size={16} />
                                <span className="text-sm font-medium">Aerial / Orthomosaic</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setSurveyType('acoustic')}
                                className={`px-4 py-3 rounded-sm border transition-all flex items-center justify-center gap-2 ${surveyType === 'acoustic' ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300'}`}
                            >
                                <FileAudio size={16} />
                                <span className="text-sm font-medium">Bioacoustic Array</span>
                            </button>
                        </div>
                    </div>

                    {/* Survey Date - Only show for drone surveys */}
                    {surveyType === 'drone' && (
                        <div>
                            <label className="block text-xs font-bold text-zinc-600 mb-1.5 uppercase tracking-wide">Date</label>
                            <input
                                type="date"
                                value={surveyDate}
                                onChange={(e) => setSurveyDate(e.target.value)}
                                className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-sm focus:outline-none focus:border-primary text-zinc-900 text-sm font-mono focus:ring-1 focus:ring-primary"
                            />
                            <p className="text-[10px] text-zinc-400 mt-1 font-mono">DEFAULT: CURRENT_DATE</p>
                        </div>
                    )}

                    {/* Acoustic Date Note */}
                    {surveyType === 'acoustic' && (
                        <div className="bg-amber-50 border border-amber-200 rounded-sm p-3 flex items-start gap-2">
                            <div className="mt-0.5 text-amber-600 text-xs font-mono font-bold">WARNING:</div>
                            <div className="text-xs text-amber-900">
                                Date metadata extracted from filenames (Format: YYYYMMDD). Ensure strict naming compliance.
                            </div>
                        </div>
                    )}

                    {/* Conditional File Upload Sections */}
                    {surveyType === 'drone' && (
                        <div>
                            <label className="block text-xs font-bold text-zinc-600 mb-1.5 uppercase tracking-wide flex items-center gap-2">
                                <Image size={14} className="text-primary" />
                                Payload: Orthomosaic (.tif)
                            </label>
                            <div className="border border-dashed border-zinc-300 rounded-sm p-6 flex flex-col items-center justify-center text-center hover:bg-zinc-50 transition-colors cursor-pointer relative group bg-zinc-50/30">
                                <input
                                    type="file"
                                    accept=".tif,.tiff"
                                    multiple
                                    onChange={handleOrthomosaicChange}
                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                />
                                <Upload className="text-zinc-400 mb-2 group-hover:text-primary transition-colors" size={20} />
                                <span className="text-xs font-mono text-zinc-500">DRAG_DROP_ALIGNED_TIFF</span>
                            </div>

                            {/* Orthomosaic File List */}
                            {orthomosaicFiles.length > 0 && (
                                <div className="mt-3 space-y-2">
                                    {orthomosaicFiles.map((file, index) => (
                                        <div key={index} className="flex items-center justify-between bg-zinc-50 border border-zinc-200 rounded-sm p-2">
                                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                                <Image size={14} className="text-zinc-500 flex-shrink-0" />
                                                <span className="text-xs font-mono text-zinc-700 truncate">{file.name}</span>
                                                <span className="text-[10px] font-mono text-zinc-400 flex-shrink-0">({formatFileSize(file.size)})</span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => removeOrthomosaic(index)}
                                                className="text-zinc-400 hover:text-rose-600 transition-colors ml-2"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Audio Files - Show for acoustic surveys */}
                    {surveyType === 'acoustic' && (
                        <div>
                            <label className="block text-xs font-bold text-zinc-600 mb-1.5 uppercase tracking-wide flex items-center gap-2">
                                <FileAudio size={14} className="text-primary" />
                                Payload: Audio (.wav)
                            </label>
                            <div className="border border-dashed border-zinc-300 rounded-sm p-6 flex flex-col items-center justify-center text-center hover:bg-zinc-50 transition-colors cursor-pointer relative group bg-zinc-50/30">
                                <input
                                    type="file"
                                    accept=".wav,.mp3,.flac"
                                    multiple
                                    onChange={handleAudioChange}
                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                />
                                <Upload className="text-zinc-400 mb-2 group-hover:text-primary transition-colors" size={20} />
                                <span className="text-xs font-mono text-zinc-500">DRAG_DROP_AUDIO_STREAMS</span>
                            </div>

                            {/* Audio File List with ARU Selection */}
                            {audioFiles.length > 0 && (
                                <div className="mt-3 space-y-2">
                                    {audioFiles.map((file, index) => (
                                        <div key={index} className="bg-zinc-50 border border-zinc-200 rounded-sm p-3">
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                                    <FileAudio size={14} className="text-zinc-600 flex-shrink-0" />
                                                    <span className="text-xs font-mono text-zinc-900 truncate">{file.name}</span>
                                                    <span className="text-[10px] font-mono text-zinc-400 flex-shrink-0">({formatFileSize(file.size)})</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removeAudio(index)}
                                                    className="text-zinc-400 hover:text-rose-600 transition-colors ml-2"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>

                                            {/* ARU Selection */}
                                            <div className="flex items-center gap-2">
                                                <MapPin size={12} className="text-zinc-400 flex-shrink-0" />
                                                <select
                                                    value={audioAruMap[index] || ''}
                                                    onChange={(e) => setAruForAudio(index, e.target.value)}
                                                    className="flex-1 text-xs px-2 py-1.5 bg-white border border-zinc-300 rounded-sm focus:outline-none focus:border-primary font-mono"
                                                >
                                                    <option value="">SELECT_SENSOR_NODE...</option>
                                                    {availableArus.map(aru => (
                                                        <option key={aru.id} value={aru.id}>
                                                            {aru.name} ({aru.lat.toFixed(5)}, {aru.lon.toFixed(5)})
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    ))}

                                    {/* Add New ARU Button */}
                                    {!showNewAruForm && (
                                        <button
                                            type="button"
                                            onClick={() => setShowNewAruForm(true)}
                                            className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-zinc-300 rounded-sm text-zinc-600 hover:bg-zinc-50 transition-colors text-xs font-medium uppercase tracking-wide"
                                        >
                                            <Plus size={14} />
                                            Define New Sensor Node
                                        </button>
                                    )}

                                    {/* New ARU Form */}
                                    {showNewAruForm && (
                                        <div className="bg-zinc-50 border border-zinc-200 rounded-sm p-3 space-y-2">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-xs font-bold text-zinc-700 uppercase">New Node Config</span>
                                                <button
                                                    type="button"
                                                    onClick={() => setShowNewAruForm(false)}
                                                    className="text-zinc-400 hover:text-zinc-600"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                            <input
                                                type="text"
                                                placeholder="NODE_ID (e.g. ARU_04)"
                                                value={newAruName}
                                                onChange={(e) => setNewAruName(e.target.value)}
                                                className="w-full text-xs font-mono px-2 py-1 border border-zinc-300 rounded-sm focus:outline-none focus:border-primary bg-white"
                                            />
                                            <div className="grid grid-cols-2 gap-2">
                                                <input
                                                    type="number"
                                                    step="any"
                                                    placeholder="LATITUDE"
                                                    value={newAruLat}
                                                    onChange={(e) => setNewAruLat(e.target.value)}
                                                    className="text-xs font-mono px-2 py-1 border border-zinc-300 rounded-sm focus:outline-none focus:border-primary bg-white"
                                                />
                                                <input
                                                    type="number"
                                                    step="any"
                                                    placeholder="LONGITUDE"
                                                    value={newAruLon}
                                                    onChange={(e) => setNewAruLon(e.target.value)}
                                                    className="text-xs font-mono px-2 py-1 border border-zinc-300 rounded-sm focus:outline-none focus:border-primary bg-white"
                                                />
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleCreateAru}
                                                className="w-full px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold uppercase rounded-sm transition-colors"
                                            >
                                                Initialize Node
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Error Message */}
                    {error && (
                        <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 px-3 py-2 rounded-sm font-mono">
                            ERROR: {error}
                        </div>
                    )}

                    {/* Submit Button */}
                    <div className="pt-2 border-t border-zinc-200">
                        <button
                            type="submit"
                            disabled={isUploading}
                            className="w-full py-3 bg-primary hover:bg-teal-900 text-white font-bold uppercase tracking-wider text-xs rounded-sm shadow-none transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 border border-transparent"
                        >
                            {isUploading ? (
                                <>
                                    <Loader2 className="animate-spin" size={14} />
                                    PROCESSING_STREAM...
                                </>
                            ) : (
                                `INITIATE_UPLOAD (${orthomosaicFiles.length + audioFiles.length})`
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default NewSurveyModal;
