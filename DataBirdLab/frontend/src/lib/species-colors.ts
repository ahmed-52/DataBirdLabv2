// Deterministic color generator for distinct species

export interface SpeciesColor {
    border: string
    bg: string
    text: string
}

const colors: SpeciesColor[] = [
    { border: '#ef4444', bg: 'rgba(239, 68, 68, 0.2)', text: '#b91c1c' }, // Red
    { border: '#f97316', bg: 'rgba(249, 115, 22, 0.2)', text: '#c2410c' }, // Orange
    { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.2)', text: '#b45309' }, // Amber
    { border: '#84cc16', bg: 'rgba(132, 204, 22, 0.2)', text: '#4d7c0f' }, // Lime
    { border: '#10b981', bg: 'rgba(16, 185, 129, 0.2)', text: '#047857' }, // Emerald
    { border: '#06b6d4', bg: 'rgba(6, 182, 212, 0.2)', text: '#0e7490' }, // Cyan
    { border: '#3b82f6', bg: 'rgba(59, 130, 246, 0.2)', text: '#1d4ed8' }, // Blue
    { border: '#6366f1', bg: 'rgba(99, 102, 241, 0.2)', text: '#4338ca' }, // Indigo
    { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.2)', text: '#6d28d9' }, // Violet
    { border: '#d946ef', bg: 'rgba(217, 70, 239, 0.2)', text: '#a21caf' }, // Fuchsia
    { border: '#f43f5e', bg: 'rgba(244, 63, 94, 0.2)', text: '#be123c' }, // Rose
]

export function getSpeciesColor(species: string): SpeciesColor {
    let hash = 0
    for (let i = 0; i < species.length; i++) {
        hash = species.charCodeAt(i) + ((hash << 5) - hash)
    }
    return colors[Math.abs(hash) % colors.length]
}
