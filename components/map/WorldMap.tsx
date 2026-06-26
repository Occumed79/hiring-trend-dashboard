'use client';
import { useEffect, useState } from 'react';

const MAP_FILTERS = [
  { id: 'all', label: 'All Jobs' },
  { id: 'new_only', label: 'New' },
  { id: 'overseas_only', label: 'Overseas' },
  { id: 'remote', label: 'Remote' },
  { id: 'medical', label: 'Medical' },
  { id: 'security', label: 'Security' },
];

export default function WorldMap({ entityId, portalId }: { entityId?: string; portalId?: string }) {
  const [filter, setFilter] = useState('all');
  const [mapData, setMapData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [MapComponents, setMapComponents] = useState<any>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      import('leaflet'),
      import('react-leaflet'),
    ]).then(([L, RL]) => {
      if (!mounted) return;
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });
      setMapComponents({ L, ...RL });
    }).catch(() => {
      if (mounted) setError('Map assets could not load.');
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!entityId && !portalId) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (entityId) params.set('entity_id', entityId);
    if (portalId) params.set('portal', portalId);
    if (filter === 'new_only') params.set('new_only', 'true');
    if (filter === 'overseas_only') params.set('overseas_only', 'true');
    if (['security', 'medical', 'remote'].includes(filter)) params.set('role_category', filter);

    fetch(`/api/map?${params}`, { signal: controller.signal })
      .then(async r => {
        const data = await r.json().catch(() => []);
        if (!r.ok) throw new Error(data?.error || 'Could not load map data.');
        return data;
      })
      .then(d => setMapData(Array.isArray(d) ? d : []))
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setMapData([]);
        setError(err instanceof Error ? err.message : 'Could not load map data.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [entityId, portalId, filter]);

  return (
    <div className="map-glass-card flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-100 tracking-wide">World Hiring Map</h3>
          <p className="text-[10px] text-slate-500 mt-0.5">{mapData.length} locations tracked</p>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {MAP_FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`text-[10px] px-2.5 py-1 rounded-full border transition-all ${
                filter === f.id
                  ? 'bg-blue-500/25 border-blue-400/50 text-blue-300'
                  : 'bg-white/5 border-white/10 text-slate-500 hover:text-slate-300 hover:border-white/20'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-100">{error}</div>}

      <div className="relative map-container">
        {loading && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-black/40 backdrop-blur-sm rounded-xl">
            <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!MapComponents ? (
          <div className="w-full h-full bg-[#080d1a] rounded-xl animate-pulse" />
        ) : (
          <MapComponents.MapContainer
            center={[20, 0]}
            zoom={2}
            style={{ height: '100%', width: '100%', borderRadius: '12px', background: '#080d1a' }}
            zoomControl={false}
            attributionControl={false}
          >
            <MapComponents.TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution="© CartoDB"
              maxZoom={19}
            />
            <MapComponents.ZoomControl position="bottomright" />
            {mapData.map((point: any, i: number) => {
              const lat = Number(point.lat);
              const lng = Number(point.lng);
              if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
              const count = Number(point.cnt || 1);
              const radius = Math.min(5 + Math.log(count + 1) * 4, 28);
              const color = count > 50 ? '#ef4444' : count > 20 ? '#f97316' : count > 5 ? '#3b82f6' : '#64748b';
              return (
                <MapComponents.CircleMarker
                  key={`${lat}-${lng}-${i}`}
                  center={[lat, lng]}
                  radius={radius}
                  pathOptions={{ fillColor: color, color: 'rgba(255,255,255,0.25)', weight: 1, fillOpacity: 0.72 }}
                >
                  <MapComponents.Popup>
                    <div style={{ fontFamily: 'sans-serif', fontSize: 12, minWidth: 150 }}>
                      <strong>{[point.city, point.state, point.country].filter(Boolean).join(', ') || 'Unknown'}</strong><br />
                      <span style={{ color: '#60a5fa' }}>{count} open job{count !== 1 ? 's' : ''}</span>
                      {point.entity_name && <><br /><span style={{ color: '#94a3b8' }}>{point.entity_name}</span></>}
                    </div>
                  </MapComponents.Popup>
                </MapComponents.CircleMarker>
              );
            })}
          </MapComponents.MapContainer>
        )}
      </div>

      <div className="flex items-center gap-4 text-[10px] text-slate-500 flex-wrap">
        {[["#ef4444",'High (50+)'],["#f97316",'Medium (20–50)'],["#3b82f6",'Active (5–20)'],["#64748b",'Low (<5)']].map(([c,l]) => (
          <div key={l} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: c }} />
            <span>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
