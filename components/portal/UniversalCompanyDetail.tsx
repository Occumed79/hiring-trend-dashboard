'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Portal } from '@/lib/portals';
import TrendCard from '@/components/charts/TrendCard';
import RoleBreakdown from '@/components/charts/RoleBreakdown';
import WorldMap from '@/components/map/WorldMap';
import USAMap from '@/components/map/USAMap';
import OpenRolesList from './OpenRolesList';

export default function UniversalCompanyDetail({ entity, portal, onBack, onRemoved }: {
  entity: any; portal: Portal; onBack: () => void; onRemoved: (id: string) => void;
}) {
  const [data, setData] = useState<any>(null);
  const [roles, setRoles] = useState<any[]>([]);
  const [ingest, setIngest] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const useWorldMap = portal.mapType === 'world';
  const noun = entityNoun(portal.id);

  const loadDetails = useCallback(async (signal?: AbortSignal, silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const [metricData, roleRows, ingestData] = await Promise.all([
        fetch(`/api/entities/${entity.id}/metrics`, { signal }).then(readJson),
        fetch(`/api/entities/${entity.id}/jobs?limit=500`, { signal }).then(readJson),
        fetch(`/api/entities/${entity.id}/ingest`, { signal }).then(readJson),
      ]);
      setData(metricData); setRoles(Array.isArray(roleRows) ? roleRows : []); setIngest(ingestData);
    } catch (err) {
      if ((err as any)?.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : `Could not load ${noun.toLowerCase()} details.`);
    } finally { if (!signal?.aborted && !silent) setLoading(false); }
  }, [entity.id, noun]);

  useEffect(() => { const controller = new AbortController(); loadDetails(controller.signal).catch(() => {}); return () => controller.abort(); }, [loadDetails]);
  useEffect(() => {
    if (ingest?.status !== 'queued') return;
    const interval = window.setInterval(async () => {
      try {
        const next = await fetch(`/api/entities/${entity.id}/ingest`).then(readJson);
        setIngest(next);
        if (next?.status !== 'queued') await loadDetails(undefined, true);
      } catch {}
    }, 4000);
    return () => window.clearInterval(interval);
  }, [entity.id, ingest?.status, loadDetails]);

  async function refreshEntity() {
    setRefreshing(true); setError('');
    try {
      const response = await fetch(`/api/entities/${entity.id}/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reconcile: true }) });
      await readJson(response);
      await loadDetails(undefined, true);
    } catch (err) { setError(err instanceof Error ? err.message : `Could not refresh this ${noun.toLowerCase()}.`); }
    finally { setRefreshing(false); }
  }

  async function removeEntity() {
    setRemoving(true); setError('');
    try {
      const res = await fetch(`/api/entities/${entity.id}`, { method: 'DELETE' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `Could not stop tracking this ${noun.toLowerCase()}.`);
      onRemoved(entity.id);
    } catch (err) { setError(err instanceof Error ? err.message : `Could not stop tracking this ${noun.toLowerCase()}.`); }
    finally { setRemoving(false); }
  }

  const provider = ingest?.ats_provider && ingest.ats_provider !== 'unknown' ? ingest.ats_provider : entity.ats_provider;
  const coverage = ingest?.coverage;
  const activeJobs = Number(coverage?.active_jobs ?? data?.metrics?.totalActive ?? 0);
  const mappedJobs = Number(coverage?.mapped_jobs ?? data?.metrics?.mappedJobs ?? 0);
  const mappedPct = activeJobs > 0 ? Math.round((mappedJobs / activeJobs) * 100) : 0;

  return (
    <div className="min-h-full p-5 lg:p-6 space-y-5 max-w-[1600px] mx-auto">
      <section className="glass-card-hero luminous-panel relative overflow-hidden p-5 lg:p-6">
        <div className="shimmer-top" /><div className="aurora-sweep" />
        <div className="relative z-10 flex items-start justify-between gap-5 flex-wrap">
          <div className="min-w-0">
            <button onClick={onBack} className="text-[11px] text-slate-500 hover:text-slate-200 mb-3 transition-colors">← Back to {portal.label}</button>
            <div className="flex items-center gap-3 flex-wrap"><h1 className="text-[26px] lg:text-[30px] font-semibold text-white tracking-tight leading-tight">{entity.name}</h1><StatusBadge status={ingest?.status} /></div>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {entity.industry && <Tag>{entity.industry}</Tag>}
              {provider && provider !== 'unknown' && <Tag>ATS: {provider}</Tag>}
              {(ingest?.career_page_url || entity.career_page_url) && <a href={ingest?.career_page_url || entity.career_page_url} target="_blank" rel="noreferrer" className="text-[11px] px-2.5 py-1 rounded-full border border-blue-400/25 bg-blue-500/10 text-blue-200 hover:bg-blue-500/20">Career Page ↗</a>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={refreshEntity} disabled={refreshing} className="px-4 py-2.5 rounded-xl border border-blue-400/35 bg-blue-500/12 text-blue-100 text-xs font-medium hover:bg-blue-500/22 disabled:opacity-50 transition-all">{refreshing ? 'Refreshing…' : 'Refresh Intelligence'}</button>
            {!confirming ? <button onClick={() => setConfirming(true)} className="px-3.5 py-2.5 rounded-xl border border-red-400/25 bg-red-500/8 text-red-200 text-xs hover:bg-red-500/16 transition-all">Stop Tracking</button> : (
              <div className="flex items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 p-2.5"><span className="text-xs text-red-100">Remove?</span><button onClick={removeEntity} disabled={removing} className="text-xs text-red-100 underline disabled:opacity-50">{removing ? 'Removing…' : 'Yes'}</button><button onClick={() => setConfirming(false)} disabled={removing} className="text-xs text-slate-400 underline disabled:opacity-50">Cancel</button></div>
            )}
          </div>
        </div>
        <div className="relative z-10 grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          <HeaderMetric label="Open roles" value={activeJobs} />
          <HeaderMetric label="Mapped jobs" value={mappedJobs} suffix={activeJobs ? ` · ${mappedPct}%` : ''} />
          <HeaderMetric label="New this week" value={Number(data?.metrics?.newThisWeek ?? 0)} />
          <div className="rounded-xl border border-white/10 bg-white/[0.035] px-3.5 py-3"><p className="text-[9px] uppercase tracking-[0.13em] text-slate-500">Last ingest</p><p className="text-[12px] font-medium text-slate-200 mt-1.5 truncate">{formatDateTime(ingest?.last_run_at)}</p><p className="text-[9px] text-slate-600 mt-0.5 truncate">{ingest?.source || 'Waiting for first run'}</p></div>
        </div>
      </section>
      {ingest?.status === 'queued' && <div className="rounded-2xl border border-blue-400/20 bg-blue-500/8 px-4 py-3 text-xs text-blue-100 flex items-center gap-3"><span className="inline-block w-3.5 h-3.5 border-2 border-blue-300 border-t-transparent rounded-full animate-spin" />Resolving the career source and building the first hiring snapshot. This view will refresh automatically.</div>}
      {error && <div className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>}
      <TrendCard metrics={data?.metrics} loading={loading} entityName={entity.name} />
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2.15fr)_minmax(320px,0.85fr)] gap-5 items-stretch"><div className="min-w-0">{useWorldMap ? <WorldMap entityId={entity.id} /> : <USAMap entityId={entity.id} title={`${entity.name} Hiring Map`} />}</div><RoleBreakdown roles={data?.roles} loading={loading} /></div>
      <OpenRolesList rows={roles} loading={loading} />
    </div>
  );
}

function HeaderMetric({ label, value, suffix = '' }: { label: string; value: number; suffix?: string }) { return <div className="rounded-xl border border-white/10 bg-white/[0.035] px-3.5 py-3"><p className="text-[9px] uppercase tracking-[0.13em] text-slate-500">{label}</p><p className="text-lg font-semibold text-slate-100 mt-1">{value.toLocaleString()}<span className="text-[10px] text-slate-500 font-normal">{suffix}</span></p></div>; }
function StatusBadge({ status }: { status?: string }) { const text = status === 'queued' ? 'Building intelligence' : status === 'error' ? 'Ingest error' : status === 'partial' ? 'Partial coverage' : status === 'success' ? 'Current' : 'Loading'; const cls = status === 'error' ? 'border-red-400/25 bg-red-500/10 text-red-200' : status === 'queued' ? 'border-blue-400/25 bg-blue-500/10 text-blue-200' : 'border-emerald-400/20 bg-emerald-500/8 text-emerald-200'; return <span className={`text-[10px] px-2.5 py-1 rounded-full border font-medium ${cls}`}>{text}</span>; }
function Tag({ children }: { children: any }) { return <span className="text-[10px] px-2.5 py-1 rounded-full bg-white/[0.045] border border-white/10 text-slate-400">{children}</span>; }
function entityNoun(portalId: string) { if (portalId === 'current_clients') return 'Client'; if (portalId === 'prospects') return 'Prospect'; if (portalId.includes('agencies')) return 'Agency'; if (portalId === 'counties_and_cities') return 'Municipality'; return 'Company'; }
function formatDateTime(value?: string | null) { if (!value) return 'Not completed yet'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
async function readJson(response: Response) { const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error || 'Request failed.'); return body; }
