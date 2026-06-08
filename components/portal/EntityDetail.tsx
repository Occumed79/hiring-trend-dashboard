'use client';
import type { Portal } from "@/lib/portals";
import { useState, useEffect } from 'react';
import TrendCard from '@/components/charts/TrendCard';
import RoleBreakdown from '@/components/charts/RoleBreakdown';
import WorldMap from '@/components/map/WorldMap';
import USAMap from '@/components/map/USAMap';

// Portals that use the World map (global / overseas hiring)
const WORLD_MAP_PORTALS = new Set(['current_clients', 'prospects']);

// USA-map titles per portal
const USA_MAP_TITLES: Record<string, string> = {
  private_companies: 'USA Hiring Map',
  federal_agencies: 'Federal Hiring Map — USA',
  state_agencies: 'State Agency Hiring Map — USA',
  counties_and_cities: 'County & City Hiring Map — USA',
};

export default function EntityDetail({ entity, portal }: { entity: any; portal: Portal }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const useWorldMap = WORLD_MAP_PORTALS.has(portal.id);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/entities/${entity.id}/metrics`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [entity.id]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Entity header */}
      <div className="glass-card p-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-100">{entity.name}</h1>
            {entity.aliases?.length > 0 && (
              <p className="text-xs text-slate-500 mt-0.5">
                Also known as: {entity.aliases.join(', ')}
              </p>
            )}
            <div className="flex items-center gap-3 mt-2 flex-wrap">
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
            <span className="text-xs text-slate-500">{portal.label}</span>
          </div>
        </div>
      </div>

      {/* Trend Card */}
      <TrendCard metrics={data?.metrics} loading={loading} entityName={entity.name} />

      {/* Map + Role breakdown */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          {useWorldMap ? (
            <WorldMap entityId={entity.id} />
          ) : (
            <USAMap
              entityId={entity.id}
              title={USA_MAP_TITLES[portal.id] || 'USA Hiring Map'}
            />
          )}
        </div>
        <div>
          <RoleBreakdown roles={data?.roles} loading={loading} />
        </div>
      </div>

      {/* Source status panel */}
      <SourceStatus entity={entity} portal={portal} />
    </div>
  );
}

// Shows which hiring sources are active/disabled for this entity
function SourceStatus({ entity, portal }: { entity: any; portal: Portal }) {
  const sources = getPortalSources(portal.id, entity);

  return (
    <div className="glass-card p-5">
      <h3 className="text-sm font-semibold text-slate-200 mb-3">Hiring Sources</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {sources.map(src => (
          <div
            key={src.id}
            className={`p-2.5 rounded-xl border text-xs flex flex-col gap-1 ${
              src.status === 'active'
                ? 'bg-emerald-500/10 border-emerald-500/25'
                : src.status === 'needs_key'
                ? 'bg-amber-500/10 border-amber-500/20'
                : 'bg-white/4 border-white/8'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                src.status === 'active' ? 'bg-emerald-400' :
                src.status === 'needs_key' ? 'bg-amber-400' : 'bg-slate-600'
              }`} />
              <span className="font-medium text-slate-300 truncate">{src.name}</span>
            </div>
            <span className={`text-[10px] ${
              src.status === 'active' ? 'text-emerald-400' :
              src.status === 'needs_key' ? 'text-amber-400' : 'text-slate-600'
            }`}>
              {src.status === 'active' ? 'Active' :
               src.status === 'needs_key' ? 'Key required' : 'Unavailable'}
            </span>
          </div>
        ))}
      </div>
      {sources.some(s => s.status === 'needs_key') && (
        <p className="text-[10px] text-slate-600 mt-3">
          Sources marked "Key required" can be enabled by adding the corresponding API key to your environment variables.
        </p>
      )}
    </div>
  );
}

type SourceStatus = 'active' | 'needs_key' | 'unavailable';
interface Source { id: string; name: string; status: SourceStatus; }

function getPortalSources(portalId: string, entity: any): Source[] {
  const hasAts = entity.ats_provider && entity.ats_provider !== 'unknown' && entity.ats_board_id;
  const hasCareerPage = !!entity.career_page_url;

  const careerPage: Source = {
    id: 'career_page', name: 'Career Page',
    status: hasCareerPage ? 'active' : 'unavailable',
  };
  const atsSource: Source = {
    id: 'ats', name: entity.ats_provider !== 'unknown' ? entity.ats_provider || 'ATS' : 'ATS',
    status: hasAts ? 'active' : 'unavailable',
  };
  const adzuna: Source = { id: 'adzuna', name: 'Adzuna', status: 'active' };

  switch (portalId) {
    case 'current_clients':
    case 'prospects':
      return [careerPage, atsSource, adzuna];

    case 'private_companies':
      return [
        careerPage,
        atsSource,
        adzuna,
        {
          id: 'private_sector',
          name: 'Private Hiring API',
          status: hasEnvKey('PRIVATE_SECTOR_HIRING_API_KEY') ? 'active' : 'needs_key',
        },
      ];

    case 'federal_agencies':
      return [
        careerPage,
        atsSource,
        { id: 'usajobs', name: 'USAJOBS', status: hasEnvKey('USAJOBS_API_KEY') ? 'active' : 'needs_key' },
        {
          id: 'federal_api',
          name: 'Federal Hiring API',
          status: hasEnvKey('FEDERAL_HIRING_API_KEY') ? 'active' : 'needs_key',
        },
      ];

    case 'state_agencies':
      return [
        careerPage,
        atsSource,
        adzuna,
        {
          id: 'state_api',
          name: 'State Hiring API',
          status: hasEnvKey('STATE_HIRING_API_KEY') ? 'active' : 'needs_key',
        },
      ];

    case 'counties_and_cities':
      return [
        careerPage,
        atsSource,
        adzuna,
        {
          id: 'county_api',
          name: 'County Hiring API',
          status: hasEnvKey('COUNTY_HIRING_API_KEY') ? 'active' : 'needs_key',
        },
        {
          id: 'city_api',
          name: 'City Hiring API',
          status: hasEnvKey('CITY_HIRING_API_KEY') ? 'active' : 'needs_key',
        },
        {
          id: 'municipal_api',
          name: 'Municipal Hiring API',
          status: hasEnvKey('MUNICIPAL_HIRING_API_KEY') ? 'active' : 'needs_key',
        },
      ];

    default:
      return [careerPage, atsSource, adzuna];
  }
}

// Client-side env check — only NEXT_PUBLIC_ vars are readable on client.
// Server-side status is passed via the metrics API; this is a best-effort UI hint.
function hasEnvKey(key: string): boolean {
  // All portal-specific keys are server-side only, so we can't know from the client.
  // Return false so they always show "Key required" until the user adds them.
  // The ingest route handles graceful fallback on the server.
  return false;
}
