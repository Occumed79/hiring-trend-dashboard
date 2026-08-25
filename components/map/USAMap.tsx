'use client';
import { useEffect, useRef, useState } from 'react';
import { useHiringBasemap } from './useHiringBasemap';
import { getFallbackHiringBasemap } from './maptilerBasemap';

const MAP_FILTERS = [
  { id: 'all', label: 'All Jobs' },
  { id: 'new_only', label: 'New' },
  { id: 'engineering', label: 'Engineering' },
  { id: 'security', label: 'Security' },
  { id: 'medical', label: 'Medical' },
  { id: 'logistics', label: 'Logistics' },
];

type MapMeta = {
  total_jobs?: number;
  mapped_jobs?: number;
  real_mapped_jobs?: number;
  unmapped_jobs?: number;
  point_count?: number;
  location_count?: number;
};

export default function USAMap({ entityId, portalId, title = 'USA Hiring Map' }: { entityId?: string; portalId?: string; title?: string }) {
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
      if (mounted) setMapComponents({ L, ...RL });
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
    if (!entityId && !portalId) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    const params = new URLSearchParams();
    if (entityId) params.set('entity_id', entityId);
    if (portalId) params.set('portal', portalId);
    params.set('country', 'US');
    params.set('include_meta', 'true');
    params.set('include_fallback', 'false');
    if (filter === 'new_only') params.set('new_only', 'true');
    if (['engineering', 'security', 'medical', 'logistics'].includes(filter)) params.set('role_category', filter);

    fetch(`/api/map?${params}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const body = await response.json().catch(() => []);
        if (!response.ok) throw new Error(body?.error || 'Could not load map data.');
        return body;
      })
      .then(body => {
        if (Array.isArray(body)) { setMapData(body); setMapMeta(null); }
        else { setMapData(Array.isArray(body?.locations) ? body.locations : []); setMapMeta(body?.meta || null); }
      })
      .catch(err => {
        if (err?.name === 'AbortError') return;
        setMapData([]); setMapMeta(null); setError(err instanceof Error ? err.message : 'Could not load map data.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [entityId, portalId, filter]);

  const mapped = mapMeta?.real_mapped_jobs ?? mapMeta?.mapped_jobs ?? mapData.length;
  const totalJobs = mapMeta?.total_jobs ?? 0;

  return (
    <div className={`map-glass-card h-full flex flex-col gap-3.5 ${profileMode ? 'min-h-[650px]' : 'min-h-[540px]'}`}>
      <div className="flex items-start justify-between flex-wrap gap-3 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[15px] font-semibold text-slate-100 tracking-tight">{title}</h3>
            <span className="map-provider-badge">{ACTIVE_BASEMAP.provider === 'maptiler' ? `MapTiler · ${ACTIVE_BASEMAP.styleLabel}` : ACTIVE_BASEMAP.styleLabel}</span>
          </div>
          <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">United States · {mapped.toLocaleString()} individual job points{totalJobs ? ` · ${totalJobs.toLocaleString()} open roles checked` : ''}{mapMeta?.unmapped_jobs ? ` · ${mapMeta.unmapped_jobs.toLocaleString()} need city-level coordinates` : ''}</p>
        </div>
        <div className="flex gap-1.5 flex-wrap justify-end">
          {MAP_FILTERS.map(item => <button key={item.id} onClick={() => setFilter(item.id)} className={`text-[11px] px-2.5 py-1.5 rounded-full border transition-all ${filter === item.id ? 'bg-violet-500/20 border-violet-400/45 text-violet-100' : 'bg-white/5 border-white/10 text-slate-500 hover:text-slate-300 hover:border-white/20'}`}>{item.label}</button>)}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-100 shrink-0">{error}</div>}
      {tileFailed && <div className="rounded-xl border border-amber-400/15 bg-amber-500/[0.04] px-3 py-2 text-[10px] text-amber-100/70 shrink-0">MapTiler tiles could not be reached, so the map temporarily switched to its fallback basemap.</div>}

      <div ref={mapShellRef} className="relative map-container flex-1" style={{ minHeight: profileMode ? 540 : 440 }}>
        {loading && <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-black/30 backdrop-blur-[1px] rounded-xl"><div className="w-5 h-5 border-2 border-violet-300 border-t-transparent rounded-full animate-spin" /></div>}
        {!MapComponents ? <div className="w-full h-full bg-[#1b1d22] rounded-xl animate-pulse" /> : (
          <MapComponents.MapContainer
            ref={mapRef}
            center={[38.5, -96.5]}
            zoom={4}
            zoomSnap={0.25}
            zoomDelta={0.5}
            minZoom={3}
            maxZoom={13}
            maxBounds={[[15, -170], [72, -50]]}
            maxBoundsViscosity={0.65}
            preferCanvas={true}
            scrollWheelZoom={true}
            doubleClickZoom={true}
            style={{ height: '100%', width: '100%', borderRadius: '12px', background: '#1b1d22' }}
            zoomControl={false}
            attributionControl={true}
            whenReady={() => { window.setTimeout(() => mapRef.current?.invalidateSize?.({ animate: false }), 60); }}
          >
            <MapComponents.TileLayer
              key={ACTIVE_BASEMAP.url}
              url={ACTIVE_BASEMAP.url}
              attribution={ACTIVE_BASEMAP.attribution}
              minZoom={Math.max(3, ACTIVE_BASEMAP.minZoom || 1)}
              maxZoom={Math.min(13, ACTIVE_BASEMAP.maxZoom)}
              eventHandlers={{ tileerror: () => { if (ACTIVE_BASEMAP.provider === 'maptiler') setTileFailed(true); } }}
              {...(ACTIVE_BASEMAP.tileSize ? { tileSize: ACTIVE_BASEMAP.tileSize } : {})}
              {...(ACTIVE_BASEMAP.zoomOffset !== undefined ? { zoomOffset: ACTIVE_BASEMAP.zoomOffset } : {})}
            />
            <MapComponents.ZoomControl position="bottomright" />
            {mapData.map((point: any, index: number) => {
              const lat = Number(point.lat); const lng = Number(point.lng);
              if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 15 || lat > 72 || lng < -180 || lng > -50) return null;
              return (
                <MapComponents.CircleMarker
                  key={point.job_id || `${point.entity_name || ''}-${point.city || ''}-${index}`}
                  center={[lat, lng]}
                  radius={2.7}
                  pathOptions={{ color: '#c084fc', weight: 0.65, fillColor: '#9333ea', fillOpacity: 0.9, opacity: 0.9 }}
                >
                  <MapComponents.Popup><div style={{ fontFamily: 'sans-serif', fontSize: 12, minWidth: 200 }}><strong>{point.title || 'Open role'}</strong><br /><span style={{ color: '#7c3aed' }}>{[point.city, point.state].filter(Boolean).join(', ') || point.location || 'Location unavailable'}</span>{point.entity_name && <><br /><span style={{ color: '#64748b' }}>{point.entity_name}</span></>}</div></MapComponents.Popup>
                </MapComponents.CircleMarker>
              );
            })}
          </MapComponents.MapContainer>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 text-[10px] text-slate-500 flex-wrap shrink-0"><span>One small violet point per mapped job; no count-sized bubbles or clusters.</span><span className="text-[9px] text-slate-600">MapTiler-style interactive zoom and drag.</span></div>
    </div>
  );
}
