'use client';
import { useEffect, useState } from 'react';
import type { Portal } from '@/lib/portals';
import WorldMap from '@/components/map/WorldMap';
import USAMap from '@/components/map/USAMap';
import CompanyRegistry from './CompanyRegistry';

type PortalCopy = {
  singular: string;
  plural: string;
  action: string;
  description: string;
};

const PORTAL_COPY: Record<string, PortalCopy> = {
  current_clients: {
    singular: 'Client',
    plural: 'Clients',
    action: 'Track Client',
    description: 'Search or add any client and track hiring activity over time.',
  },
  prospects: {
    singular: 'Prospect',
    plural: 'Prospects',
    action: 'Track Prospect',
    description: 'Search or add any prospect and monitor hiring signals over time.',
  },
  private_companies: {
    singular: 'Company',
    plural: 'Companies',
    action: 'Track Company',
    description: 'Search or add any company and track hiring activity over time.',
  },
  federal_agencies: {
    singular: 'Federal Agency',
    plural: 'Federal Agencies',
    action: 'Track Agency',
    description: 'Search or add a federal agency and monitor hiring activity over time.',
  },
  state_agencies: {
    singular: 'State Agency',
    plural: 'State Agencies',
    action: 'Track Agency',
    description: 'Search or add a state agency and monitor hiring activity over time.',
  },
  counties_and_cities: {
    singular: 'Municipality',
    plural: 'Municipalities',
    action: 'Track Municipality',
    description: 'Search or add a county or city and monitor local hiring activity over time.',
  },
};

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
  const copy = PORTAL_COPY[portal.id] ?? PORTAL_COPY.private_companies;

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
    [`Tracked ${copy.plural}`, metrics?.total_entities ?? entities.length],
    [`${copy.plural} Hiring`, metrics?.active_hiring ?? 0],
    ['Open Roles', metrics?.open_roles ?? 0],
    ['New This Week', metrics?.new_this_week ?? 0],
  ];

  return (
    <div className="min-h-full p-5 lg:p-6 flex flex-col gap-5 max-w-[1600px] mx-auto">
      <section className="glass-card-hero luminous-panel relative overflow-hidden px-6 py-5 lg:px-7 lg:py-6 shrink-0">
        <div className="shimmer-top" />
        <div className="aurora-sweep" />
        <div className="relative z-10 flex items-center justify-between gap-5 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-1.5 flex-wrap">
              <h1 className="text-[27px] lg:text-[30px] font-semibold text-white tracking-tight leading-tight">{portal.label}</h1>
              <span className="text-[11px] px-3 py-1 rounded-full border border-blue-300/30 bg-blue-400/10 text-blue-100 font-medium">
                {loading ? 'Loading…' : `${entities.length} tracked`}
              </span>
            </div>
            <p className="text-slate-400 text-[13px] lg:text-sm leading-relaxed max-w-2xl">{copy.description}</p>
          </div>
          <button
            onClick={onAddEntity}
            className="px-5 py-2.5 rounded-xl border border-blue-300/40 bg-blue-500/20 text-blue-50 text-sm font-semibold hover:bg-blue-400/30 hover:border-blue-300/60 transition-all luminous-button shadow-[0_10px_30px_rgba(37,99,235,0.12)]"
          >
            {copy.action}
          </button>
        </div>

        <div className="relative z-10 mt-4 flex items-center gap-3">
          <div className="relative flex-1">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="11" cy="11" r="6.5" />
              <path d="m16 16 4 4" />
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Search tracked ${copy.plural.toLowerCase()}…`}
              className="w-full rounded-2xl border border-white/10 bg-white/[0.055] pl-11 pr-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-blue-300/50 focus:bg-white/[0.075] transition-all"
            />
          </div>
          {q && (
            <span className="hidden sm:inline-flex shrink-0 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[11px] text-slate-400">
              {filtered.length} match{filtered.length === 1 ? '' : 'es'}
            </span>
          )}
        </div>
      </section>

      {(error || metricsError) && (
        <div className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-100 shrink-0">
          {error || metricsError}
        </div>
      )}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 lg:gap-4 shrink-0">
        {cards.map(([label, value]) => (
          <div key={String(label)} className="glass-card-metric luminous-panel px-5 py-[18px] lg:p-5 relative overflow-hidden min-h-[92px]">
            <div className="shimmer-top" />
            <p className="text-[10px] lg:text-[11px] text-slate-500 font-semibold uppercase tracking-[0.16em] mb-2">{label}</p>
            <p className="text-[30px] lg:text-[32px] font-semibold tracking-tight leading-none text-blue-100">{loading ? '…' : Number(value).toLocaleString()}</p>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,2.15fr)_minmax(320px,0.85fr)] gap-5 flex-1 items-stretch min-h-[520px]">
        <div className="min-w-0 h-full">
          {portal.mapType === 'world'
            ? <WorldMap portalId={portal.id} />
            : <USAMap portalId={portal.id} title={`${portal.label} Hiring Map`} />
          }
        </div>
        <div className="min-w-0 h-full">
          <CompanyRegistry
            entities={filtered}
            loading={loading}
            onSelect={onSelectEntity}
            onAdd={onAddEntity}
            entitySingular={copy.singular}
            entityPlural={copy.plural}
          />
        </div>
      </section>
    </div>
  );
}
