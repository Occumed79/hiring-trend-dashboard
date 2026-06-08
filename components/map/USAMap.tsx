'use client';
import { useEffect, useRef, useState } from 'react';

const USA_BOUNDS: [[number, number], [number, number]] = [[24.396308, -125.0], [49.384358, -66.93457]];
const USA_CENTER: [number, number] = [38.5, -96.5];

const MAP_FILTERS = [
  { id: 'all', label: 'All Jobs' },
  { id: 'new_only', label: 'New Jobs' },
  { id: 'remote', label: 'Remote' },
  { id: 'security', label: 'Security/Defense' },
  { id: 'medical', label: 'Medical' },
  { id: 'logistics', label: 'Logistics' },
];

export default function USAMap({
  entityId,
  portalId,
  title = 'USA Hiring Map',
}: {
  entityId?: string;
  portalId?: string;
  title?: string;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const [filter, setFilter] = useState('all');
  const [mapData, setMapData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Fetch map data (USA only)
  useEffect(() => {
    if (!entityId && !portalId) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (entityId) params.set('entity_id', entityId);
    if (portalId) params.set('portal', portalId);
    params.set('country', 'US');
    if (filter === 'new_only') params.set('new_only', 'true');
    if (filter === 'remote') params.set('role_category', 'remote');
    if (filter === 'security') params.set('role_category', 'security');
    if (filter === 'medical') params.set('role_category', 'medical');
    if (filter === 'logistics') params.set('role_category', 'logistics');

    fetch(`/api/map?${params}`)
      .then(r => r.json())
      .then(d => { setMapData(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [entityId, portalId, filter]);

  // Init Leaflet — USA bounds locked
  useEffect(() => {
    if (!mounted || !mapRef.current || mapInstance.current) return;

    import('leaflet').then(L => {
      const map = L.map(mapRef.current!, {
        center: USA_CENTER,
        zoom: 4,
        minZoom: 3,
        maxZoom: 13,
        zoomControl: false,
        maxBounds: [[15, -170], [72, -50]], // allow Alaska/Hawaii with some padding
        maxBoundsViscosity: 0.8,
      });

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
      mapInstance.current.eachLayer((layer: any) => {
        if (layer instanceof L.CircleMarker) mapInstance.current.removeLayer(layer);
      });

      mapData.forEach((point: any) => {
        const lat = Number(point.lat);
        const lng = Number(point.lng);
        if (!lat || !lng) return;
        // Only render US points
        if (lat < 15 || lat > 72 || lng < -180 || lng > -50) return;

        const count = Number(point.cnt || 1);
        const radius = Math.min(5 + Math.log(count + 1) * 4, 28);
        const color = count > 50 ? '#ef4444' : count > 20 ? '#f97316' : count > 5 ? '#3b82f6' : '#64748b';

        L.circleMarker([lat, lng], {
          radius,
          fillColor: color,
          color: 'rgba(255,255,255,0.25)',
          weight: 1,
          opacity: 1,
          fillOpacity: 0.72,
        })
          .bindPopup(`
            <div style="font-family:sans-serif;font-size:12px;min-width:160px">
              <strong>${[point.city, point.state].filter(Boolean).join(', ') || 'Unknown Location'}</strong><br/>
              <span style="color:#60a5fa">${count} open job${count !== 1 ? 's' : ''}</span>
              ${point.role_category ? `<br/><span style="color:#94a3b8;text-transform:capitalize">${point.role_category}</span>` : ''}
              ${point.entity_name ? `<br/><span style="color:#94a3b8">${point.entity_name}</span>` : ''}
            </div>
          `)
          .addTo(mapInstance.current);
      });
    });
  }, [mapData, mounted]);

  return (
    <div className="glass-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
          <p className="text-[10px] text-slate-500 mt-0.5">United States only</p>
        </div>
        <span className="text-xs text-slate-600">{mapData.length} locations</span>
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
        {[
          { color: 'bg-red-500', label: 'High (50+)' },
          { color: 'bg-orange-500', label: 'Medium (20–50)' },
          { color: 'bg-blue-500', label: 'Active (5–20)' },
          { color: 'bg-slate-500', label: 'Low (<5)' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
