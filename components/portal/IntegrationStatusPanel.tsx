'use client';

type Integration = {
  configured?: boolean;
  monitored?: boolean;
  mode?: string;
  detail?: string;
  status?: string;
};

type IntegrationMap = Record<string, Integration | undefined>;

const ORDER = ['theirstack', 'theirstack_dataset', 'theirstack_export', 'keenable', 'algolia', 'clarifai', 'groq', 'langsearch', 'nlx', 'careeronestop'];
const LABELS: Record<string, string> = {
  theirstack: 'TheirStack Company Search',
  theirstack_dataset: 'TheirStack Jobs Dataset',
  theirstack_export: 'TheirStack Bulk Export',
  keenable: 'Keenable',
  algolia: 'Algolia Search',
  clarifai: 'Clarifai',
  groq: 'Groq Fallback',
  langsearch: 'LangSearch',
  nlx: 'National Labor Exchange',
  careeronestop: 'CareerOneStop',
};

export default function IntegrationStatusPanel({ integrations }: { integrations?: IntegrationMap | null }) {
  const map = integrations || {};
  const rows = ORDER.map(id => ({ id, ...(map[id] || {}) }));
  const configured = rows.filter(row => row.configured).length;

  return (
    <section className="glass-card luminous-panel relative overflow-hidden p-5">
      <div className="shimmer-top" />
      <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-100">Intelligence Integrations</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">Actual server-side integration state for this entity. This is separate from whether a source happened to return jobs on the latest check.</p>
        </div>
        <span className="rounded-full border border-blue-400/20 bg-blue-500/8 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-blue-200">{configured}/{rows.length} active / available</span>
      </div>

      <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
        {rows.map(row => {
          const active = Boolean(row.configured);
          const theirStackTargeted = row.id !== 'theirstack' || Boolean(row.monitored);
          const state = row.status || (active && theirStackTargeted ? 'configured' : row.id === 'theirstack' && active ? 'not targeted' : 'not configured');
          return (
            <div key={row.id} className="rounded-xl border border-white/8 bg-white/[0.025] px-3.5 py-3 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <p className="truncate text-[12px] font-medium text-slate-200">{LABELS[row.id] || row.id}</p>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.09em] ${statusClass(state)}`}>{state}</span>
              </div>
              <p className="mt-2 text-[9px] leading-relaxed text-slate-600 min-h-[28px]">{row.mode || row.detail || defaultDetail(row.id)}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function statusClass(state: string) {
  if (state === 'configured' || state === 'available') return 'border-emerald-400/20 bg-emerald-500/8 text-emerald-200';
  if (state === 'not targeted') return 'border-cyan-400/20 bg-cyan-500/8 text-cyan-200';
  if (state === 'not entitled') return 'border-amber-400/20 bg-amber-500/8 text-amber-200';
  if (state === 'check error') return 'border-red-400/20 bg-red-500/8 text-red-200';
  return 'border-white/10 bg-white/[0.03] text-slate-500';
}

function defaultDetail(id: string) {
  const details: Record<string, string> = {
    theirstack: 'Credit-aware employer monitoring using Company Search hiring-volume signals and sample jobs.',
    theirstack_dataset: 'Checks whether any configured TheirStack workspace is entitled to the bulk Jobs Dataset.',
    theirstack_export: 'Company-credit Job Export receiver for high-volume gap filling; separate from per-job Job Search API polling.',
    keenable: 'Supplemental employer-specific web discovery.',
    algolia: 'Fast global job index with live database safety net.',
    clarifai: 'Primary occupational-health signal enrichment.',
    groq: 'Fallback occupational-health enrichment when Clarifai cannot run.',
    langsearch: 'Verified web discovery and source corroboration.',
    nlx: 'National Labor Exchange verification layer.',
    careeronestop: 'CareerOneStop job verification layer.',
  };
  return details[id] || 'Integration status.';
}
