'use client';

export default function CompanyRegistry({ entities, loading, onSelect, onAdd }: {
  entities: any[];
  loading: boolean;
  onSelect: (e: any) => void;
  onAdd: () => void;
}) {
  return (
    <div className="glass-card luminous-panel p-5 min-h-[390px]">
      <div className="shimmer-top" />
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-100">Tracked Companies</h3>
        <button onClick={onAdd} className="text-[11px] px-3 py-1.5 rounded-xl border border-blue-400/30 text-blue-200 bg-blue-500/10 hover:bg-blue-500/20">Add</button>
      </div>
      {loading ? <p className="text-xs text-slate-500">Loading...</p> : entities.length === 0 ? (
        <p className="text-xs text-slate-500">No tracked companies match this view.</p>
      ) : (
        <div className="space-y-2 max-h-[310px] overflow-y-auto scrollbar-glass pr-1">
          {entities.map(entity => (
            <button key={entity.id} onClick={() => onSelect(entity)} className="w-full text-left p-3 rounded-xl border border-white/8 bg-white/[0.035] hover:border-blue-300/25 hover:bg-blue-500/10 transition-all">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-100 truncate">{entity.name}</p>
                  <p className="text-[11px] text-slate-500 truncate">{entity.ats_provider && entity.ats_provider !== 'unknown' ? entity.ats_provider : 'source discovery'}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-blue-200">{Number(entity.open_jobs || 0).toLocaleString()}</p>
                  <p className="text-[9px] uppercase tracking-wide text-slate-600">open</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
