'use client';
import { useEffect, useState } from 'react';
import type { Portal } from '@/lib/portals';
import TrendCard from '@/components/charts/TrendCard';
import RoleBreakdown from '@/components/charts/RoleBreakdown';
import WorldMap from '@/components/map/WorldMap';
import USAMap from '@/components/map/USAMap';
import OpenRolesList from './OpenRolesList';

export default function UniversalCompanyDetail({ entity, portal, onBack, onRemoved }: {
  entity: any;
  portal: Portal;
  onBack: () => void;
  onRemoved: (id: string) => void;
}) {
  const [data, setData] = useState<any>(null);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const useWorldMap = portal.mapType === 'world';

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    Promise.all([
      fetch(`/api/entities/${entity.id}/metrics`, { signal: controller.signal }).then(readJson),
      fetch(`/api/entities/${entity.id}/jobs?limit=100`, { signal: controller.signal }).then(readJson),
    ]).then(([metricData, roleRows]) => {
      setData(metricData);
      setRoles(Array.isArray(roleRows) ? roleRows : []);
      setLoading(false);
    }).catch((err) => {
      if (err?.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Could not load company details.');
      setLoading(false);
    });
    return () => controller.abort();
  }, [entity.id]);

  async function removeEntity() {
    setRemoving(true);
    setError('');
    try {
      const res = await fetch(`/api/entities/${entity.id}`, { method: 'DELETE' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Could not stop tracking this company.');
      onRemoved(entity.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not stop tracking this company.');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="glass-card-hero luminous-panel relative overflow-hidden p-5">
        <div className="shimmer-top" />
        <div className="aurora-sweep" />
        <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <button onClick={onBack} className="text-xs text-slate-500 hover:text-slate-300 mb-3">Back to companies</button>
            <h1 className="text-xl font-semibold text-slate-100">{entity.name}</h1>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {entity.industry && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/25 text-blue-300">{entity.industry}</span>}
              {entity.ats_provider && entity.ats_provider !== 'unknown' && <span className="text-xs px-2 py-0.5 rounded-full bg-white/8 border border-white/12 text-slate-400">ATS: {entity.ats_provider}</span>}
              {entity.career_page_url && <a href={entity.career_page_url} target="_blank" rel="noreferrer" className="text-xs text-blue-300 hover:text-blue-200 underline">Career Page</a>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!confirming ? (
              <button onClick={() => setConfirming(true)} className="px-3 py-2 rounded-xl border border-red-400/30 bg-red-500/10 text-red-200 text-xs hover:bg-red-500/20 transition-all">Stop Tracking</button>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 p-2">
                <span className="text-xs text-red-100">Remove?</span>
                <button onClick={removeEntity} disabled={removing} className="text-xs text-red-100 underline disabled:opacity-50">{removing ? 'Removing...' : 'Yes'}</button>
                <button onClick={() => setConfirming(false)} disabled={removing} className="text-xs text-slate-400 underline disabled:opacity-50">Cancel</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {error && <div className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>}

      <TrendCard metrics={data?.metrics} loading={loading} entityName={entity.name} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          {useWorldMap ? <WorldMap entityId={entity.id} /> : <USAMap entityId={entity.id} title={`${entity.name} Hiring Map`} />}
        </div>
        <RoleBreakdown roles={data?.roles} loading={loading} />
      </div>

      <OpenRolesList rows={roles} loading={loading} />
    </div>
  );
}

async function readJson(response: Response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || 'Request failed.');
  return body;
}
