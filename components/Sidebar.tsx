'use client';
import { useEffect, useState } from 'react';
import type { Portal } from '@/lib/portals';
import {
  HIRING_MAP_STYLES,
  readHiringMapStyle,
  writeHiringMapStyle,
  type HiringMapStyleId,
} from '@/components/map/arcgisBasemap';

export default function Sidebar({
  portals, activePortal, onSelect,
}: {
  portals: Portal[];
  activePortal: Portal;
  onSelect: (p: Portal) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mapStyleOpen, setMapStyleOpen] = useState(false);
  const [mapStyle, setMapStyle] = useState<HiringMapStyleId>('navigation-night');

  useEffect(() => {
    setMapStyle(readHiringMapStyle());
  }, []);

  const chooseMapStyle = (styleId: HiringMapStyleId) => {
    setMapStyle(styleId);
    writeHiringMapStyle(styleId);
    setMapStyleOpen(false);
  };

  const selectedStyle = HIRING_MAP_STYLES.find(style => style.id === mapStyle) || HIRING_MAP_STYLES[0];

  return (
    <aside className={`h-screen flex flex-col glass border-r border-white/10 transition-all duration-300 shrink-0 ${collapsed ? 'w-[68px]' : 'w-[220px]'}`}>
      <div className="px-4 py-[18px] border-b border-white/10 flex items-center gap-3.5 min-h-[74px]">
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

      <div className="border-t border-white/10 p-2.5 relative">
        <button
          onClick={() => setMapStyleOpen(open => !open)}
          className={`w-full rounded-xl border transition-all ${collapsed ? 'h-10 flex items-center justify-center' : 'px-3 py-2.5 flex items-center gap-2.5 text-left'} ${
            mapStyleOpen
              ? 'bg-blue-500/15 border-blue-400/35'
              : 'bg-white/[0.035] border-white/10 hover:bg-white/[0.065] hover:border-white/15'
          }`}
          title={collapsed ? `Map style: ${selectedStyle.label}` : undefined}
        >
          <span
            className="w-5 h-5 rounded-md shrink-0 border border-white/15"
            style={{ background: `linear-gradient(135deg, ${selectedStyle.swatch[0]}, ${selectedStyle.swatch[1]})` }}
          />
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block text-[9px] uppercase tracking-[0.16em] text-slate-500">Map Style</span>
              <span className="block text-[11px] text-slate-200 truncate mt-0.5">{selectedStyle.label}</span>
            </span>
          )}
          {!collapsed && <span className="text-[10px] text-slate-500">{mapStyleOpen ? '▴' : '▾'}</span>}
        </button>

        {mapStyleOpen && (
          <div className={`absolute z-[2000] bottom-[58px] rounded-2xl border border-white/15 bg-[#07101f]/95 backdrop-blur-2xl shadow-2xl p-2 ${collapsed ? 'left-[58px] w-[230px]' : 'left-2.5 right-2.5'}`}>
            <div className="px-2 pt-1 pb-2">
              <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500">ArcGIS Basemap</p>
              <p className="text-[10px] text-slate-600 mt-0.5">Changes map view instantly</p>
            </div>
            <div className="space-y-1 max-h-[310px] overflow-y-auto scrollbar-glass">
              {HIRING_MAP_STYLES.map(style => {
                const active = style.id === mapStyle;
                return (
                  <button
                    key={style.id}
                    onClick={() => chooseMapStyle(style.id)}
                    className={`w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left border transition-all ${
                      active
                        ? 'bg-blue-500/15 border-blue-400/30'
                        : 'border-transparent hover:bg-white/[0.055]'
                    }`}
                  >
                    <span
                      className="w-7 h-7 rounded-lg shrink-0 border border-white/15 shadow-inner"
                      style={{ background: `linear-gradient(135deg, ${style.swatch[0]}, ${style.swatch[1]})` }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[11px] ${active ? 'text-blue-200' : 'text-slate-200'}`}>{style.label}</span>
                      <span className="block text-[9px] text-slate-600 truncate mt-0.5">{style.description}</span>
                    </span>
                    {active && <span className="text-blue-300 text-[11px]">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <button
        onClick={() => {
          setMapStyleOpen(false);
          setCollapsed(!collapsed);
        }}
        className="px-4 py-4 border-t border-white/10 text-slate-500 hover:text-slate-200 text-[11px] flex items-center gap-2 transition-colors min-h-[48px]"
      >
        <span className="text-slate-400 text-sm leading-none">{collapsed ? '›' : '‹'}</span>
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}
