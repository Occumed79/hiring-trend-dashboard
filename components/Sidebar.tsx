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
    <aside className={`h-screen flex flex-col glass border-r border-white/8 transition-all duration-300 shrink-0 ${collapsed ? 'w-[60px]' : 'w-[200px]'}`}>
      {/* Logo */}
      <div className="px-4 py-5 border-b border-white/7 flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center text-[11px] font-bold text-white"
          style={{
            background: 'linear-gradient(135deg, rgba(59,130,246,0.8) 0%, rgba(99,102,241,0.8) 100%)',
            boxShadow: '0 0 16px rgba(59,130,246,0.35), inset 0 1px 0 rgba(255,255,255,0.2)',
          }}>
          HTD
        </div>
        {!collapsed && (
          <div>
            <p className="text-[11px] font-semibold text-slate-100 leading-tight">Hiring Trend</p>
            <p className="text-[10px] text-slate-500">Dashboard</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto scrollbar-glass">
        {portals.map(portal => (
          <button
            key={portal.id}
            onClick={() => onSelect(portal)}
            title={collapsed ? portal.label : undefined}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left nav-pill ${
              activePortal.id === portal.id ? 'active' : ''
            }`}
          >
            {!collapsed && (
              <span className="text-[12px] font-medium text-inherit truncate">
                {portal.label}
              </span>
            )}
            {collapsed && (
              <span className="text-[11px] font-semibold text-inherit w-full text-center">
                {portal.label.slice(0, 2).toUpperCase()}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="px-4 py-3.5 border-t border-white/7 text-slate-600 hover:text-slate-300 text-[10px] flex items-center gap-2 transition-colors">
        <span className="text-slate-500">{collapsed ? '›' : '‹'}</span>
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}
