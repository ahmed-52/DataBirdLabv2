import { useEffect, useRef } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';

// Type augmentation for leaflet.heat plugin
declare module 'leaflet' {
    interface HeatLayerOptions {
        minOpacity?: number;
        maxZoom?: number;
        max?: number;
        radius?: number;
        blur?: number;
        gradient?: Record<number, string>;
    }

    interface HeatLayer extends Layer {
        setLatLngs(latlngs: Array<[number, number] | [number, number, number]>): this;
        addLatLng(latlng: [number, number] | [number, number, number]): this;
        setOptions(options: HeatLayerOptions): this;
        redraw(): this;
    }

    function heatLayer(
        latlngs: Array<[number, number] | [number, number, number]>,
        options?: HeatLayerOptions
    ): HeatLayer;
}

interface HeatmapLayerProps {
    /** Array of [lat, lng, intensity] tuples. Intensity should be in [0, max]. */
    points: Array<[number, number, number]>;
    visible: boolean;
    /**
     * Desired blob radius in real-world metres. Converted to pixels at each
     * zoom level so the heatmap stays geographically true to size.
     */
    radiusMeters?: number;
    /** The intensity value that maps to full color. Default 1.0. */
    max?: number;
    minOpacity?: number;
    gradient?: Record<number, string>;
    /** Reference latitude for the metres→pixels conversion. */
    refLat?: number;
    /** Overall layer opacity 0–1 applied to the canvas element. */
    opacity?: number;
}

/** Convert a geographic radius (metres) to pixels at the map's current zoom. */
function metersToPixels(map: L.Map, metres: number, lat: number): number {
    const zoom = map.getZoom();
    // Web Mercator ground resolution at this zoom and latitude
    const resolution = (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
    return Math.max(2, metres / resolution);
}

const HeatmapLayer: React.FC<HeatmapLayerProps> = ({
    points,
    visible,
    radiusMeters = 30,
    max = 1.0,
    minOpacity = 0.3,
    gradient,
    refLat = 11.4,
    opacity = 1,
}) => {
    const map = useMap();
    const layerRef = useRef<L.HeatLayer | null>(null);

    // Compute radius+blur from current zoom and rebuild/update the layer
    const applyRadius = () => {
        if (!layerRef.current) return;
        const px = metersToPixels(map, radiusMeters, refLat);
        layerRef.current.setOptions({ radius: px, blur: Math.round(px * 0.6) });
        layerRef.current.redraw();
    };

    useEffect(() => {
        if (layerRef.current) {
            map.removeLayer(layerRef.current);
            layerRef.current = null;
        }

        if (!visible || points.length === 0) return;

        const px = metersToPixels(map, radiusMeters, refLat);
        const layer = L.heatLayer(points, {
            radius: px,
            blur: Math.round(px * 0.6),
            max,
            minOpacity,
            gradient,
            // maxZoom anchors the internal grid at map max so no extra scaling occurs
            maxZoom: map.getMaxZoom(),
        });
        layer.addTo(map);
        layerRef.current = layer;
        // Apply canvas-level opacity so it composites correctly with other layers
        const canvasEl = (layer as any)._canvas as HTMLCanvasElement | undefined;
        if (canvasEl) canvasEl.style.opacity = String(opacity);

        return () => {
            if (layerRef.current) {
                map.removeLayer(layerRef.current);
                layerRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [map, points, visible, radiusMeters, max, minOpacity, gradient]);

    // Keep opacity in sync without rebuilding the layer
    useEffect(() => {
        const canvasEl = (layerRef.current as any)?._canvas as HTMLCanvasElement | undefined;
        if (canvasEl) canvasEl.style.opacity = String(opacity);
    }, [opacity]);

    // Recompute pixel radius whenever the user zooms
    useMapEvents({ zoomend: applyRadius });

    return null;
};

export default HeatmapLayer;
