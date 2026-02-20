import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Polygon, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';


const FitBounds = ({ surveys }) => {
    const map = useMap();
    useEffect(() => {
        if (!surveys || surveys.length === 0) return;

        let bounds = new L.LatLngBounds();
        let valid = false;

        surveys.forEach(s => {
            if (s.bounds && s.bounds.min_lat) {
                // Bounds from backend: min_lat, max_lat, min_lon, max_lon
                // Leaflet bounds: corner1 (lat1, lon1), corner2 (lat2, lon2)
                const p1 = [s.bounds.min_lat, s.bounds.min_lon];
                const p2 = [s.bounds.max_lat, s.bounds.max_lon];
                bounds.extend(p1);
                bounds.extend(p2);
                valid = true;
            }
        });

        if (valid) {
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    }, [surveys, map]);
    return null;
}

const ColonyMap = ({ surveys }) => {
    // surveys prop should be the filtered list of surveys we want to display coverage for
    // Center of Boeung Sne default
    const defaultCenter = [11.407590, 105.395620];

    return (
        <MapContainer
            center={defaultCenter}
            zoom={14}
            style={{ height: "100%", width: "100%" }}
            className="rounded-xl z-0"
            attributionControl={false}
        >
            <TileLayer
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            />

            {/* Auto fit bounds based on displayed surveys */}
            <FitBounds surveys={surveys} />

            {surveys.map(s => {
                if (!s.bounds || !s.bounds.min_lat) return null;

                // Construct Rectangle: [[lat1, lon1], [lat2, lon2]]
                // min_lat (South), min_lon (West) -> max_lat (North), max_lon (East)
                // Rectangle takes [ [lat1, lon1], [lat2, lon2] ]

                const bounds = [
                    [s.bounds.min_lat, s.bounds.min_lon],
                    [s.bounds.max_lat, s.bounds.max_lon]
                ];

                return (
                    <Polygon
                        key={s.id}
                        positions={[
                            [s.bounds.min_lat, s.bounds.min_lon], // SW
                            [s.bounds.max_lat, s.bounds.min_lon], // NW
                            [s.bounds.max_lat, s.bounds.max_lon], // NE
                            [s.bounds.min_lat, s.bounds.max_lon], // SE
                        ]}
                        pathOptions={{
                            color: '#F2994A',
                            fillColor: '#F2994A',
                            fillOpacity: 0.2,
                            weight: 2
                        }}
                    >
                        <Popup>
                            <div className="text-sm">
                                <strong className="block text-slate-800">{s.name}</strong>
                                <span className="text-slate-500 text-xs">{new Date(s.date).toLocaleDateString()}</span>
                            </div>
                        </Popup>
                    </Polygon>
                );
            })}

        </MapContainer>
    );
};

export default ColonyMap;
