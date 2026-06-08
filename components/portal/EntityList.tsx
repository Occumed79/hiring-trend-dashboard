'use client';

export default function EntityList({ entities, selected, onSelect }: {
  entities: any[];
  selected: any;
  onSelect: (e: any) => void;
}) {
  if (!entities.length) {
    return (
      <div className="text-center py-8 text-slate-500 text-xs">
        No entities yet. Add one to get started.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {entities.map(entity => (
        <button
          key={entity.id}
          onClick={() => onSelect(entity)}
          className={`w-full text-left p-3 rounded-xl glass-hover border transition-all ${
            selected?.id === entity.id
              ? 'bg-blue-500/15 border-blue-500/30'
              : 'border-transparent hover:border-white/10'
          }`}
        >
          <p className="font-medium text-sm text-slate-100 truncate">{entity.name}</p>
          {entity.industry && (
            <p className="text-xs text-slate-500 mt-0.5 truncate">{entity.industry}</p>
          )}
          <div className="flex items-center gap-2 mt-1">
            {entity.ats_provider && entity.ats_provider !== 'unknown' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/8 border border-white/10 text-slate-400">
                {entity.ats_provider}
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
