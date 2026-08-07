'use client';
import { useState } from 'react';
import type { Portal } from '@/lib/portals';

export default function Sidebar({
  portals, activePortal, onSelect,
}: {
  portals: Portal[];
  activePortal: Portal;
  onSelect: (p: Portal) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`h-screen flex flex-col glass border-r border-white/8 transition-all duration-300 shrink-0 ${collapsed ? 'w-[68px]' : 'w-[220px]'}`}>
      <div className="px-4 py-4.5 border-b border-white/7 flex items-center gap-3.5 min-h-[74px]">
        <div
          className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center text-[11px] font-bold text-white"
          style={{
            background: 'linear-gradient(135deg, rgba(59,130,246,0.88) 0%, rgba(79,70,229,0.82) 100%)',
            boxShadow: '0 0 18px rgba(59,130,246,0.3), inset 0 1px 0 rgba(255,255,255,0.24)',
          }}
        >
          HTD
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-slate-100 leading-tight tracking-tight">Hiring Trend</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Dashboard</p>
          </div>
        )}
      </div>

      <nav className="flex-1 p-2.5 space-y-1 overflow-y-auto scrollbar-glass">
        {portals.map(portal => (
          <button
            key={portal.id}
            onClick={() => onSelect(portal)}
            title={collapsed ? portal.label : undefined}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left nav-pill ${
              activePortal.id === portal.id ? 'active' : ''
            }`}
          >
            {!collapsed ? (
              <span className="text-[13px] font-medium text-inherit truncate leading-none">
                {portal.label}
              </span>
            ) : (
              <span className="text-[11px] font-semibold text-inherit w-full text-center tracking-wide">
                {portal.label.slice(0, 2).toUpperCase()}
              </span>
            )}
          </button>
        ))}
      </nav>

      <button
        onClick={() => setCollapsed(!collapsed)}
        className="px-4 py-4 border-t border-white/7 text-slate-500 hover:text-slate-200 text-[11px] flex items-center gap-2 transition-colors min-h-[48px]"
      >
        <span className="text-slate-400 text-sm leading-none">{collapsed ? '›' : '‹'}</span>
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}
