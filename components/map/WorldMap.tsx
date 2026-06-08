'use client';
import { useEffect, useRef, useState } from 'react';

const MAP_FILTERS = [
  { id: 'all', label: 'All Jobs' },
  { id: 'new_only', label: 'New Jobs' },
  { id: 'overseas_only', label: 'Overseas' },
  { id: 'remote', label: 'Remote' },
  { id: 'medical', label: 'Medical' },
  { id: 'security', label: 'Security/Defense' },
];

export default function WorldMap({ entityId, portalId }: { entityId?: string; portalId?: string }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const [filter, setFilter] = useState('all');
  const [heatmap, setHeatmap] = useState(false);
  const [mapData, setMapData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Fetch map data
  useEffect(() => {
    if (!entityId && !portalId) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (entityId) params.set('entity_id', entityId);
    if (portalId) params.set('portal', portalId);
    if (filter === 'new_only') params.set('new_only', 'true');
    if (filter === 'overseas_only') params.set('overseas_only', 'true');
    if (filter === 'security') params.set('role_category', 'security');
    if (filter === 'medical') params.set('role_category', 'medical');

    fetch(`/api/map?${params}`)
      .then(r => r.json())
      .then(d => { setMapData(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [entityId, portalId, filter]);

  // Initialize Leaflet map
  useEffect(() => {
    if (!mounted || !mapRef.current || mapInstance.current) return;

    import('leaflet').then(L => {
      const map = L.map(mapRef.current!, {
        center: [20, 0],
        zoom: 2,
        zoomControl: false,
      });

      // Dark glass-style tiles
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB',
        maxZoom: 19,
      }).addTo(map);

      L.control.zoom({ position: 'bottomright' }).addTo(map);
      mapInstance.current = map;
    });

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [mounted]);

  // Update markers
  useEffect(() => {
    if (!mapInstance.current || !mounted) return;
    import('leaflet').then(L => {
      // Clear existing layers
      mapInstance.current.eachLayer((layer: any) => {
        if (layer instanceof L.CircleMarker || layer instanceof L.Marker) {
          mapInstance.current.removeLayer(layer);
        }
      });

      mapData.forEach((point: any) => {
        if (!point.lat || !point.lng) return;
        const count = Number(point.cnt || 1);
        const radius = Math.min(5 + Math.log(count + 1) * 4, 30);

        // Color by intensity
        const color = count > 50 ? '#ef4444' : count > 20 ? '#f97316' : count > 5 ? '#3b82f6' : '#64748b';

        L.circleMarker([Number(point.lat), Number(point.lng)], {
          radius,
          fillColor: color,
          color: 'rgba(255,255,255,0.3)',
          weight: 1,
          opacity: 1,
          fillOpacity: heatmap ? 0.4 : 0.7,
        })
          .bindPopup(`
            <div style="font-family:sans-serif;font-size:12px;min-width:150px">
              <strong>${point.city || ''}, ${point.state || ''} ${point.country || ''}</strong><br/>
              <span style="color:#60a5fa">${count} open job${count !== 1 ? 's' : ''}</span>
              ${point.entity_name ? `<br/><span style="color:#94a3b8">${point.entity_name}</span>` : ''}
            </div>
          `)
          .addTo(mapInstance.current);
      });
    });
  }, [mapData, heatmap, mounted]);

  return (
    <div className="glass-card p-4 flex flex-col gap-3">
      {/* Header + controls */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-slate-200">World Hiring Map</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setHeatmap(!heatmap)}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
              heatmap
                ? 'bg-orange-500/20 border-orange-500/40 text-orange-300'
                : 'bg-white/5 border-white/15 text-slate-400 hover:border-white/25'
            }`}
          >
            Heatmap
          </button>
          <span className="text-xs text-slate-600">{mapData.length} locations</span>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex gap-1.5 flex-wrap">
        {MAP_FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`text-[10px] px-2.5 py-1 rounded-full border transition-all ${
              filter === f.id
                ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                : 'bg-white/5 border-white/10 text-slate-500 hover:text-slate-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Map */}
      <div className="relative rounded-xl overflow-hidden" style={{ height: 340 }}>
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {mounted ? (
          <div ref={mapRef} className="w-full h-full" />
        ) : (
          <div className="w-full h-full bg-white/5 animate-pulse rounded-xl" />
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-slate-500">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
          <span>High hiring (50+)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-orange-500" />
          <span>Medium (20–50)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
          <span>Active (5–20)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-slate-500" />
          <span>Low (&lt;5)</span>
        </div>
      </div>
    </div>
  );
}
