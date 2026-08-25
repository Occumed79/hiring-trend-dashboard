'use client';
import { useEffect, useRef, useState } from 'react';
import { useHiringBasemap } from './useHiringBasemap';
import { getFallbackHiringBasemap } from './arcgisBasemap';

const MAP_FILTERS = [
  { id: 'all', label: 'All Jobs' },
  { id: 'new_only', label: 'New' },
  { id: 'overseas_only', label: 'Overseas' },
  { id: 'remote', label: 'Remote' },
  { id: 'medical', label: 'Medical' },
  { id: 'security', label: 'Security' },
];

type MapMeta = {
  total_jobs?: number;
  mapped_jobs?: number;
  real_mapped_jobs?: number;
  unmapped_jobs?: number;
  fallback_jobs?: number;
  location_count?: number;
  map_precision?: string;
};

export default function WorldMap({ entityId, portalId }: { entityId?: string; portalId?: string }) {
  const [filter, setFilter] = useState('all');
  const [mapData, setMapData] = useState<any[]>([]);
  const [mapMeta, setMapMeta] = useState<MapMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [MapComponents, setMapComponents] = useState<any>(null);
  const [tileFailed, setTileFailed] = useState(false);
  const mapRef = useRef<any>(null);
  const mapShellRef = useRef<HTMLDivElement | null>(null);
  const BASEMAP = useHiringBasemap();
  const ACTIVE_BASEMAP = tileFailed ? getFallbackHiringBasemap(BASEMAP.styleId) : BASEMAP;
  const profileMode = Boolean(entityId);

  useEffect(() => { setTileFailed(false); }, [BASEMAP.url]);

  useEffect(() => {
    let mounted = true;
    Promise.all([import('leaflet'), import('react-leaflet')]).then(([L, RL]) => {
      if (!mounted) return;
      setMapComponents({ L, ...RL });
    }).catch(() => { if (mounted) setError('Map assets could not load.'); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!mapShellRef.current || !MapComponents || typeof ResizeObserver === 'undefined') return;
    const invalidate = () => window.requestAnimationFrame(() => mapRef.current?.invalidateSize?.({ animate: false }));
    const observer = new ResizeObserver(invalidate);
    observer.observe(mapShellRef.current);
    const timers = [0, 120, 420].map(delay => window.setTimeout(invalidate, delay));
    return () => { observer.disconnect(); timers.forEach(timer => window.clearTimeout(timer)); };
  }, [MapComponents, mapData.length]);

  useEffect(() => {
    if (!MapComponents) return;
    const frame = window.requestAnimationFrame(() => mapRef.current?.attributionControl?.setPrefix?.(false));
    return () => window.cancelAnimationFrame(frame);
  }, [MapComponents]);

  useEffect(() => {
    if (!entityId || !MapComponents?.L || mapData.length === 0) return;
    const points = mapData
      .map((point: any) => [Number(point.lat), Number(point.lng)] as [number, number])
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
    if (!points.length) return;
    const frame = window.requestAnimationFrame(() => {
      const map = mapRef.current;
      if (!map) return;
      map.invalidateSize?.({ animate: false });
      if (points.length === 1) map.setView(points[0], 5, { animate: false });
      else map.fitBounds(MapComponents.L.latLngBounds(points).pad(0.18), { animate: false, maxZoom: 5, padding: [44, 44] });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [entityId, mapData, MapComponents]);

  useEffect(() => {
    if (!entityId && !portalId) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (entityId) params.set('entity_id', entityId);
    if (portalId) params.set('portal', portalId);
    params.set('include_meta', 'true');
    params.set('include_fallback', 'false');
    if (filter === 'new_only') params.set('new_only', 'true');
    if (filter === 'overseas_only') params.set('overseas_only', 'true');
    if (filter === 'remote') params.set('remote_only', 'true');
    if (['security', 'medical'].includes(filter)) params.set('role_category', filter);

    fetch(`/api/map?${params}`, { signal: controller.signal, cache: 'no-store' })
      .then(async r => { const data = await r.json().catch(() => []); if (!r.ok) throw new Error(data?.error || 'Could not load map data.'); return data; })
      .then(d => {
        if (Array.isArray(d)) { setMapData(d); setMapMeta(null); }
        else { setMapData(Array.isArray(d?.locations) ? d.locations : []); setMapMeta(d?.meta || null); }
      })
      .catch((err) => { if (err?.name === 'AbortError') return; setMapData([]); setMapMeta(null); setError(err instanceof Error ? err.message : 'Could not load map data.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [entityId, portalId, filter]);

  const realMapped = mapMeta?.real_mapped_jobs ?? mapMeta?.mapped_jobs ?? 0;
  const totalJobs = mapMeta?.total_jobs ?? 0;

  return (
    <div className={`map-glass-card h-full flex flex-col gap-3.5 ${profileMode ? 'min-h-[980px]' : 'min-h-[640px]'}`}>
      <div className="flex items-start justify-between flex-wrap gap-3 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[15px] font-semibold text-slate-100 tracking-tight">World Hiring Map</h3>
            <span className="map-provider-badge">{ACTIVE_BASEMAP.provider === 'arcgis' ? ACTIVE_BASEMAP.styleLabel : 'Streets fallback'}</span>
          </div>
          <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
            {mapData.length} cities shown{mapMeta ? ` · ${realMapped}/${totalJobs} jobs resolved to a city` : ''}
            {mapMeta?.unmapped_jobs ? ` · ${mapMeta.unmapped_jobs} not city-resolved` : ''}
          </p>
        </div>
        <div className="flex gap-1.5 flex-wrap justify-end">
          {MAP_FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} className={`text-[11px] px-2.5 py-1.5 rounded-full border transition-all ${filter === f.id ? 'bg-blue-500/25 border-blue-400/50 text-blue-200' : 'bg-white/5 border-white/10 text-slate-500 hover:text-slate-300 hover:border-white/20'}`}>{f.label}</button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-100 shrink-0">{error}</div>}
      {tileFailed && <div className="rounded-xl border border-amber-400/15 bg-amber-500/[0.04] px-3 py-2 text-[10px] text-amber-100/70 shrink-0">ArcGIS tiles did not load, so the map switched to the clean Streets fallback automatically.</div>}

      <div ref={mapShellRef} className="relative map-container flex-1" style={{ minHeight: profileMode ? '82vh' : 540 }}>
        {loading && <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-black/25 backdrop-blur-[1px] rounded-xl"><div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" /></div>}
        {!MapComponents ? <div className="w-full h-full bg-[#eef3f7] rounded-xl animate-pulse" /> : (
          <MapComponents.MapContainer
            ref={mapRef}
            center={[20, 0]}
            zoom={2}
            preferCanvas={true}
            scrollWheelZoom={false}
            doubleClickZoom={false}
            zoomControl={false}
            attributionControl={true}
            style={{ height: '100%', width: '100%', borderRadius: '12px', background: '#eef3f7' }}
            whenReady={() => { window.setTimeout(() => mapRef.current?.invalidateSize?.({ animate: false }), 60); }}
          >
            <MapComponents.TileLayer
              key={ACTIVE_BASEMAP.url}
              url={ACTIVE_BASEMAP.url}
              attribution={ACTIVE_BASEMAP.attribution}
              maxZoom={ACTIVE_BASEMAP.maxZoom}
              eventHandlers={{ tileerror: () => { if (ACTIVE_BASEMAP.provider === 'arcgis') setTileFailed(true); } }}
              {...(ACTIVE_BASEMAP.tileSize ? { tileSize: ACTIVE_BASEMAP.tileSize } : {})}
              {...(ACTIVE_BASEMAP.zoomOffset !== undefined ? { zoomOffset: ACTIVE_BASEMAP.zoomOffset } : {})}
            />
            <MapComponents.ZoomControl position="bottomright" />
            {mapData.map((point: any, i: number) => {
              const lat = Number(point.lat); const lng = Number(point.lng);
              if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
              const count = Math.max(1, Number(point.cnt || 1));
              return (
                <MapComponents.CircleMarker
                  key={`${point.entity_name || ''}-${point.city || ''}-${point.state || ''}-${point.country || ''}-${i}`}
                  center={[lat, lng]}
                  radius={3.25}
                  pathOptions={{ color: '#eff6ff', weight: 1, fillColor: '#2563eb', fillOpacity: 0.96, opacity: 0.96 }}
                >
                  <MapComponents.Popup><div style={{ fontFamily: 'sans-serif', fontSize: 12, minWidth: 190 }}><strong>{[point.city, point.state, point.country].filter(Boolean).join(', ') || 'Unknown city'}</strong><br /><span style={{ color: '#2563eb' }}>{count} open job{count !== 1 ? 's' : ''}</span>{point.entity_name && <><br /><span style={{ color: '#64748b' }}>{point.entity_name}</span></>}</div></MapComponents.Popup>
                </MapComponents.CircleMarker>
              );
            })}
          </MapComponents.MapContainer>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 text-[10px] text-slate-500 flex-wrap shrink-0">
        <span>Each blue point is one resolved city. No clustering, volume bubbles, headquarters points, or state-centroid fallback markers.</span>
        <span className="text-[9px] text-slate-600">{ACTIVE_BASEMAP.provider === 'arcgis' ? `ArcGIS ${ACTIVE_BASEMAP.styleLabel}` : ACTIVE_BASEMAP.styleLabel}</span>
      </div>
    </div>
  );
}
