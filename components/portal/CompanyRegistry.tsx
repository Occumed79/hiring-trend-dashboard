'use client';

export default function CompanyRegistry({ entities, loading, onSelect, onAdd }: {
  entities: any[];
  loading: boolean;
  onSelect: (e: any) => void;
  onAdd: () => void;
}) {
  return (
    <div className="glass-card luminous-panel p-5 h-full min-h-[520px] flex flex-col overflow-hidden">
      <div className="shimmer-top" />
      <div className="flex items-center justify-between gap-3 mb-4 shrink-0">
        <div>
          <h3 className="text-[15px] font-semibold text-slate-100">Tracked Companies</h3>
          <p className="text-[10px] text-slate-500 mt-0.5">Select a company to open hiring intelligence.</p>
        </div>
        <button
          onClick={onAdd}
          className="text-[11px] px-3.5 py-1.5 rounded-xl border border-blue-400/40 text-blue-100 bg-blue-500/10 hover:bg-blue-500/20 hover:border-blue-300/50 transition-all shrink-0"
        >
          Add
        </button>
      </div>

      {loading ? (
        <div className="space-y-2.5 flex-1">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-[68px] rounded-xl border border-white/5 bg-white/[0.035] animate-pulse" style={{ opacity: 1 - i * 0.16 }} />
          ))}
        </div>
      ) : entities.length === 0 ? (
        <div className="flex-1 min-h-[260px] flex items-center justify-center text-center px-6">
          <div>
            <div className="mx-auto mb-3 w-10 h-10 rounded-2xl border border-white/10 bg-white/[0.04] flex items-center justify-center text-slate-500 text-lg">⌕</div>
            <p className="text-sm font-medium text-slate-300">No companies in this view</p>
            <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">Clear the search or track another company.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5 overflow-y-auto scrollbar-glass pr-1 flex-1 min-h-0">
          {entities.map(entity => {
            const openJobs = Number(entity.open_jobs || 0);
            const newThisWeek = Number(entity.new_this_week || 0);
            const source = entity.ats_provider && entity.ats_provider !== 'unknown' ? entity.ats_provider : 'source discovery';

            return (
              <button
                key={entity.id}
                onClick={() => onSelect(entity)}
                className="group w-full text-left px-3.5 py-3 rounded-xl border border-white/10 bg-white/[0.035] hover:border-blue-300/30 hover:bg-blue-500/10 transition-all focus:outline-none focus:border-blue-300/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-slate-100 truncate group-hover:text-white">{entity.name}</p>
                    <div className="mt-1.5 flex items-center gap-2 min-w-0">
                      <span className="text-[9px] uppercase tracking-[0.12em] text-slate-500 truncate">{source}</span>
                      {newThisWeek > 0 && (
                        <span className="shrink-0 rounded-full border border-blue-400/20 bg-blue-400/10 px-2 py-0.5 text-[9px] font-medium text-blue-200">
                          +{newThisWeek} new
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 pl-2">
                    <p className="text-[17px] leading-none font-semibold text-blue-100">{openJobs.toLocaleString()}</p>
                    <p className="text-[9px] uppercase tracking-[0.12em] text-slate-600 mt-1">open</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!loading && entities.length > 0 && (
        <div className="pt-3 mt-3 border-t border-white/10 flex items-center justify-between text-[10px] text-slate-600 shrink-0">
          <span>{entities.length} compan{entities.length === 1 ? 'y' : 'ies'} shown</span>
          <span>{entities.reduce((sum, entity) => sum + Number(entity.open_jobs || 0), 0).toLocaleString()} open roles</span>
        </div>
      )}
    </div>
  );
}
