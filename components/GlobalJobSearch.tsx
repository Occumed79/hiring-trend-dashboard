'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, ExternalLink, Activity } from 'lucide-react';

const QUICK_SEARCHES = [
  'respirator fit testing',
  'hearing conservation',
  'deployment OCONUS',
  'DOT CDL',
  'medical surveillance',
  'safety sensitive',
];

export default function GlobalJobSearch() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<any>({ hits: [], nbHits: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResult((current: any) => ({ ...current, hits: [], nbHits: 0, query: '' }));
      setLoading(false);
      setError('');
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/api/search/jobs?q=${encodeURIComponent(trimmed)}&limit=60`, { signal: controller.signal });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error || 'Search request failed.');
        setResult(body || { hits: [], nbHits: 0 });
      } catch (err) {
        if ((err as any)?.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Search request failed.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 260);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const hits = Array.isArray(result?.hits) ? result.hits : [];
  const employers = useMemo(() => new Set(hits.map((hit: any) => hit.entity_name).filter(Boolean)).size, [hits]);

  return (
    <div className="min-h-full p-5 lg:p-6 max-w-[1500px] mx-auto space-y-5">
      <section className="glass-card-hero luminous-panel relative overflow-hidden p-5 lg:p-6">
        <div className="shimmer-top" />
        <div className="aurora-sweep" />
        <div className="relative z-10">
          <div className="flex items-start justify-between gap-5 flex-wrap">
            <div>
              <div className="flex items-center gap-2.5">
                <Search size={18} className="text-blue-300" strokeWidth={1.8} />
                <h1 className="text-[26px] lg:text-[30px] font-semibold text-white tracking-tight">Global Hiring Search</h1>
              </div>
              <p className="text-xs text-slate-500 mt-2 max-w-2xl">
                Search every tracked employer, open role, location, role category, and Clarifai occupational-health signal from one place.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.035] px-3.5 py-3 min-w-[150px]">
              <p className="text-[9px] uppercase tracking-[0.13em] text-slate-500">Search engine</p>
              <p className="text-sm font-semibold text-slate-200 mt-1">Algolia</p>
              <p className="text-[9px] text-slate-600 mt-0.5">live job index</p>
            </div>
          </div>

          <div className="relative mt-5">
            <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" strokeWidth={1.8} />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search Boeing mechanics, Kuwait, respirator fit testing, CDL, audiograms..."
              className="w-full rounded-2xl border border-white/12 bg-[#07101f]/70 pl-11 pr-4 py-4 text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-blue-400/45 focus:ring-2 focus:ring-blue-500/10 transition-all"
              autoFocus
            />
            {loading && <span className="absolute right-4 top-1/2 -translate-y-1/2 inline-block w-4 h-4 border-2 border-blue-300 border-t-transparent rounded-full animate-spin" />}
          </div>

          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {QUICK_SEARCHES.map(term => (
              <button
                key={term}
                onClick={() => setQuery(term)}
                className="text-[10px] px-2.5 py-1.5 rounded-full border border-white/10 bg-white/[0.035] text-slate-400 hover:text-blue-200 hover:border-blue-400/25 hover:bg-blue-500/8 transition-all"
              >
                {term}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error && <div className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>}

      {!query.trim() ? (
        <section className="glass-card luminous-panel p-6">
          <div className="flex items-start gap-3">
            <Activity size={17} className="text-blue-300 mt-0.5" strokeWidth={1.8} />
            <div>
              <h2 className="text-sm font-semibold text-slate-200">Search the intelligence layer, not just job titles</h2>
              <p className="text-xs text-slate-500 mt-1.5 max-w-3xl leading-relaxed">
                Searches can include employers, locations, existing role categories, and occupational-health concepts such as hearing conservation, respirator use, DOT/CDL, deployment, medical surveillance, drug testing, and safety-sensitive work.
              </p>
            </div>
          </div>
        </section>
      ) : result?.configured === false ? (
        <section className="glass-card luminous-panel p-6 text-sm text-amber-200">
          Algolia is wired in the app, but the Algolia Application ID and API keys still need to be added to the Render environment.
        </section>
      ) : result?.warming ? (
        <section className="glass-card luminous-panel p-6 text-sm text-slate-300">
          The Algolia index is ready to populate. Refresh an employer or let the scheduled ingest run once to build the first search records.
        </section>
      ) : (
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-slate-500">
              {loading ? 'Searching…' : `${Number(result?.nbHits || hits.length).toLocaleString()} matches · ${employers.toLocaleString()} employers shown`}
            </p>
            {Number(result?.processingTimeMS || 0) > 0 && <p className="text-[10px] text-slate-700">{result.processingTimeMS} ms</p>}
          </div>

          {!loading && hits.length === 0 ? (
            <div className="glass-card p-8 text-center text-sm text-slate-600">No matching active jobs.</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {hits.map((hit: any) => <SearchResultCard key={hit.objectID || hit.job_id} hit={hit} />)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function SearchResultCard({ hit }: { hit: any }) {
  const signals = Array.isArray(hit.occupational_health_signals) ? hit.occupational_health_signals.slice(0, 3) : [];
  const score = Number(hit.occupational_health_score || 0);
  const location = [hit.city, hit.state, hit.country].filter(Boolean).join(', ') || hit.location || 'Location not listed';

  return (
    <article className="glass-card luminous-panel p-4.5 border border-white/[0.08] hover:border-blue-400/20 transition-all">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.12em] text-blue-300/80 truncate">{hit.entity_name || 'Unknown employer'}</p>
          <h3 className="text-sm font-semibold text-slate-100 mt-1.5 leading-snug">{hit.title || 'Untitled role'}</h3>
          <p className="text-[11px] text-slate-500 mt-1.5">{location}</p>
        </div>
        {score > 0 && (
          <div className="shrink-0 rounded-xl border border-blue-400/20 bg-blue-500/8 px-2.5 py-2 text-center min-w-[58px]">
            <p className="text-base font-semibold text-blue-100">{score}</p>
            <p className="text-[8px] uppercase tracking-[0.1em] text-slate-600">OH score</p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap mt-3">
        {hit.role_category && <Tag>{String(hit.role_category).replace(/_/g, ' ')}</Tag>}
        {hit.portal && <Tag>{formatPortal(hit.portal)}</Tag>}
        {hit.is_remote && <Tag>remote</Tag>}
        {hit.is_overseas && <Tag>overseas</Tag>}
      </div>

      {signals.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
          {signals.map((signal: string) => <span key={signal} className="text-[9px] px-2 py-1 rounded-full border border-emerald-400/15 bg-emerald-500/7 text-emerald-200/80">{signal}</span>)}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mt-3.5 pt-3 border-t border-white/[0.07]">
        <p className="text-[9px] text-slate-700 truncate">{hit.source || 'source unavailable'}</p>
        {hit.apply_url && (
          <a href={hit.apply_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] text-blue-300 hover:text-blue-200">
            Open posting <ExternalLink size={10} />
          </a>
        )}
      </div>
    </article>
  );
}

function Tag({ children }: { children: any }) {
  return <span className="text-[9px] px-2 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-slate-500 capitalize">{children}</span>;
}

function formatPortal(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}
