'use client';
import { useState } from 'react';

interface Portal { id: string; label: string; icon: string; }

export default function Sidebar({
  portals, activePortal, onSelect
}: {
  portals: Portal[];
  activePortal: Portal;
  onSelect: (p: Portal) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`h-screen flex flex-col glass border-r border-white/10 transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-56'
      }`}
    >
      {/* Logo */}
      <div className="p-4 border-b border-white/10 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-sm font-bold shrink-0">
          HTD
        </div>
        {!collapsed && (
          <div>
            <p className="text-xs font-semibold text-slate-100 leading-tight">Hiring Trend</p>
            <p className="text-xs text-slate-400">Dashboard</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto scrollbar-glass">
        {portals.map(portal => (
          <button
            key={portal.id}
            onClick={() => onSelect(portal)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left nav-pill ${
              activePortal.id === portal.id ? 'active' : ''
            }`}
          >
            <span className="text-base shrink-0">{portal.icon}</span>
            {!collapsed && (
              <span className="text-xs font-medium text-slate-200 truncate">
                {portal.label}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="p-4 border-t border-white/10 text-slate-400 hover:text-slate-200 text-xs flex items-center gap-2"
      >
        <span>{collapsed ? '→' : '←'}</span>
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}
