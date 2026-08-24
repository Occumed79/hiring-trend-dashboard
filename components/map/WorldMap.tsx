'use client';
import { useEffect, useRef, useState } from 'react';
import { useHiringBasemap } from './useHiringBasemap';
import { createHiringMarkerIcon } from './hiringMarker';

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
};

export default function WorldMap({ entityId, portalId }: { entityId?: string; portalId?: string }) {
  const [filter, setFilter] = useState('all');
  const [mapData, setMapData] = useState<any[]>([]);
  const [mapMeta, setMapMeta] = useState<MapMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [MapComponents, setMapComponents] = useState<any>(null);
  const mapRef = useRef<any>(null);
  const mapShellRef = useRef<HTMLDivElement | null>(null);
  const BASEMAP = useHiringBasemap();
  const profileMode = Boolean(entityId);

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
    if (!mapShellRef.current || !MapComponents || typeof ResizeObserver === 'undefined') return;
    const invalidate = () => {
      window.requestAnimationFrame(() => mapRef.current?.invalidateSize?.({ animate: false }));
    };
    const observer = new ResizeObserver(invalidate);
    observer.observe(mapShellRef.current);
    invalidate();
    return () => observer.disconnect();
  }, [MapComponents]);

  useEffect(() => {
    if (!MapComponents) return;
    const frame = window.requestAnimationFrame(() => {
      mapRef.current?.attributionControl?.setPrefix?.(false);
    });
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
      if (points.length === 1) {
        map.setView(points[0], 6, { animate: false });
        return;
      }
      const bounds = MapComponents.L.latLngBounds(points).pad(0.14);
      map.fitBounds(bounds, { animate: false, maxZoom: 7, padding: [36, 36] });
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
    if (filter === 'new_only') params.set('new_only', 'true');
    if (filter === 'overseas_only') params.set('overseas_only', 'true');
    if (['security', 'medical', 'remote'].includes(filter)) params.set('role_category', filter);

    fetch(`/api/map?${params}`, { signal: controller.signal, cache: 'no-store' })
      .then(async r => {
        const data = await r.json().catch(() => []);
        if (!r.ok) throw new Error(data?.error || 'Could not load map data.');
        return data;
      })
      .then(d => {
        if (Array.isArray(d)) {
          setMapData(d);
          setMapMeta(null);
        } else {
          setMapData(Array.isArray(d?.locations) ? d.locations : []);
          setMapMeta(d?.meta || null);
        }
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setMapData([]);
        setMapMeta(null);
        setError(err instanceof Error ? err.message : 'Could not load map data.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [entityId, portalId, filter]);

  const realMapped = mapMeta?.real_mapped_jobs ?? mapMeta?.mapped_jobs ?? 0;
  const totalJobs = mapMeta?.total_jobs ?? 0;

  return (
    <div className={`map-glass-card h-full flex flex-col gap-3.5 ${profileMode ? 'min-h-[720px]' : 'min-h-[520px]'}`}>
      <div className="flex items-start justify-between flex-wrap gap-3 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[15px] font-semibold text-slate-100 tracking-tight">World Hiring Map</h3>
            {BASEMAP.provider === 'arcgis' && <span className="map-provider-badge">ArcGIS</span>}
          </div>
          <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
            {mapData.length} locations tracked
            {mapMeta ? ` · ${realMapped}/${totalJobs} real job locations` : ''}
            {mapMeta?.fallback_jobs ? ` · ${mapMeta.fallback_jobs} fallback only` : ''}
            {mapMeta?.unmapped_jobs ? ` · ${mapMeta.unmapped_jobs} unmapped` : ''}
          </p>
        </div>
        <div className="flex gap-1.5 flex-wrap justify-end">
          {MAP_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`text-[11px] px-2.5 py-1.5 rounded-full border transition-all ${
                filter === f.id
                  ? 'bg-blue-500/25 border-blue-400/50 text-blue-200'
                  : 'bg-white/5 border-white/10 text-slate-500 hover:text-slate-300 hover:border-white/20'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-100 shrink-0">{error}</div>}

      <div ref={mapShellRef} className="relative map-container flex-1" style={{ minHeight: profileMode ? 610 : 420 }}>
        {loading && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-black/40 backdrop-blur-sm rounded-xl">
            <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!MapComponents ? (
          <div className="w-full h-full bg-[#080d1a] rounded-xl animate-pulse" />
        ) : (
          <MapComponents.MapContainer
            ref={mapRef}
            center={[20, 0]}
            zoom={2}
            style={{ height: '100%', width: '100%', borderRadius: '12px', background: '#080d1a' }}
            zoomControl={false}
            attributionControl={true}
          >
            <MapComponents.TileLayer
              key={BASEMAP.url}
              url={BASEMAP.url}
              attribution={BASEMAP.attribution}
              maxZoom={BASEMAP.maxZoom}
              {...(BASEMAP.tileSize ? { tileSize: BASEMAP.tileSize } : {})}
              {...(BASEMAP.zoomOffset !== undefined ? { zoomOffset: BASEMAP.zoomOffset } : {})}
            />
            <MapComponents.ZoomControl position="bottomright" />
            {mapData.map((point: any, i: number) => {
              const lat = Number(point.lat);
              const lng = Number(point.lng);
              if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
              const count = Math.max(1, Number(point.cnt || 1));
              return (
                <MapComponents.Marker
                  key={`${lat}-${lng}-${i}`}
                  position={[lat, lng]}
                  icon={createHiringMarkerIcon(MapComponents.L, count, Boolean(point.is_fallback))}
                >
                  <MapComponents.Popup>
                    <div style={{ fontFamily: 'sans-serif', fontSize: 12, minWidth: 190 }}>
                      <strong>{[point.city, point.state, point.country].filter(Boolean).join(', ') || 'Unknown location'}</strong><br />
                      <span style={{ color: '#7dd3fc' }}>{count} open job{count !== 1 ? 's' : ''}</span>
                      {point.entity_name && <><br /><span style={{ color: '#94a3b8' }}>{point.entity_name}</span></>}
                      {point.location_quality && <><br /><span style={{ color: point.is_fallback ? '#cbd5e1' : '#64748b' }}>{point.location_quality}</span></>}
                    </div>
                  </MapComponents.Popup>
                </MapComponents.Marker>
              );
            })}
          </MapComponents.MapContainer>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 text-[10px] text-slate-500 flex-wrap shrink-0">
        <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
          {[
            ['#7dd3fc', 'Major hub (50+)'],
            ['#60a5fa', 'Growing hub (20–49)'],
            ['#3b82f6', 'Active (5–19)'],
            ['#64748b', 'Low / fallback'],
          ].map(([color, label]) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm rotate-45" style={{ background: color }} />
              <span>{label}</span>
            </div>
          ))}
        </div>
        <span className="text-[9px] text-slate-600">{BASEMAP.provider === 'arcgis' ? `ArcGIS ${BASEMAP.styleLabel}` : 'Fallback basemap'}</span>
      </div>
    </div>
  );
}
