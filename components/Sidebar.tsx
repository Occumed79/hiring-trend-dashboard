'use client';
import { useEffect, useState } from 'react';
import { ChevronDown, Map } from 'lucide-react';
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
    <aside className={`relative z-[3000] overflow-visible h-screen flex flex-col glass border-r border-white/10 transition-all duration-300 shrink-0 ${collapsed ? 'w-[68px]' : 'w-[220px]'}`}>
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
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left nav-pill ${activePortal.id === portal.id ? 'active' : ''}`}
          >
            {!collapsed ? (
              <span className="text-[13px] font-medium text-inherit truncate leading-none">{portal.label}</span>
            ) : (
              <span className="text-[11px] font-semibold text-inherit w-full text-center tracking-wide">
                {portal.label.slice(0, 2).toUpperCase()}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="relative z-[3100] overflow-visible px-2.5 pb-2.5">
        <button
          onClick={() => setMapStyleOpen(open => !open)}
          className={`mx-auto border transition-all rounded-full flex items-center justify-center ${
            collapsed
              ? 'w-10 h-10 px-0'
              : 'w-full min-h-[34px] px-3 gap-2 text-[10px]'
          } ${
            mapStyleOpen
              ? 'bg-blue-500/20 border-blue-400/45 text-blue-200 shadow-[0_0_18px_rgba(59,130,246,0.12)]'
              : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/20 hover:bg-white/[0.075]'
          }`}
          title={collapsed ? `Map View: ${selectedStyle.label}` : undefined}
          aria-expanded={mapStyleOpen}
          aria-haspopup="menu"
        >
          <Map size={13} strokeWidth={1.8} className="shrink-0" />
          {!collapsed && (
            <>
              <span className="font-medium whitespace-nowrap">Map View</span>
              <span className="w-1 h-1 rounded-full bg-slate-600 shrink-0" />
              <span className="truncate text-slate-300">{selectedStyle.shortLabel}</span>
              <ChevronDown size={12} className={`ml-auto shrink-0 transition-transform ${mapStyleOpen ? 'rotate-180' : ''}`} />
            </>
          )}
        </button>

        {mapStyleOpen && (
          <div
            className={`absolute z-[3200] bottom-[48px] rounded-2xl border border-white/15 bg-[#07101f]/96 backdrop-blur-2xl shadow-[0_22px_70px_rgba(0,0,0,0.55)] p-2 ${
              collapsed ? 'left-[58px] w-[270px]' : 'left-2.5 w-[270px]'
            }`}
            role="menu"
          >
            <div className="flex items-center justify-between px-2 pt-1 pb-2">
              <div>
                <p className="text-[10px] font-medium text-slate-200">Map View</p>
                <p className="text-[9px] text-slate-600 mt-0.5">ArcGIS basemap palette</p>
              </div>
              <span className="map-provider-badge">ArcGIS</span>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {HIRING_MAP_STYLES.map(style => {
                const active = style.id === mapStyle;
                return (
                  <button
                    key={style.id}
                    onClick={() => chooseMapStyle(style.id)}
                    className={`group rounded-xl border p-2 text-left transition-all ${style.id === 'imagery' ? 'col-span-2' : ''} ${
                      active
                        ? 'bg-blue-500/15 border-blue-400/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                        : 'bg-white/[0.025] border-white/[0.07] hover:bg-white/[0.06] hover:border-white/15'
                    }`}
                    role="menuitem"
                  >
                    <span
                      className="block h-8 rounded-lg border border-white/10 shadow-inner mb-1.5"
                      style={{ background: `linear-gradient(135deg, ${style.swatch[0]}, ${style.swatch[1]})` }}
                    />
                    <span className={`block text-[10px] leading-tight ${active ? 'text-blue-200' : 'text-slate-300'}`}>
                      {style.label}
                    </span>
                    <span className="block text-[8px] uppercase tracking-[0.12em] text-slate-600 mt-1">
                      {style.tone === 'dark' ? 'Dark' : style.tone === 'light' ? 'Light' : 'Photo'}
                    </span>
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
