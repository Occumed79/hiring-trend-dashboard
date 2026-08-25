'use client';
import { useMemo, useState } from 'react';

const US_STATE_CODES = new Set('AL AK AZ AR CA CO CT DC DE FL GA HI IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY'.split(' '));

export default function OpenRolesList({ rows, loading, totalRows }: { rows: any[]; loading: boolean; totalRows?: number }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const total = Number.isFinite(totalRows) ? Math.max(Number(totalRows), safeRows.length) : safeRows.length;
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [source, setSource] = useState('all');

  const categories = useMemo(() => Array.from(new Set(safeRows.map(row => row.role_category).filter(Boolean))).sort(), [safeRows]);
  const sources = useMemo(() => Array.from(new Set(safeRows.map(row => row.source).filter(Boolean))).sort(), [safeRows]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return safeRows.filter(row => {
      if (category !== 'all' && row.role_category !== category) return false;
      if (source !== 'all' && row.source !== source) return false;
      if (!q) return true;
      return `${row.title || ''} ${displayLocation(row)} ${row.department || ''} ${row.source || ''}`.toLowerCase().includes(q);
    });
  }, [safeRows, search, category, source]);

  const inventoryLabel = total > safeRows.length ? `${safeRows.length.toLocaleString()} loaded of ${total.toLocaleString()} verified` : `${filtered.length.toLocaleString()} of ${safeRows.length.toLocaleString()}`;

  return (
    <div className="glass-card luminous-panel p-5 lg:p-6 relative overflow-hidden">
      <div className="shimmer-top" />
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div><h3 className="text-[15px] font-semibold text-slate-100">Open Roles</h3><p className="text-[10px] text-slate-500 mt-1">Search the loaded verified posting set and open the original employer/ATS listing.</p></div>
        <span className="text-[10px] text-slate-500 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">{inventoryLabel}</span>
      </div>

      {total > safeRows.length && <div className="mb-3 rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2 text-[10px] text-slate-500">This company has a large verified inventory. The list loads the newest {safeRows.length.toLocaleString()} roles for responsive browsing; headline metrics and breakdowns use the full verified set.</div>}

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_180px_190px] gap-2.5 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title, location, department, source…" className="rounded-xl border border-white/10 bg-white/[0.045] px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-600 outline-none focus:border-blue-300/40" />
        <select value={category} onChange={e => setCategory(e.target.value)} className="rounded-xl border border-white/10 bg-[#0b1223] px-3 py-2.5 text-xs text-slate-300 outline-none focus:border-blue-300/40"><option value="all">All categories</option>{categories.map(value => <option key={value} value={value}>{label(value)}</option>)}</select>
        <select value={source} onChange={e => setSource(e.target.value)} className="rounded-xl border border-white/10 bg-[#0b1223] px-3 py-2.5 text-xs text-slate-300 outline-none focus:border-blue-300/40"><option value="all">All sources</option>{sources.map(value => <option key={value} value={value}>{value}</option>)}</select>
      </div>

      {loading ? (
        <div className="space-y-2">{[0,1,2,3,4].map(i => <div key={i} className="h-[62px] rounded-xl bg-white/[0.035] animate-pulse" style={{ opacity: 1 - i * 0.12 }} />)}</div>
      ) : safeRows.length === 0 ? (
        <Empty title="No active roles yet" text="The first ingest may still be running, or the authoritative source currently has no published openings." />
      ) : filtered.length === 0 ? (
        <Empty title="No roles match these filters" text="Clear the search or broaden the category/source filters." />
      ) : (
        <div className="divide-y divide-white/8 max-h-[720px] overflow-y-auto scrollbar-glass pr-1">
          {filtered.map(row => (
            <div key={row.id} className="py-3.5 px-1 flex items-start justify-between gap-4 group">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap"><p className="text-[13px] text-slate-100 font-semibold truncate max-w-full">{row.title}</p>{row.role_category && <span className="text-[9px] uppercase tracking-[0.11em] rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-slate-500">{label(row.role_category)}</span>}</div>
                <div className="flex items-center gap-x-2.5 gap-y-1 mt-1.5 flex-wrap text-[10px] text-slate-500"><span>{displayLocation(row)}</span><span className="text-slate-700">•</span><span>{row.source || 'Unknown source'}</span>{row.posted_at && <><span className="text-slate-700">•</span><span>{formatDate(row.posted_at)}</span></>}</div>
              </div>
              {row.url ? <a href={row.url} target="_blank" rel="noreferrer" className="text-[11px] font-medium text-blue-200 border border-blue-400/25 bg-blue-500/8 hover:bg-blue-500/18 rounded-lg px-2.5 py-1.5 shrink-0 transition-all">Open ↗</a> : <span className="text-[9px] text-slate-700 shrink-0">No direct URL</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function displayLocation(row: any) {
  const state = String(row?.state || '').trim().toUpperCase();
  const city = clean(row?.city);
  const country = String(row?.country || '').trim().toUpperCase();
  const raw = clean(row?.location);
  const looksBlob = raw.length > 180 || (raw.match(/,/g) || []).length >= 5 || (raw.match(/[|;•]/g) || []).length >= 3;
  if (city && US_STATE_CODES.has(state)) return `${city}, ${state}`;
  const structured = [city, clean(row?.state), country].filter(Boolean).join(', ');
  if (looksBlob) return structured || 'Location not reliably supplied';
  return raw || structured || 'Location not supplied';
}
function clean(value: unknown) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function Empty({ title, text }: { title: string; text: string }) { return <div className="py-12 text-center"><p className="text-sm font-medium text-slate-300">{title}</p><p className="text-[11px] text-slate-500 mt-1.5">{text}</p></div>; }
function label(value: string) { return String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase()); }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }); }
