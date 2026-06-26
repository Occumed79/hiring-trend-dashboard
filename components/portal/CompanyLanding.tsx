'use client';
import { useEffect, useState } from 'react';
import type { Portal } from '@/lib/portals';
import WorldMap from '@/components/map/WorldMap';
import USAMap from '@/components/map/USAMap';
import CompanyRegistry from './CompanyRegistry';

export default function CompanyLanding({ portal, entities, loading, error, onSelectEntity, onAddEntity }: {
  portal: Portal;
  entities: any[];
  loading: boolean;
  error?: string;
  onSelectEntity: (e: any) => void;
  onAddEntity: () => void;
}) {
  const [metrics, setMetrics] = useState<any>(null);
  const [metricsError, setMetricsError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setMetricsError('');
    fetch(`/api/portal-metrics?portal=${encodeURIComponent(portal.id)}`, { signal: controller.signal })
      .then(async r => {
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error(data?.error || 'Could not load portal metrics.');
        return data;
      })
      .then(setMetrics)
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setMetrics(null);
        setMetricsError(err instanceof Error ? err.message : 'Could not load portal metrics.');
      });
    return () => controller.abort();
  }, [portal.id, entities.length]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? entities.filter(e => `${e.name} ${e.industry || ''}`.toLowerCase().includes(q))
    : entities;

  const cards = [
    ['Tracked Companies', metrics?.total_entities ?? entities.length],
    ['Companies Hiring', metrics?.active_hiring ?? 0],
    ['Open Roles', metrics?.open_roles ?? 0],
    ['New This Week', metrics?.new_this_week ?? 0],
  ];

  return (
    <div className="p-6 space-y-5 max-w-[1440px] mx-auto">
      <div className="glass-card-hero luminous-panel relative overflow-hidden p-7">
        <div className="shimmer-top" />
        <div className="aurora-sweep" />
        <div className="relative z-10 flex items-center justify-between gap-5 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-[28px] font-semibold text-white tracking-tight">{portal.label}</h1>
              <span className="text-[11px] px-3 py-1 rounded-full border border-blue-300/30 bg-blue-400/10 text-blue-200">Any company</span>
            </div>
            <p className="text-slate-400 text-sm leading-relaxed max-w-2xl">Search or add any company and track hiring activity over time.</p>
          </div>
          <button onClick={onAddEntity} className="px-5 py-2.5 rounded-xl border border-blue-300/35 bg-blue-500/15 text-blue-100 text-sm font-medium hover:bg-blue-400/25 transition-all luminous-button">Track Company</button>
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tracked companies..." className="relative z-10 mt-6 w-full rounded-2xl border border-white/12 bg-white/[0.06] px-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-blue-300/50" />
      </div>

      {(error || metricsError) && (
        <div className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error || metricsError}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(([label, value]) => (
          <div key={String(label)} className="glass-card-metric luminous-panel p-5 relative overflow-hidden">
            <div className="shimmer-top" />
            <p className="text-[11px] text-slate-500 font-medium uppercase tracking-widest mb-2">{label}</p>
            <p className="text-[32px] font-semibold tracking-tight text-blue-200">{loading ? '...' : Number(value).toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2">{portal.mapType === 'world' ? <WorldMap portalId={portal.id} /> : <USAMap portalId={portal.id} title={`${portal.label} Hiring Map`} />}</div>
        <CompanyRegistry entities={filtered} loading={loading} onSelect={onSelectEntity} onAdd={onAddEntity} />
      </div>
    </div>
  );
}
