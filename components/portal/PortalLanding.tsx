'use client';
import { useState } from 'react';
import type { Portal } from '@/lib/portals';
import WorldMap from '@/components/map/WorldMap';
import USAMap from '@/components/map/USAMap';

// ─── Per-portal config ─────────────────────────────────────────────────────────
const PORTAL_META: Record<string, {
  heroBg: string;         // subtle tinted glass gradient for hero card
  glowColor: string;      // CSS color for glow/accent
  accentClass: string;    // tailwind text color
  accentBadge: string;    // tailwind badge bg+border+text
  accentBtn: string;      // tailwind button bg+border+text
  description: string;
  entityLabel: string;
  metricLabels: string[];
}> = {
  current_clients: {
    heroBg: 'linear-gradient(135deg, rgba(59,130,246,0.18) 0%, rgba(30,64,175,0.08) 60%, rgba(0,0,0,0) 100%)',
    glowColor: 'rgba(59,130,246,0.25)',
    accentClass: 'text-blue-300',
    accentBadge: 'bg-blue-500/15 border-blue-400/30 text-blue-300',
    accentBtn: 'bg-blue-500/18 border-blue-400/40 text-blue-200 hover:bg-blue-500/28',
    description: 'Track active client hiring activity, ATS coverage, and open role volume across your portfolio.',
    entityLabel: 'Client',
    metricLabels: ['Total Clients', 'Active Hiring', 'Open Roles', 'New This Week'],
  },
  prospects: {
    heroBg: 'linear-gradient(135deg, rgba(139,92,246,0.18) 0%, rgba(91,33,182,0.08) 60%, rgba(0,0,0,0) 100%)',
    glowColor: 'rgba(139,92,246,0.22)',
    accentClass: 'text-violet-300',
    accentBadge: 'bg-violet-500/15 border-violet-400/30 text-violet-300',
    accentBtn: 'bg-violet-500/18 border-violet-400/40 text-violet-200 hover:bg-violet-500/28',
    description: 'Monitor hiring signals from potential clients worldwide. Identify expansion opportunities and hiring surges.',
    entityLabel: 'Prospect',
    metricLabels: ['Total Prospects', 'Hiring Signal', 'Open Roles', 'New This Week'],
  },
  private_companies: {
    heroBg: 'linear-gradient(135deg, rgba(6,182,212,0.16) 0%, rgba(14,116,144,0.07) 60%, rgba(0,0,0,0) 100%)',
    glowColor: 'rgba(6,182,212,0.2)',
    accentClass: 'text-cyan-300',
    accentBadge: 'bg-cyan-500/15 border-cyan-400/30 text-cyan-300',
    accentBtn: 'bg-cyan-500/18 border-cyan-400/40 text-cyan-200 hover:bg-cyan-500/28',
    description: 'Analyze private sector hiring across the US. Track workforce growth, role categories, and expansion signals.',
    entityLabel: 'Company',
    metricLabels: ['Companies', 'Active Hiring', 'Open Roles', 'New This Week'],
  },
  federal_agencies: {
    heroBg: 'linear-gradient(135deg, rgba(245,158,11,0.15) 0%, rgba(180,83,9,0.06) 60%, rgba(0,0,0,0) 100%)',
    glowColor: 'rgba(245,158,11,0.2)',
    accentClass: 'text-amber-300',
    accentBadge: 'bg-amber-500/15 border-amber-400/30 text-amber-300',
    accentBtn: 'bg-amber-500/18 border-amber-400/40 text-amber-200 hover:bg-amber-500/28',
    description: 'Monitor federal agency hiring across all US departments. Track clearance-required roles, USAJOBS postings, and agency growth.',
    entityLabel: 'Agency',
    metricLabels: ['Federal Agencies', 'Active Hiring', 'Open Roles', 'Security Roles'],
  },
  state_agencies: {
    heroBg: 'linear-gradient(135deg, rgba(16,185,129,0.15) 0%, rgba(6,95,70,0.06) 60%, rgba(0,0,0,0) 100%)',
    glowColor: 'rgba(16,185,129,0.2)',
    accentClass: 'text-emerald-300',
    accentBadge: 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300',
    accentBtn: 'bg-emerald-500/18 border-emerald-400/40 text-emerald-200 hover:bg-emerald-500/28',
    description: 'Track state government hiring across all 50 states. Monitor public sector workforce trends and budget-driven hiring cycles.',
    entityLabel: 'Agency',
    metricLabels: ['State Agencies', 'Active Hiring', 'Open Roles', 'New This Week'],
  },
  counties_and_cities: {
    heroBg: 'linear-gradient(135deg, rgba(244,63,94,0.14) 0%, rgba(159,18,57,0.06) 60%, rgba(0,0,0,0) 100%)',
    glowColor: 'rgba(244,63,94,0.18)',
    accentClass: 'text-rose-300',
    accentBadge: 'bg-rose-500/15 border-rose-400/30 text-rose-300',
    accentBtn: 'bg-rose-500/18 border-rose-400/40 text-rose-200 hover:bg-rose-500/28',
    description: 'Analyze hiring at the county and municipal level. Identify local government workforce expansion across cities and counties.',
    entityLabel: 'Municipality',
    metricLabels: ['Municipalities', 'Active Hiring', 'Open Roles', 'New This Week'],
  },
};

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function PortalLanding({
  portal, entities, loading, onSelectEntity, onAddEntity,
}: {
  portal: Portal;
  entities: any[];
  loading: boolean;
  onSelectEntity: (e: any) => void;
  onAddEntity: () => void;
}) {
  const meta = PORTAL_META[portal.id] ?? PORTAL_META.current_clients;
  const useWorldMap = portal.mapType === 'world';
  const totalEntities = entities.length;
  const hiringEntities = entities.filter(e => e.is_active !== false).length;
  const metricValues = [totalEntities, hiringEntities, 0, 0];

  return (
    <div className="p-6 space-y-5 max-w-[1440px] mx-auto">

      {/* ── Hero card ──────────────────────────────────────────────────────── */}
      <div className="glass-card-hero relative overflow-hidden">
        {/* Shimmer highlight */}
        <div className="shimmer-top" />
        {/* Tinted glow wash */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: meta.heroBg }} />
        {/* Soft glow orb bottom-right */}
        <div className="absolute -bottom-16 -right-16 w-64 h-64 rounded-full pointer-events-none"
          style={{ background: `radial-gradient(circle, ${meta.glowColor} 0%, transparent 70%)`, filter: 'blur(40px)' }} />

        <div className="relative z-10 px-8 py-7 flex items-center justify-between gap-6 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-[26px] font-semibold text-white tracking-tight leading-none">
                {portal.label}
              </h1>
              <span className={`text-[11px] px-3 py-1 rounded-full border font-medium ${meta.accentBadge}`}>
                {loading ? '…' : `${totalEntities} ${totalEntities === 1 ? meta.entityLabel : meta.entityLabel + 's'}`}
              </span>
            </div>
            <p className="text-slate-400 text-sm leading-relaxed max-w-lg">{meta.description}</p>
          </div>
          <button onClick={onAddEntity}
            className={`px-5 py-2.5 rounded-xl border text-sm font-medium transition-all backdrop-blur-sm ${meta.accentBtn}`}
            style={{ backdropFilter: 'blur(12px)' }}>
            + Add {meta.entityLabel}
          </button>
        </div>
      </div>

      {/* ── Metric cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {meta.metricLabels.map((label, i) => (
          <MetricCard
            key={label}
            label={label}
            value={loading ? null : metricValues[i]}
            accentClass={meta.accentClass}
            glowColor={meta.glowColor}
          />
        ))}
      </div>

      {/* ── Map + Role split ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2">
          {useWorldMap
            ? <WorldMap portalId={portal.id} />
            : <USAMap portalId={portal.id} title={`${portal.label} — Hiring Map`} />
          }
        </div>
        <RoleBreakdownCard />
      </div>

      {/* ── Entity registry ────────────────────────────────────────────────── */}
      <EntityTableCard
        entities={entities}
        loading={loading}
        meta={meta}
        portal={portal}
        onSelect={onSelectEntity}
        onAdd={onAddEntity}
      />
    </div>
  );
}

// ─── Metric Card ───────────────────────────────────────────────────────────────
function MetricCard({ label, value, accentClass, glowColor }: {
  label: string;
  value: number | null;
  accentClass: string;
  glowColor: string;
}) {
  return (
    <div className="glass-card-metric p-5 relative overflow-hidden">
      <div className="shimmer-top" />
      {/* Subtle accent glow bottom-left */}
      <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full pointer-events-none"
        style={{ background: `radial-gradient(circle, ${glowColor} 0%, transparent 70%)`, filter: 'blur(20px)', opacity: 0.5 }} />

      <div className="relative z-10">
        <p className="text-[11px] text-slate-500 font-medium uppercase tracking-widest mb-2">{label}</p>
        <div className={`text-[32px] font-semibold tracking-tight leading-none ${
          value === null ? 'text-slate-700' : value === 0 ? 'text-slate-500' : accentClass
        }`}>
          {value === null
            ? <div className="h-8 w-10 bg-white/8 rounded-lg animate-pulse" />
            : value.toLocaleString()
          }
        </div>
      </div>
    </div>
  );
}

// ─── Role Breakdown Card ───────────────────────────────────────────────────────
const ROLE_ROWS = [
  { label: 'Security / Defense', color: 'bg-red-400' },
  { label: 'Medical / Health',   color: 'bg-emerald-400' },
  { label: 'Logistics',          color: 'bg-orange-400' },
  { label: 'Engineering',        color: 'bg-blue-400' },
  { label: 'Administrative',     color: 'bg-purple-400' },
  { label: 'Other',              color: 'bg-slate-400' },
];

function RoleBreakdownCard() {
  return (
    <div className="glass-card p-5 flex flex-col h-full min-h-[300px]">
      <div className="shimmer-top" />
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-semibold text-slate-100 tracking-wide">Role Breakdown</h3>
        <span className="text-[10px] text-slate-600 bg-white/5 px-2.5 py-1 rounded-full border border-white/8">
          By category
        </span>
      </div>
      <div className="space-y-3.5 flex-1">
        {ROLE_ROWS.map(r => (
          <div key={r.label}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-slate-400">{r.label}</span>
              <span className="text-[10px] text-slate-600">0%</span>
            </div>
            <div className="h-1 bg-white/6 rounded-full overflow-hidden">
              <div className={`h-full w-0 ${r.color} rounded-full opacity-60`} />
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-700 mt-4 text-center">Populates after first data ingest</p>
    </div>
  );
}

// ─── Entity Table Card ─────────────────────────────────────────────────────────
const EMPTY_EXAMPLES: Record<string, string[]> = {
  current_clients:    ['Acme Medical Group', 'Summit Healthcare', 'Nexus Defense'],
  prospects:          ['Orbital Systems', 'Pinnacle Health', 'Atlas Logistics'],
  private_companies:  ['Lockheed Martin', 'Northrop Grumman', 'Raytheon'],
  federal_agencies:   ['Dept. of Defense', 'VA Health', 'DHS'],
  state_agencies:     ['CA Dept. of Health', 'TX DPS', 'FL Dept. of Health'],
  counties_and_cities:['Los Angeles County', 'Cook County', 'City of Houston'],
};

function EntityTableCard({ entities, loading, meta, portal, onSelect, onAdd }: {
  entities: any[];
  loading: boolean;
  meta: typeof PORTAL_META[string];
  portal: Portal;
  onSelect: (e: any) => void;
  onAdd: () => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = entities.filter(e =>
    !search ||
    e.name?.toLowerCase().includes(search.toLowerCase()) ||
    e.industry?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="glass-card overflow-hidden">
      <div className="shimmer-top" />

      {/* Card header */}
      <div className="px-6 py-4 border-b border-white/7 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{meta.entityLabel} Registry</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {entities.length} tracked {meta.entityLabel.toLowerCase()}{entities.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {entities.length > 0 && (
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Search ${meta.entityLabel.toLowerCase()}s…`}
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-white/20 w-44 transition-all"
            />
          )}
          <button onClick={onAdd}
            className={`px-3.5 py-1.5 rounded-xl border text-xs font-medium transition-all ${meta.accentBtn}`}>
            + Add {meta.entityLabel}
          </button>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="p-6 space-y-2.5">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-11 bg-white/4 rounded-xl animate-pulse" style={{ opacity: 1 - i * 0.22 }} />
          ))}
        </div>
      ) : entities.length === 0 ? (
        <EmptyState meta={meta} portal={portal} onAdd={onAdd} />
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center text-slate-500 text-sm">No results for &ldquo;{search}&rdquo;</div>
      ) : (
        <>
          {/* Column headers */}
          <div className="px-6 py-2.5 grid grid-cols-12 gap-4 border-b border-white/5
            text-[10px] font-semibold text-slate-600 uppercase tracking-widest">
            <div className="col-span-4">Name</div>
            <div className="col-span-2">Industry</div>
            <div className="col-span-2">ATS</div>
            <div className="col-span-2">Open Roles</div>
            <div className="col-span-2 text-right">Action</div>
          </div>
          {/* Rows */}
          {filtered.map(entity => (
            <div key={entity.id}
              onClick={() => onSelect(entity)}
              className="px-6 py-3.5 grid grid-cols-12 gap-4 items-center
                hover:bg-white/4 transition-colors cursor-pointer group
                border-b border-white/4 last:border-0">
              <div className="col-span-4 flex items-center gap-3 min-w-0">
                {/* Letter avatar */}
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center
                  text-xs font-semibold shrink-0 ${meta.accentBadge} border`}>
                  {(entity.name?.[0] ?? '?').toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-100 truncate group-hover:text-white">
                    {entity.name}
                  </p>
                  {entity.aliases?.length > 0 && (
                    <p className="text-[10px] text-slate-600 truncate">{entity.aliases.join(', ')}</p>
                  )}
                </div>
              </div>
              <div className="col-span-2">
                <span className="text-xs text-slate-400 truncate">{entity.industry || '—'}</span>
              </div>
              <div className="col-span-2">
                {entity.ats_provider && entity.ats_provider !== 'unknown' ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/7 border border-white/10 text-slate-400">
                    {entity.ats_provider}
                  </span>
                ) : <span className="text-xs text-slate-700">—</span>}
              </div>
              <div className="col-span-2">
                <span className="text-xs text-slate-600">—</span>
              </div>
              <div className="col-span-2 flex justify-end">
                <span className={`text-[10px] px-2.5 py-1 rounded-lg border
                  opacity-0 group-hover:opacity-100 transition-opacity ${meta.accentBadge}`}>
                  View →
                </span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ meta, portal, onAdd }: {
  meta: typeof PORTAL_META[string]; portal: Portal; onAdd: () => void;
}) {
  const examples = EMPTY_EXAMPLES[portal.id] ?? [];
  return (
    <div className="py-12 px-6 flex flex-col items-center gap-5">
      <div>
        <p className="text-slate-300 font-semibold text-base text-center mb-1">
          No {meta.entityLabel}s tracked yet
        </p>
        <p className="text-slate-500 text-sm text-center max-w-sm">
          Add your first {meta.entityLabel.toLowerCase()} to start tracking hiring trends and market signals.
        </p>
      </div>
      {examples.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap justify-center">
          <span className="text-xs text-slate-600">e.g.</span>
          {examples.map(ex => (
            <span key={ex}
              className="text-xs px-3 py-1.5 rounded-xl bg-white/5 border border-white/8 text-slate-400">
              {ex}
            </span>
          ))}
        </div>
      )}
      <button onClick={onAdd}
        className={`px-6 py-2.5 rounded-xl border text-sm font-medium transition-all backdrop-blur-sm ${meta.accentBtn}`}>
        + Add First {meta.entityLabel}
      </button>
    </div>
  );
}
