import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { VisualDetection } from '@/types';
import { getSpeciesColor } from '@/lib/species-colors';

// ── Species → RGB ────────────────────────────────────────────────────────────

const FIXED: Record<string, [number, number, number]> = {
    white_birds: [200, 220, 255],
    black_birds: [139, 92,  246],   // violet
    brown_birds: [217, 119,   6],   // amber
    grey_birds:  [ 99, 155, 190],   // steel blue
};

function hexToRgb(hex: string): [number, number, number] {
    return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
    ];
}

function speciesRgb(species: string): [number, number, number] {
    if (species in FIXED) return FIXED[species];
    return hexToRgb(getSpeciesColor(species).border);
}

// ── Geo helpers ───────────────────────────────────────────────────────────────

function metersToPixels(map: L.Map, metres: number, lat: number): number {
    const zoom = map.getZoom();
    const res = (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
    return Math.max(3, metres / res);
}

// ── Pre-processed detection (computed once per data change) ───────────────────

interface PreparedDetection {
    lat: number;
    lon: number;
    confidence: number;
    species: string;
    rgb: [number, number, number];
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface SpeciesDensityLayerProps {
    detections: VisualDetection[];
    visible: boolean;
    /** Real-world blob radius in metres (scales with zoom). */
    radiusMeters?: number;
    /** Reference latitude for metre→pixel conversion. */
    refLat?: number;
    /** Overall layer opacity 0–1 applied to the canvas element. */
    opacity?: number;
}

const SpeciesDensityLayer: React.FC<SpeciesDensityLayerProps> = ({
    detections,
    visible,
    radiusMeters = 18,
    refLat = 11.4,
    opacity = 1,
}) => {
    const map = useMap();
    const canvasRef   = useRef<HTMLCanvasElement | null>(null);
    // Sprite cache: species label → tiny offscreen canvas drawn once per zoom level
    const spriteCache  = useRef<Map<string, HTMLCanvasElement>>(new Map());
    const lastRadiusPx = useRef<number>(0);
    const rafRef       = useRef<number>(0);

    // ── Pre-process once per data change: filter null coords, sort by confidence,
    //    and cache each detection's RGB so draw() never recomputes it.
    const prepared = useMemo<PreparedDetection[]>(() => {
        return detections
            .filter(d => d.lat != null && d.lon != null)
            .sort((a, b) => a.confidence - b.confidence)
            .map(d => ({
                lat:        d.lat as number,
                lon:        d.lon as number,
                confidence: d.confidence,
                species:    d.species,
                rgb:        speciesRgb(d.species),
            }));
    }, [detections]);

    // ── Build/retrieve a sprite canvas for a given species at current radius.
    //    Instead of calling createRadialGradient per-point (≈27k × per frame),
    //    we create it once per species and reuse it with drawImage + globalAlpha.
    const getSprite = useCallback(
        (species: string, rgb: [number, number, number], radiusPx: number): HTMLCanvasElement => {
            const cached = spriteCache.current.get(species);
            if (cached) return cached;

            const size = Math.ceil(radiusPx * 2) + 4;
            const sc   = document.createElement('canvas');
            sc.width   = size;
            sc.height  = size;
            const sctx = sc.getContext('2d')!;
            const cx   = size / 2;
            const [r, g, b] = rgb;

            // Draw at alpha=1 — per-point alpha is applied via ctx.globalAlpha
            const grad = sctx.createRadialGradient(cx, cx, 0, cx, cx, radiusPx);
            grad.addColorStop(0,    `rgba(${r},${g},${b},1)`);
            grad.addColorStop(0.45, `rgba(${r},${g},${b},0.55)`);
            grad.addColorStop(1,    `rgba(${r},${g},${b},0)`);
            sctx.beginPath();
            sctx.fillStyle = grad;
            sctx.arc(cx, cx, radiusPx, 0, Math.PI * 2);
            sctx.fill();

            spriteCache.current.set(species, sc);
            return sc;
        },
        [],
    );

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const size    = map.getSize();
        const topLeft = map.containerPointToLayerPoint([0, 0] as L.PointTuple);
        L.DomUtil.setPosition(canvas, topLeft);
        canvas.width  = size.x;
        canvas.height = size.y;

        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, size.x, size.y);
        if (!visible || prepared.length === 0) return;

        const radiusPx   = metersToPixels(map, radiusMeters, refLat);
        const spriteHalf = Math.ceil(radiusPx) + 2;

        // Invalidate sprite cache on zoom change (radius changes)
        if (Math.abs(lastRadiusPx.current - radiusPx) > 0.5) {
            spriteCache.current.clear();
            lastRadiusPx.current = radiusPx;
        }

        // Viewport culling: skip points outside the visible area (small padding)
        const bounds = map.getBounds().pad(0.05);

        // Collect center-dot draws so we can batch them by color (one fill() per species)
        const dotGroups = new Map<string, Array<{ x: number; y: number; r: number }>>();
        const showDots  = radiusPx > 10;
        const dotBase   = Math.min(2.5, radiusPx * 0.12);

        for (const det of prepared) {
            // ── Viewport cull ───────────────────────────────────────────────
            if (!bounds.contains([det.lat, det.lon])) continue;

            const lp  = map.latLngToLayerPoint([det.lat, det.lon]);
            const x   = lp.x - topLeft.x;
            const y   = lp.y - topLeft.y;

            // ── Sprite blit (replaces per-point createRadialGradient) ───────
            const sprite = getSprite(det.species, det.rgb, radiusPx);
            ctx.globalAlpha = 0.18 + det.confidence * 0.37;
            ctx.drawImage(sprite, x - spriteHalf, y - spriteHalf);

            // ── Collect center dot ──────────────────────────────────────────
            if (showDots) {
                const colorKey = `${det.rgb[0]},${det.rgb[1]},${det.rgb[2]}`;
                if (!dotGroups.has(colorKey)) dotGroups.set(colorKey, []);
                dotGroups.get(colorKey)!.push({ x, y, r: dotBase });
            }
        }

        // ── Batch-render center dots: one beginPath+fill per color group ────
        if (showDots && dotGroups.size > 0) {
            ctx.globalAlpha = 0.85;
            for (const [colorKey, dots] of dotGroups) {
                ctx.fillStyle = `rgb(${colorKey})`;
                ctx.beginPath();
                for (const dot of dots) {
                    // moveTo prevents implicit lineTo between arcs
                    ctx.moveTo(dot.x + dot.r, dot.y);
                    ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
                }
                ctx.fill();
            }
        }

        ctx.globalAlpha = 1;
    }, [map, prepared, visible, radiusMeters, refLat, getSprite]);

    // RAF-based scheduling prevents overdraw if multiple events fire in one frame
    const scheduleDraw = useCallback(() => {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(draw);
    }, [draw]);

    // Mount / unmount the canvas element in Leaflet's overlay pane
    useEffect(() => {
        const pane   = map.getPanes().overlayPane;
        const canvas = document.createElement('canvas');
        canvas.style.position     = 'absolute';
        canvas.style.pointerEvents = 'none';
        canvas.style.opacity      = String(opacity);
        pane.appendChild(canvas);
        canvasRef.current = canvas;

        scheduleDraw();

        return () => {
            cancelAnimationFrame(rafRef.current);
            if (pane.contains(canvas)) pane.removeChild(canvas);
            canvasRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [map]);

    // Redraw whenever data / visibility changes
    useEffect(() => { scheduleDraw(); }, [scheduleDraw]);

    // Keep opacity in sync without a full redraw
    useEffect(() => {
        if (canvasRef.current) canvasRef.current.style.opacity = String(opacity);
    }, [opacity]);

    // Redraw after pan / zoom settles
    useMapEvents({ moveend: scheduleDraw, zoomend: scheduleDraw });

    return null;
};

export default SpeciesDensityLayer;

// ── Species legend helper (exported for use in UnifiedMap) ────────────────────

export function getDroneSpeciesLegend(
    detections: VisualDetection[]
): Array<{ species: string; color: string }> {
    const seen = new Set<string>();
    for (const d of detections) seen.add(d.species);
    return Array.from(seen).map(species => ({
        species,
        color: species in FIXED
            ? `rgb(${FIXED[species as keyof typeof FIXED].join(',')})`
            : getSpeciesColor(species).border,
    }));
}
