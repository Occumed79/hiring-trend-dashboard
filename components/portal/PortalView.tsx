'use client';
import { useState, useEffect } from 'react';
import EntityList from './EntityList';
import EntityDetail from './EntityDetail';
import AddEntityModal from './AddEntityModal';

interface Portal { id: string; label: string; icon: string; }

export default function PortalView({ portal }: { portal: Portal }) {
  const [entities, setEntities] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSelected(null);
    setLoading(true);
    fetch(`/api/entities?portal=${portal.id}`)
      .then(r => r.json())
      .then(data => {
        setEntities(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [portal.id]);

  const handleAdded = (newEntity: any) => {
    setEntities(prev => [newEntity, ...prev]);
    setShowAdd(false);
    setSelected(newEntity);
  };

  return (
    <div className="flex h-full">
      {/* Entity list sidebar */}
      <div className="w-72 h-screen sticky top-0 border-r border-white/10 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-lg">{portal.icon}</span>
              <h2 className="font-semibold text-slate-100 text-sm">{portal.label}</h2>
            </div>
            <button
              onClick={() => setShowAdd(true)}
              className="w-7 h-7 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-400 text-lg hover:bg-blue-500/30 flex items-center justify-center leading-none"
            >+</button>
          </div>
          <p className="text-xs text-slate-500">{entities.length} entities</p>
        </div>

        {/* Entity list */}
        <div className="flex-1 overflow-y-auto scrollbar-glass p-2">
          {loading ? (
            <div className="space-y-2 p-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-14 rounded-xl bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : (
            <EntityList
              entities={entities}
              selected={selected}
              onSelect={setSelected}
            />
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 p-6">
        {selected ? (
          <EntityDetail entity={selected} portal={portal} />
        ) : (
          <EmptyState portal={portal} onAdd={() => setShowAdd(true)} />
        )}
      </div>

      {showAdd && (
        <AddEntityModal
          portal={portal}
          onClose={() => setShowAdd(false)}
          onAdded={handleAdded}
        />
      )}
    </div>
  );
}

function EmptyState({ portal, onAdd }: { portal: any; onAdd: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 text-center">
      <div className="text-6xl opacity-30">{portal.icon}</div>
      <div>
        <p className="text-slate-400 font-medium">No entity selected</p>
        <p className="text-slate-600 text-sm mt-1">Select from the list or add a new one</p>
      </div>
      <button
        onClick={onAdd}
        className="mt-2 px-4 py-2 rounded-xl bg-blue-500/20 border border-blue-500/30 text-blue-300 text-sm hover:bg-blue-500/30 transition-all"
      >
        + Add {portal.label.replace(/s$/, '')}
      </button>
    </div>
  );
}
