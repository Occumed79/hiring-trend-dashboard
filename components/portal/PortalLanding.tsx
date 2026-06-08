'use client';
import { useState } from 'react';
import type { Portal } from '@/lib/portals';
import WorldMap from '@/components/map/WorldMap';
import USAMap from '@/components/map/USAMap';

// ─── Portal config ─────────────────────────────────────────────────────────────
const PORTAL_META: Record<string, {
  gradient: string;
  accentColor: string;
  accentBg: string;
  description: string;
  entityLabel: string;
  metrics: { label: string; key: string; icon: string }[];
}> = {
  current_clients: {
    gradient: 'from-blue-600/30 via-blue-500/10 to-transparent',
    accentColor: 'text-blue-400',
    accentBg: 'bg-blue-500/20 border-blue-500/30',
    description: 'Track active client hiring activity, ATS coverage, and open role volume across your portfolio.',
    entityLabel: 'Client',
    metrics: [
      { label: 'Total Clients', key: 'total', icon: '🏢' },
      { label: 'Active Hiring', key: 'hiring', icon: '📋' },
      { label: 'Open Roles', key: 'roles', icon: '💼' },
      { label: 'New This Week', key: 'new_week', icon: '📈' },
    ],
  },
  prospects: {
    gradient: 'from-violet-600/30 via-violet-500/10 to-transparent',
    accentColor: 'text-violet-400',
    accentBg: 'bg-violet-500/20 border-violet-500/30',
    description: 'Monitor hiring signals from potential clients worldwide. Identify expansion opportunities and hiring surges.',
    entityLabel: 'Prospect',
    metrics: [
      { label: 'Total Prospects', key: 'total', icon: '🔭' },
      { label: 'Hiring Signal', key: 'hiring', icon: '📡' },
      { label: 'Open Roles', key: 'roles', icon: '💼' },
      { label: 'New This Week', key: 'new_week', icon: '📈' },
    ],
  },
  private_companies: {
    gradient: 'from-cyan-600/30 via-cyan-500/10 to-transparent',
    accentColor: 'text-cyan-400',
    accentBg: 'bg-cyan-500/20 border-cyan-500/30',
    description: 'Analyze private sector hiring across the US. Track workforce growth, role categories, and expansion signals.',
    entityLabel: 'Company',
    metrics: [
      { label: 'Companies', key: 'total', icon: '🏗️' },
      { label: 'Active Hiring', key: 'hiring', icon: '📋' },
      { label: 'Open Roles', key: 'roles', icon: '💼' },
      { label: 'New This Week', key: 'new_week', icon: '📈' },
    ],
  },
  federal_agencies: {
    gradient: 'from-amber-600/25 via-amber-500/8 to-transparent',
    accentColor: 'text-amber-400',
    accentBg: 'bg-amber-500/20 border-amber-500/30',
    description: 'Monitor federal agency hiring across all US departments. Track clearance-required roles, USAJOBS postings, and agency growth.',
    entityLabel: 'Agency',
    metrics: [
      { label: 'Federal Agencies', key: 'total', icon: '🦅' },
      { label: 'Active Hiring', key: 'hiring', icon: '📋' },
      { label: 'Open Roles', key: 'roles', icon: '💼' },
      { label: 'Security Roles', key: 'security', icon: '🔒' },
    ],
  },
  state_agencies: {
    gradient: 'from-emerald-600/25 via-emerald-500/8 to-transparent',
    accentColor: 'text-emerald-400',
    accentBg: 'bg-emerald-500/20 border-emerald-500/30',
    description: 'Track state government hiring across all 50 states. Monitor public sector workforce trends and budget-driven hiring cycles.',
    entityLabel: 'Agency',
    metrics: [
      { label: 'State Agencies', key: 'total', icon: '🏛️' },
      { label: 'Active Hiring', key: 'hiring', icon: '📋' },
      { label: 'Open Roles', key: 'roles', icon: '💼' },
      { label: 'New This Week', key: 'new_week', icon: '📈' },
    ],
  },
  counties_and_cities: {
    gradient: 'from-rose-600/25 via-rose-500/8 to-transparent',
    accentColor: 'text-rose-400',
    accentBg: 'bg-rose-500/20 border-rose-500/30',
    description: 'Analyze hiring at the county and municipal level. Identify local government workforce expansion across cities and counties.',
    entityLabel: 'Municipality',
    metrics: [
      { label: 'Municipalities', key: 'total', icon: '🏙️' },
      { label: 'Active Hiring', key: 'hiring', icon: '📋' },
      { label: 'Open Roles', key: 'roles', icon: '💼' },
      { label: 'New This Week', key: 'new_week', icon: '📈' },
    ],
  },
};

// ─── Main component ────────────────────────────────────────────────────────────
export default function PortalLanding({
  portal,
  entities,
  loading,
  onSelectEntity,
  onAddEntity,
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

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">

      {/* ── Hero header card ─────────────────────────────────────────────── */}
      <div className={`relative overflow-hidden rounded-2xl border border-white/12`}
        style={{ background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(24px)' }}>
        {/* gradient wash */}
        <div className={`absolute inset-0 bg-gradient-to-r ${meta.gradient} pointer-events-none`} />
        {/* shimmer line */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />

        <div className="relative z-10 p-8 flex items-start justify-between gap-6 flex-wrap">
          <div className="flex items-center gap-5">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl ${meta.accentBg} border`}
              style={{ backdropFilter: 'blur(12px)' }}>
              {portal.icon}
            </div>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl font-bold text-white tracking-tight">{portal.label}</h1>
                <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${meta.accentBg} ${meta.accentColor}`}>
                  {totalEntities} {totalEntities === 1 ? meta.entityLabel : meta.entityLabel + 's'}
                </span>
              </div>
              <p className="text-slate-400 text-sm max-w-xl leading-relaxed">{meta.description}</p>
            </div>
          </div>

          <button
            onClick={onAddEntity}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl border font-medium text-sm transition-all hover:scale-105 ${meta.accentBg} ${meta.accentColor}`}
            style={{ backdropFilter: 'blur(12px)' }}>
            <span className="text-base">+</span>
            Add {meta.entityLabel}
          </button>
        </div>
      </div>

      {/* ── Metric cards row ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {meta.metrics.map((m, i) => {
          const val = i === 0 ? totalEntities : i === 1 ? hiringEntities : 0;
          return (
            <MetricCard
              key={m.key}
              icon={m.icon}
              label={m.label}
              value={loading ? null : val}
              accentColor={meta.accentColor}
            />
          );
        })}
      </div>

      {/* ── Map + Role split ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          {useWorldMap
            ? <WorldMap portalId={portal.id} />
            : <USAMap portalId={portal.id} title={`${portal.label} — Hiring Map`} />
          }
        </div>
        <div>
          <RoleBreakdownCard portalId={portal.id} />
        </div>
      </div>

      {/* ── Entity table card ─────────────────────────────────────────────── */}
      <EntityTableCard
        entities={entities}
        loading={loading}
        meta={meta}
        onSelect={onSelectEntity}
        onAdd={onAddEntity}
        portal={portal}
      />

    </div>
  );
}

// ─── Metric Card ───────────────────────────────────────────────────────────────
function MetricCard({ icon, label, value, accentColor }: {
  icon: string; label: string; value: number | null; accentColor: string;
}) {
  return (
    <div className="glass-card p-5 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <div className="flex items-start justify-between mb-3">
        <span className="text-2xl">{icon}</span>
        {value !== null && value > 0 && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-400`}>
            Active
          </span>
        )}
      </div>
      <div className={`text-3xl font-bold tracking-tight mb-1 ${value === null ? 'text-slate-600' : value === 0 ? 'text-slate-500' : accentColor}`}>
        {value === null ? (
          <div className="h-8 w-12 bg-white/8 rounded animate-pulse" />
        ) : (
          value.toLocaleString()
        )}
      </div>
      <p className="text-xs text-slate-500 font-medium">{label}</p>
    </div>
  );
}

// ─── Role Breakdown Card ───────────────────────────────────────────────────────
const ROLE_COLORS: Record<string, string> = {
  security:    'bg-red-500',
  logistics:   'bg-orange-500',
  medical:     'bg-emerald-500',
  engineering: 'bg-blue-500',
  admin:       'bg-purple-500',
  aviation:    'bg-sky-500',
  remote:      'bg-teal-500',
  other:       'bg-slate-500',
};

function RoleBreakdownCard({ portalId }: { portalId: string }) {
  const placeholders = [
    { label: 'Security / Defense', pct: 0 },
    { label: 'Medical / Health', pct: 0 },
    { label: 'Logistics', pct: 0 },
    { label: 'Engineering', pct: 0 },
    { label: 'Administrative', pct: 0 },
    { label: 'Other', pct: 0 },
  ];

  return (
    <div className="glass-card p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-200">Role Breakdown</h3>
        <span className="text-[10px] text-slate-600 bg-white/5 px-2 py-0.5 rounded-full border border-white/8">
          By category
        </span>
      </div>

      <div className="space-y-3 flex-1">
        {placeholders.map((r, i) => (
          <div key={i}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-400">{r.label}</span>
              <span className="text-xs text-slate-600">—</span>
            </div>
            <div className="h-1.5 bg-white/6 rounded-full overflow-hidden">
              <div className="h-full bg-white/15 rounded-full w-0 transition-all duration-700" />
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-slate-600 mt-4 text-center">
        Data populates after first ingest
      </p>
    </div>
  );
}

// ─── Entity Table Card ─────────────────────────────────────────────────────────
function EntityTableCard({ entities, loading, meta, onSelect, onAdd, portal }: {
  entities: any[];
  loading: boolean;
  meta: typeof PORTAL_META[string];
  onSelect: (e: any) => void;
  onAdd: () => void;
  portal: Portal;
}) {
  const [search, setSearch] = useState('');
  const filtered = entities.filter(e =>
    e.name?.toLowerCase().includes(search.toLowerCase()) ||
    e.industry?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="glass-card overflow-hidden">
      {/* Card header */}
      <div className="px-6 py-4 border-b border-white/8 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">{meta.entityLabel} Registry</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {entities.length} tracked {entities.length === 1 ? meta.entityLabel.toLowerCase() : meta.entityLabel.toLowerCase() + 's'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {entities.length > 0 && (
            <div className="relative">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={`Search ${meta.entityLabel.toLowerCase()}s…`}
                className="bg-white/6 border border-white/12 rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/40 w-48"
              />
            </div>
          )}
          <button
            onClick={onAdd}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border text-xs font-medium transition-all hover:scale-105 ${meta.accentBg} ${meta.accentColor}`}>
            + Add {meta.entityLabel}
          </button>
        </div>
      </div>

      {/* Table body */}
      {loading ? (
        <div className="p-6 space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-12 bg-white/5 rounded-xl animate-pulse" style={{ opacity: 1 - i * 0.2 }} />
          ))}
        </div>
      ) : entities.length === 0 ? (
        <EmptyTableState meta={meta} portal={portal} onAdd={onAdd} />
      ) : filtered.length === 0 ? (
        <div className="p-8 text-center text-slate-500 text-sm">No results for "{search}"</div>
      ) : (
        <div className="divide-y divide-white/5">
          {/* Column headers */}
          <div className="px-6 py-2.5 grid grid-cols-12 gap-4 text-[10px] font-medium text-slate-600 uppercase tracking-wider">
            <div className="col-span-4">Name</div>
            <div className="col-span-2">Industry</div>
            <div className="col-span-2">ATS</div>
            <div className="col-span-2">Open Roles</div>
            <div className="col-span-2 text-right">Action</div>
          </div>
          {filtered.map(entity => (
            <div
              key={entity.id}
              className="px-6 py-3.5 grid grid-cols-12 gap-4 items-center hover:bg-white/4 transition-colors cursor-pointer group"
              onClick={() => onSelect(entity)}
            >
              <div className="col-span-4 flex items-center gap-3">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${meta.accentBg} border`}>
                  {entity.name?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-100 truncate group-hover:text-white">{entity.name}</p>
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
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/8 border border-white/12 text-slate-400">
                    {entity.ats_provider}
                  </span>
                ) : (
                  <span className="text-xs text-slate-600">—</span>
                )}
              </div>
              <div className="col-span-2">
                <span className="text-xs text-slate-500">—</span>
              </div>
              <div className="col-span-2 flex justify-end">
                <span className={`text-[10px] px-2.5 py-1 rounded-lg border opacity-0 group-hover:opacity-100 transition-opacity ${meta.accentBg} ${meta.accentColor}`}>
                  View →
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Empty state (inside table card) ─────────────────────────────────────────
function EmptyTableState({ meta, portal, onAdd }: {
  meta: typeof PORTAL_META[string]; portal: Portal; onAdd: () => void;
}) {
  const suggestions: Record<string, string[]> = {
    current_clients:    ['Acme Medical Group', 'Summit Healthcare', 'Nexus Defense'],
    prospects:          ['Orbital Systems', 'Pinnacle Health', 'Atlas Logistics'],
    private_companies:  ['BlackRock Inc.', 'Lockheed Martin', 'Northrop Grumman'],
    federal_agencies:   ['Department of Defense', 'VA Health', 'DHS'],
    state_agencies:     ['CA Dept of Public Health', 'TX DPS', 'FL Dept of Health'],
    counties_and_cities:['Los Angeles County', 'Cook County', 'City of Houston'],
  };
  const examples = suggestions[portal.id] ?? [];

  return (
    <div className="p-10 flex flex-col items-center gap-6">
      {/* Large icon */}
      <div className={`w-20 h-20 rounded-2xl flex items-center justify-center text-4xl ${meta.accentBg} border`}
        style={{ backdropFilter: 'blur(12px)' }}>
        {portal.icon}
      </div>

      <div className="text-center">
        <p className="text-slate-200 font-semibold text-base mb-1">No {meta.entityLabel}s yet</p>
        <p className="text-slate-500 text-sm max-w-sm">
          Add your first {meta.entityLabel.toLowerCase()} to start tracking hiring trends, open roles, and market signals.
        </p>
      </div>

      {/* Example chips */}
      {examples.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap justify-center">
          <span className="text-xs text-slate-600">e.g.</span>
          {examples.map(ex => (
            <span key={ex} className="text-xs px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-400">
              {ex}
            </span>
          ))}
        </div>
      )}

      <button
        onClick={onAdd}
        className={`flex items-center gap-2 px-6 py-3 rounded-xl border font-medium text-sm transition-all hover:scale-105 ${meta.accentBg} ${meta.accentColor}`}
        style={{ backdropFilter: 'blur(12px)' }}>
        <span className="text-base">+</span>
        Add First {meta.entityLabel}
      </button>
    </div>
  );
}
