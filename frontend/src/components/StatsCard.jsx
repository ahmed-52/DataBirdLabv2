import React from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

const StatsCard = ({ title, value, icon: Icon, trend, trendUp }) => {
    return (
        <div className="tech-card p-4 rounded-lg flex flex-col justify-between h-[120px] relative overflow-hidden">
            <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-display">{title}</span>
                {Icon && <Icon size={14} className="text-zinc-400" />}
            </div>

            <div className="mt-auto">
                <h3 className="text-3xl font-mono font-bold text-zinc-900 tracking-tight leading-none">{value}</h3>
                {trend && (
                    <div className={`flex items-center gap-1.5 text-[10px] font-mono mt-2 ${trendUp ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {trendUp ? <ChevronUp size={10} strokeWidth={3} /> : <ChevronDown size={10} strokeWidth={3} />}
                        {trend}
                    </div>
                )}
            </div>
        </div>
    );
};

export default StatsCard;
