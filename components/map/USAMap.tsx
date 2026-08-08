'use client';
import { useEffect, useRef, useState } from 'react';
import { getHiringBasemap } from './arcgisBasemap';

const BASEMAP = getHiringBasemap();

const MAP_FILTERS = [
  { id: 'all', label: 'All Jobs' },
  { id: 'new_only', label: 'New' },
  { id: 'remote', label: 'Remote' },
  { id: 'security', label: 'Security' },
  { id: 'medical', label: 'Medical' },
  { id: 'logistics', label: 'Logistics' },
];

type MapMeta = {
  total_jobs?: number;
  mapped_jobs?: number;
  real_mapped_jobs?: number;
  unmapped_jobs?: number;
  fallback_jobs?: number;
  location_count?: number;
};

export default function USAMap({
  entityId,
  portalId,
  title = 'USA Hiring Map',
}: {
  entityId?: string;
  portalId?: string;
  title?: string;
}) {
  const [filter, setFilter] = useState('all');
  const [mapData, setMapData] = useState<any[]>([]);
  const [mapMeta, setMapMeta] = useState<MapMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [MapComponents, setMapComponents] = useState<any>(null);
  const mapRef = useRef<any>(null);
  const mapShellRef = useRef<HTMLDivElement | null>(null);

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
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= 15 && lat <= 72 && lng >= -180 && lng <= -50);
    if (!points.length) return;

    const frame = window.requestAnimationFrame(() => {
      const map = mapRef.current;
      if (!map) return;
      if (points.length === 1) {
        map.setView(points[0], 7, { animate: false });
        return;
      }
      const bounds = MapComponents.L.latLngBounds(points).pad(0.18);
      map.fitBounds(bounds, { animate: false, maxZoom: 8, padding: [24, 24] });
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
    params.set('country', 'US');
    params.set('include_meta', 'true');
    if (filter === 'new_only') params.set('new_only', 'true');
    if (['remote', 'security', 'medical', 'logistics'].includes(filter)) params.set('role_category', filter);

    fetch(`/api/map?${params}`, { signal: controller.signal })
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
    <div className="map-glass-card h-full min-h-[520px] flex flex-col gap-3.5">
      <div className="flex items-start justify-between flex-wrap gap-3 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[15px] font-semibold text-slate-100 tracking-tight">{title}</h3>
            {BASEMAP.provider === 'arcgis' && <span className="map-provider-badge">ArcGIS</span>}
          </div>
          <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
            United States · {mapData.length} locations
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

      <div ref={mapShellRef} className="relative map-container flex-1" style={{ minHeight: 420 }}>
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
            center={[38.5, -96.5]}
            zoom={4}
            minZoom={3}
            maxZoom={13}
            maxBounds={[[15, -170], [72, -50]]}
            maxBoundsViscosity={0.85}
            style={{ height: '100%', width: '100%', borderRadius: '12px', background: '#080d1a' }}
            zoomControl={false}
            attributionControl={true}
          >
            <MapComponents.TileLayer
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
              if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 15 || lat > 72 || lng < -180 || lng > -50) return null;
              const count = Number(point.cnt || 1);
              const visual = markerVisual(count, Boolean(point.is_fallback));
              return (
                <MapComponents.CircleMarker
                  key={`${lat}-${lng}-${i}`}
                  center={[lat, lng]}
                  radius={visual.radius}
                  pathOptions={{
                    fillColor: visual.fill,
                    color: visual.stroke,
                    weight: visual.weight,
                    fillOpacity: visual.opacity,
                    className: point.is_fallback ? 'hiring-map-dot hiring-map-dot-fallback' : 'hiring-map-dot',
                  }}
                >
                  <MapComponents.Popup>
                    <div style={{ fontFamily: 'sans-serif', fontSize: 12, minWidth: 170 }}>
                      <strong>{[point.city, point.state].filter(Boolean).join(', ') || 'Unknown location'}</strong><br />
                      <span style={{ color: '#7dd3fc' }}>{count} open job{count !== 1 ? 's' : ''}</span>
                      {point.entity_name && <><br /><span style={{ color: '#94a3b8' }}>{point.entity_name}</span></>}
                      {point.location_quality && <><br /><span style={{ color: point.is_fallback ? '#cbd5e1' : '#64748b' }}>{point.location_quality}</span></>}
                    </div>
                  </MapComponents.Popup>
                </MapComponents.CircleMarker>
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
              <div className="w-2 h-2 rounded-full" style={{ background: color }} />
              <span>{label}</span>
            </div>
          ))}
        </div>
        <span className="text-[9px] text-slate-600">{BASEMAP.provider === 'arcgis' ? 'ArcGIS Dark Gray' : 'Fallback basemap'}</span>
      </div>
    </div>
  );
}

function markerVisual(count: number, fallback: boolean) {
  if (fallback) {
    return { radius: Math.min(4 + Math.log2(count + 1) * 1.4, 12), fill: '#64748b', stroke: 'rgba(203,213,225,0.55)', weight: 1, opacity: 0.48 };
  }
  const radius = Math.min(4.5 + Math.log2(Math.max(count, 1) + 1) * 1.75, 18);
  if (count >= 50) return { radius, fill: '#7dd3fc', stroke: 'rgba(224,242,254,0.88)', weight: 1.3, opacity: 0.88 };
  if (count >= 20) return { radius, fill: '#60a5fa', stroke: 'rgba(191,219,254,0.82)', weight: 1.2, opacity: 0.84 };
  if (count >= 5) return { radius, fill: '#3b82f6', stroke: 'rgba(147,197,253,0.75)', weight: 1.1, opacity: 0.8 };
  return { radius, fill: '#2563eb', stroke: 'rgba(96,165,250,0.72)', weight: 1, opacity: 0.76 };
}
