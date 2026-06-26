'use client';

export default function OpenRolesList({ rows, loading }: { rows: any[]; loading: boolean }) {
  const safeRows = Array.isArray(rows) ? rows : [];

  return (
    <div className="glass-card luminous-panel p-5">
      <div className="shimmer-top" />
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-100">Open Roles</h3>
        <span className="text-[10px] text-slate-500">{safeRows.length} shown</span>
      </div>
      {loading ? <p className="text-xs text-slate-500">Loading roles...</p> : safeRows.length === 0 ? (
        <p className="text-xs text-slate-500">No roles are available for this company yet.</p>
      ) : (
        <div className="divide-y divide-white/8">
          {safeRows.slice(0, 100).map(row => (
            <div key={row.id} className="py-3 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-slate-100 font-medium truncate">{row.title}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{[row.location, row.source].filter(Boolean).join(' · ')}</p>
              </div>
              {row.url && <a href={row.url} target="_blank" rel="noreferrer" className="text-xs text-blue-300 hover:text-blue-200 shrink-0">Open</a>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
