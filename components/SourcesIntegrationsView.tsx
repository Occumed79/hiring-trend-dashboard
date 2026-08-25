'use client';

import { useCallback, useEffect, useState } from 'react';
import SourceCoveragePanel from '@/components/portal/SourceCoveragePanel';
import IntegrationStatusPanel from '@/components/portal/IntegrationStatusPanel';

export default function SourcesIntegrationsView({ entity }: { entity?: any | null }) {
  const [ingest, setIngest] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!entity?.id) {
      setIngest(null);
      setError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/entities/${entity.id}/ingest`, { cache: 'no-store' });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'Could not load source and integration status.');
      setIngest(body);
    } catch (err) {
      setIngest(null);
      setError(err instanceof Error ? err.message : 'Could not load source and integration status.');
    } finally {
      setLoading(false);
    }
  }, [entity?.id]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  if (!entity?.id) {
    return (
      <div className="min-h-full p-5 lg:p-6 max-w-[1650px] mx-auto">
        <section className="glass-card-hero luminous-panel relative overflow-hidden p-6 lg:p-8">
          <div className="shimmer-top" /><div className="aurora-sweep" />
          <div className="relative z-10 max-w-3xl">
            <p className="text-[10px] uppercase tracking-[0.17em] text-blue-300/65">Entity diagnostics</p>
            <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-white">Sources & Integrations</h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-500">Open a tracked employer, agency, county, or city first. This workspace will then show that entity’s source coverage and configured intelligence integrations without cluttering the hiring profile.</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-full p-5 lg:p-6 space-y-5 max-w-[1740px] mx-auto">
      <section className="glass-card-hero luminous-panel relative overflow-hidden p-5 lg:p-6">
        <div className="shimmer-top" /><div className="aurora-sweep" />
        <div className="relative z-10 flex items-start justify-between gap-5 flex-wrap">
          <div>
            <p className="text-[10px] uppercase tracking-[0.17em] text-blue-300/65">Entity diagnostics</p>
            <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-white">Sources & Integrations</h1>
            <p className="mt-2 text-sm text-slate-300">{entity.name}</p>
            <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-slate-500">Hiring-source coverage, connector wiring, entitlement state, and supplemental discovery health are kept here instead of inside the employer’s hiring profile.</p>
          </div>
          <button onClick={() => load()} disabled={loading} className="px-4 py-2.5 rounded-xl border border-blue-400/30 bg-blue-500/10 text-xs text-blue-100 hover:bg-blue-500/20 disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh status'}</button>
        </div>
      </section>

      {error && <div className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>}

      <SourceCoveragePanel
        rows={ingest?.source_coverage}
        registry={ingest?.government_registry}
        assessment={ingest?.coverage_assessment}
        incidents={ingest?.source_incidents}
        loading={loading}
      />
      <IntegrationStatusPanel integrations={ingest?.integrations} />
    </div>
  );
}
