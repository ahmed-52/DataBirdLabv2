import React, { useEffect, useState } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts';
import { Activity, ChevronDown, Filter } from 'lucide-react';

const SpeciesActivityChart = ({ type = 'visual', title }) => {
    // State
    const [speciesList, setSpeciesList] = useState([]);
    const [selectedSpecies, setSelectedSpecies] = useState('Asian Openbill');
    const [days, setDays] = useState(30);
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);

    // Fetch Species List on Mount
    useEffect(() => {
        fetch(`http://localhost:8000/api/species_list?type=${type}`)
            .then(res => res.json())
            .then(list => {
                setSpeciesList(list);
                // If default not found, pick first
                if (list.length > 0 && !list.includes('Asian Openbill')) {
                    setSelectedSpecies(list[0]);
                }
            })
            .catch(err => console.error("Failed to fetch species list:", err));
    }, [type]);

    // Fetch Chart Data when filters change
    useEffect(() => {
        if (!selectedSpecies) return;

        setLoading(true);
        fetch(`http://localhost:8000/api/stats/species_history?species_name=${encodeURIComponent(selectedSpecies)}&days=${days}&type=${type}`)
            .then(res => res.json())
            .then(setData)
            .catch(err => console.error("Failed to fetch species history:", err))
            .finally(() => setLoading(false));
    }, [selectedSpecies, days, type]);

    const color = type === 'visual' ? '#0d9488' : '#ea580c'; // Teal vs Orange
    const fillColor = type === 'visual' ? '#ccfbf1' : '#ffedd5';

    return (
        <div className="w-full h-full flex flex-col pt-3 px-1">
            {/* Header / Controls */}
            <div className="flex justify-between items-start mb-2 px-3">
                <div className="flex items-center gap-2">
                    <Activity size={16} style={{ color }} />
                    <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
                </div>

                <div className="flex gap-2">
                    {/* Time Filter */}
                    <div className="flex bg-slate-100 rounded p-0.5">
                        {[7, 30, 90].map(d => (
                            <button
                                key={d}
                                onClick={() => setDays(d)}
                                className={`px-2 py-0.5 text-[10px] font-medium rounded transition-all ${days === d ? 'bg-white shadow text-slate-800' : 'text-slate-400 hover:text-slate-600'
                                    }`}
                            >
                                {d}d
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Species Selector */}
            <div className="px-3 mb-3">
                <div className="relative">
                    <select
                        value={selectedSpecies}
                        onChange={(e) => setSelectedSpecies(e.target.value)}
                        className="w-full appearance-none bg-slate-50 border border-slate-200 text-slate-700 text-xs font-medium py-1.5 pl-3 pr-8 rounded leading-tight focus:outline-none focus:border-slate-400"
                    >
                        {speciesList.map(s => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
                        <ChevronDown size={12} />
                    </div>
                </div>
            </div>

            {/* Chart */}
            <div className="flex-1 min-h-0 pl-1 pr-3 pb-2">
                {loading ? (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400">Loading...</div>
                ) : data.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data}>
                            <defs>
                                <linearGradient id={`color${type}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                                    <stop offset="95%" stopColor={color} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <XAxis
                                dataKey="label"
                                fontSize={9}
                                tickLine={false}
                                axisLine={false}
                                minTickGap={15}
                                tick={{ fill: '#94a3b8' }}
                            />
                            <YAxis
                                fontSize={9}
                                tickLine={false}
                                axisLine={false}
                                tick={{ fill: '#94a3b8' }}
                                width={20}
                            />
                            <Tooltip
                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '12px' }}
                            />
                            <Area
                                type="monotone"
                                dataKey="count"
                                stroke={color}
                                strokeWidth={2}
                                fillOpacity={1}
                                fill={`url(#color${type})`}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400 border border-dashed border-slate-100 rounded">
                        No Data for selected period
                    </div>
                )}
            </div>
        </div>
    );
};

export default SpeciesActivityChart;
