import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
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
    radius?: number;
    blur?: number;
    /** The intensity value that maps to full color. Default 1.0. */
    max?: number;
    minOpacity?: number;
    gradient?: Record<number, string>;
    /**
     * The zoom level at which points reach maximum intensity.
     * Set this to the map's minZoom so intensity stays at full strength
     * at every reachable zoom level (no fade-out when zooming out).
     */
    maxZoom?: number;
}

const HeatmapLayer: React.FC<HeatmapLayerProps> = ({
    points,
    visible,
    radius = 35,
    blur = 25,
    max = 1.0,
    minOpacity = 0.25,
    gradient,
    maxZoom = 15,
}) => {
    const map = useMap();
    const layerRef = useRef<L.HeatLayer | null>(null);

    useEffect(() => {
        // Tear down the previous layer before creating a new one
        if (layerRef.current) {
            map.removeLayer(layerRef.current);
            layerRef.current = null;
        }

        if (!visible || points.length === 0) return;

        const layer = L.heatLayer(points, { radius, blur, max, minOpacity, gradient, maxZoom });
        layer.addTo(map);
        layerRef.current = layer;

        return () => {
            if (layerRef.current) {
                map.removeLayer(layerRef.current);
                layerRef.current = null;
            }
        };
        // gradient is expected to be a module-level constant (stable ref).
        // Points and primitives drive recreation.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [map, points, visible, radius, blur, max, minOpacity, gradient, maxZoom]);

    return null;
};

export default HeatmapLayer;
