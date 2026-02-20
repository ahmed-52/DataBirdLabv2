import React, { useMemo } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend
} from 'recharts';

// Helper to aggregate detections by date
const processTimelineData = (detections, days) => {
    if (!detections || detections.length === 0) return [];

    const now = new Date();
    const data = [];

    // Initialize last N days with 0
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(now.getDate() - i);
        data.push({
            date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            fullDate: d.toDateString(),
            count: 0
        });
    }

    // Count detections
    detections.forEach(d => {
        const date = new Date(d.timestamp).toDateString();
        const item = data.find(i => i.fullDate === date);
        if (item) {
            item.count++;
        }
    });

    return data;
};

// Helper to aggregate species
const processSpeciesData = (detections) => {
    if (!detections || detections.length === 0) return [];

    const counts = {};
    detections.forEach(d => {
        const species = d.species || "Unknown";
        counts[species] = (counts[species] || 0) + 1;
    });

    return Object.entries(counts)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5); // Top 5
};

// Ecological Palette (Emerald, Teal, Amber, Sky, Rose)
const COLORS = ['#10b981', '#14b8a6', '#f59e0b', '#0ea5e9', '#f43f5e'];

export const WeeklyActivityChart = ({ days, visualDetections }) => {
    const data = useMemo(() => processTimelineData(visualDetections, days), [visualDetections, days]);

    return (
        <div className="w-full h-full flex flex-col">
            <h3 className="text-sm font-semibold text-stone-700 px-4 pt-3 mb-2">Activity Trend</h3>
            <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.1} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" /> {/* stone-200 */}
                        <XAxis
                            dataKey="date"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: '#78716c', fontSize: 10 }} // stone-500
                            dy={5}
                        />
                        <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: '#78716c', fontSize: 10 }} // stone-500
                        />
                        <Tooltip
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                            itemStyle={{ color: '#1c1917', fontSize: '12px', fontWeight: 'bold' }} // stone-900
                            labelStyle={{ color: '#a8a29e', fontSize: '11px', marginBottom: '4px' }} // stone-400
                        />
                        <Area
                            type="monotone"
                            dataKey="count"
                            stroke="#10b981" // Emerald
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#colorCount)"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export const SpeciesDistributionChart = ({ visualDetections }) => {
    const data = useMemo(() => processSpeciesData(visualDetections), [visualDetections]);

    return (

        <div className="w-full h-full flex flex-col">
            <h3 className="text-sm font-semibold text-stone-700 px-4 pt-3 mb-2">Species Distribution</h3>
            <div className="flex-1 min-h-0 flex items-center justify-center">
                {data.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={data}
                                innerRadius={45}
                                outerRadius={65}
                                paddingAngle={2}
                                dataKey="value"
                            >
                                {data.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip
                                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                itemStyle={{ color: '#1c1917', fontSize: '12px' }}
                            />
                            <Legend
                                layout="vertical"
                                verticalAlign="middle"
                                align="right"
                                iconSize={8}
                                wrapperStyle={{ fontSize: '11px', color: '#78716c' }} // stone-500
                            />
                        </PieChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="text-stone-400 text-xs text-center">No data available</div>
                )}
            </div>
        </div>
    );

};
