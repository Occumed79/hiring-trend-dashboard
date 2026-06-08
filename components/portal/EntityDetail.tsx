'use client';
import { useState, useEffect } from 'react';
import TrendCard from '@/components/charts/TrendCard';
import RoleBreakdown from '@/components/charts/RoleBreakdown';
import WorldMap from '@/components/map/WorldMap';

export default function EntityDetail({ entity, portal }: { entity: any; portal: any }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/entities/${entity.id}/metrics`)
      .then(r => r.json())
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [entity.id]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Entity header */}
      <div className="glass-card p-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-100">{entity.name}</h1>
            {entity.aliases?.length > 0 && (
              <p className="text-xs text-slate-500 mt-0.5">
                Also known as: {entity.aliases.join(', ')}
              </p>
            )}
            <div className="flex items-center gap-3 mt-2">
              {entity.industry && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/25 text-blue-300">
                  {entity.industry}
                </span>
              )}
              {entity.ats_provider && entity.ats_provider !== 'unknown' && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-white/8 border border-white/12 text-slate-400">
                  ATS: {entity.ats_provider}
                </span>
              )}
              {entity.career_page_url && (
                <a
                  href={entity.career_page_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 underline"
                >
                  Career Page ↗
                </a>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">{portal.label}</p>
          </div>
        </div>
      </div>

      {/* Trend Card */}
      <TrendCard metrics={data?.metrics} loading={loading} entityName={entity.name} />

      {/* Map + Role breakdown in row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <WorldMap entityId={entity.id} />
        </div>
        <div>
          <RoleBreakdown roles={data?.roles} loading={loading} />
        </div>
      </div>
    </div>
  );
}
