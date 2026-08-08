'use client';

type SourceRow = {
  source: string;
  source_class?: string;
  status?: string;
  jobs_found?: number;
  authoritative_zero?: boolean;
  details?: Record<string, any>;
  last_checked_at?: string | null;
  last_success_at?: string | null;
};

export default function SourceCoveragePanel({ rows, registry, loading }: {
  rows?: SourceRow[] | null;
  registry?: { id?: string | null; type?: string | null; state?: string | null; fips?: string | null } | null;
  loading?: boolean;
}) {
  const normalized = Array.isArray(rows) ? rows : [];
  if (!loading && !registry && !normalized.length) return null;

  const authoritative = normalized.filter(row => row.source_class === 'authoritative');
  const verified = normalized.filter(row => row.source_class === 'verified');
  const supplemental = normalized.filter(row => row.source_class !== 'authoritative' && row.source_class !== 'verified');
  const healthy = normalized.filter(row => row.status === 'success' || row.status === 'zero').length;
  const problems = normalized.filter(row => row.status === 'error').length;

  return (
    <section className="glass-card luminous-panel relative overflow-hidden p-5">
      <div className="shimmer-top" />
      <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-[15px] font-semibold text-slate-100">Source Coverage</h2>
            {!loading && normalized.length > 0 && (
              <span className="rounded-full border border-emerald-400/20 bg-emerald-500/8 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-200">
                {healthy}/{normalized.length} checked cleanly
              </span>
            )}
            {!loading && problems > 0 && (
              <span className="rounded-full border border-amber-400/25 bg-amber-500/8 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-amber-200">
                {problems} source{problems === 1 ? '' : 's'} need attention
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            Independent sources are checked separately, deduplicated, and ranked by authority. A verified zero means the source was reached successfully and currently reports no openings.
          </p>
        </div>
        {registry && (
          <div className="rounded-xl border border-cyan-300/15 bg-cyan-400/[0.055] px-3 py-2 text-right">
            <p className="text-[9px] uppercase tracking-[0.13em] text-cyan-200/70">Census government identity</p>
            <p className="mt-1 text-[10px] text-slate-300">{formatRegistry(registry)}</p>
          </div>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {[0,1,2].map(index => <div key={index} className="h-[74px] rounded-xl border border-white/5 bg-white/[0.035] animate-pulse" />)}
        </div>
      ) : normalized.length ? (
        <div className="space-y-4">
          <SourceGroup title="Authoritative" rows={authoritative} />
          <SourceGroup title="Verified" rows={verified} />
          <SourceGroup title="Supplemental" rows={supplemental} />
        </div>
      ) : (
        <div className="rounded-xl border border-white/8 bg-white/[0.025] px-4 py-3 text-[11px] text-slate-500">
          Source checks will appear after the next completed intelligence refresh.
        </div>
      )}
    </section>
  );
}

function SourceGroup({ title, rows }: { title: string; rows: SourceRow[] }) {
  if (!rows.length) return null;
  return (
    <div>
      <p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-600">{title}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
        {rows.map(row => <SourceTile key={row.source} row={row} />)}
      </div>
    </div>
  );
}

function SourceTile({ row }: { row: SourceRow }) {
  const status = String(row.status || 'unknown').toLowerCase();
  const statusClass = status === 'success'
    ? 'border-emerald-400/20 bg-emerald-500/[0.055] text-emerald-200'
    : status === 'zero'
      ? 'border-cyan-400/20 bg-cyan-500/[0.055] text-cyan-200'
      : status === 'error'
        ? 'border-amber-400/25 bg-amber-500/[0.055] text-amber-200'
        : 'border-white/10 bg-white/[0.03] text-slate-400';
  const jobs = Math.max(0, Number(row.jobs_found || 0));

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.025] px-3.5 py-3 min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-medium text-slate-200" title={row.source}>{sourceLabel(row.source)}</p>
          <p className="mt-1 truncate text-[9px] text-slate-600" title={sourceDetail(row)}>{sourceDetail(row)}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] ${statusClass}`}>
          {status === 'zero' && row.authoritative_zero ? 'verified zero' : status}
        </span>
      </div>
      <div className="mt-2.5 flex items-end justify-between gap-3">
        <div>
          <span className="text-[18px] leading-none font-semibold text-blue-100">{jobs.toLocaleString()}</span>
          <span className="ml-1.5 text-[9px] uppercase tracking-[0.1em] text-slate-600">jobs</span>
        </div>
        <span className="text-[9px] text-slate-600">{formatChecked(row.last_checked_at)}</span>
      </div>
    </div>
  );
}

function sourceLabel(source: string) {
  const labels: Record<string,string> = {
    'registry:census_governments': 'U.S. Census Government Registry',
    'gov:neogov_rss': 'NEOGOV / GovernmentJobs',
    'nlx': 'National Labor Exchange',
    'board:naco': 'NACo Career Center',
    'board:icma': 'ICMA Job Center',
    'board:careersingovernment': 'Careers in Government',
    'usajobs': 'USAJOBS',
    'career_page': 'Official Career Page',
    'web:langsearch': 'Verified Web Discovery',
    'adzuna': 'Adzuna',
  };
  const normalized = String(source || '').toLowerCase();
  if (labels[normalized]) return labels[normalized];
  if (normalized.startsWith('ats:')) return `${titleCase(normalized.slice(4).replace(/_/g,' '))} ATS`;
  if (normalized.startsWith('portal:')) return titleCase(normalized.slice(7).replace(/_/g,' '));
  if (normalized.startsWith('gov:')) return titleCase(normalized.slice(4).replace(/_/g,' '));
  if (normalized.startsWith('jobapi:')) return titleCase(normalized.slice(7).replace(/_/g,' '));
  return titleCase(normalized.replace(/[_:]/g,' '));
}

function sourceDetail(row: SourceRow) {
  const details = row.details || {};
  if (row.source === 'registry:census_governments') return [details.government_type, details.government_state, details.government_fips ? `FIPS ${details.government_fips}` : null].filter(Boolean).join(' · ') || 'Authoritative government identity';
  if (details.agency) return `Agency ${details.agency}`;
  if (details.board) return details.board;
  if (details.state) return `State filter: ${details.state}`;
  if (details.reason) return String(details.reason);
  if (details.error) return String(details.error);
  return row.source_class === 'authoritative' ? 'Primary source' : row.source_class === 'verified' ? 'Verified source' : 'Corroborating source';
}

function formatRegistry(registry: { id?: string | null; type?: string | null; state?: string | null; fips?: string | null }) {
  return [registry.type ? titleCase(registry.type.replace(/_/g,' ')) : null, registry.state, registry.fips ? `FIPS ${registry.fips}` : null].filter(Boolean).join(' · ') || registry.id || 'Resolved';
}
function formatChecked(value?: string | null) { if (!value) return 'not checked'; const date = new Date(value); if (Number.isNaN(date.getTime())) return 'checked'; return `checked ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`; }
function titleCase(value: string) { return value.replace(/\b\w/g, character => character.toUpperCase()); }
