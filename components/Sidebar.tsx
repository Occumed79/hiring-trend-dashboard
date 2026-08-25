'use client';
import { useEffect, useState } from 'react';
import { Activity, ChevronDown, Map, Search, SlidersHorizontal } from 'lucide-react';
import type { Portal } from '@/lib/portals';
import {
  HIRING_MAP_STYLES,
  readHiringMapStyle,
  writeHiringMapStyle,
  type HiringMapStyleId,
} from '@/components/map/maptilerBasemap';

export default function Sidebar({
  portals,
  activePortal,
  onSelect,
  searchActive = false,
  onOpenSearch,
  sourcesActive = false,
  onOpenSources,
  sourceHealthActive = false,
  onOpenSourceHealth,
}: {
  portals: Portal[];
  activePortal: Portal;
  onSelect: (p: Portal) => void;
  searchActive?: boolean;
  onOpenSearch?: () => void;
  sourcesActive?: boolean;
  onOpenSources?: () => void;
  sourceHealthActive?: boolean;
  onOpenSourceHealth?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mapStyleOpen, setMapStyleOpen] = useState(false);
  const [mapStyle, setMapStyle] = useState<HiringMapStyleId>('dataviz-dark');

  useEffect(() => {
    setMapStyle(readHiringMapStyle());
  }, []);

  const chooseMapStyle = (styleId: HiringMapStyleId) => {
    setMapStyle(styleId);
    writeHiringMapStyle(styleId);
    setMapStyleOpen(false);
  };

  const selectedStyle = HIRING_MAP_STYLES.find(style => style.id === mapStyle) || HIRING_MAP_STYLES[0];
  const profileWorkspaceInactive = !searchActive && !sourcesActive && !sourceHealthActive;

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
        {onOpenSearch && (
          <div className="pb-2 mb-2 border-b border-white/[0.08]">
            <button
              onClick={onOpenSearch}
              title={collapsed ? 'Global Search' : undefined}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left nav-pill ${searchActive ? 'active' : ''}`}
            >
              {collapsed ? (
                <Search size={16} className="mx-auto" strokeWidth={1.8} />
              ) : (
                <>
                  <Search size={14} strokeWidth={1.8} className="shrink-0" />
                  <span className="text-[13px] font-medium text-inherit truncate leading-none">Global Search</span>
                  <span className="ml-auto text-[8px] px-1.5 py-0.5 rounded-full border border-blue-400/20 bg-blue-500/10 text-blue-300">Search</span>
                </>
              )}
            </button>
          </div>
        )}

        {portals.map(portal => (
          <button
            key={portal.id}
            onClick={() => onSelect(portal)}
            title={collapsed ? portal.label : undefined}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left nav-pill ${profileWorkspaceInactive && activePortal.id === portal.id ? 'active' : ''}`}
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

        {(onOpenSources || onOpenSourceHealth) && <div className="pt-2 mt-2 border-t border-white/[0.08]" />}

        {onOpenSources && (
          <button
            onClick={onOpenSources}
            title={collapsed ? 'Sources & Integrations' : undefined}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left nav-pill ${sourcesActive ? 'active' : ''}`}
          >
            {collapsed ? (
              <SlidersHorizontal size={16} className="mx-auto" strokeWidth={1.8} />
            ) : (
              <>
                <SlidersHorizontal size={14} strokeWidth={1.8} className="shrink-0" />
                <span className="text-[13px] font-medium text-inherit truncate leading-none">Sources & Integrations</span>
              </>
            )}
          </button>
        )}

        {onOpenSourceHealth && (
          <button
            onClick={onOpenSourceHealth}
            title={collapsed ? 'Source Health' : undefined}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left nav-pill ${sourceHealthActive ? 'active' : ''}`}
          >
            {collapsed ? (
              <Activity size={16} className="mx-auto" strokeWidth={1.8} />
            ) : (
              <>
                <Activity size={14} strokeWidth={1.8} className="shrink-0" />
                <span className="text-[13px] font-medium text-inherit truncate leading-none">Source Health</span>
              </>
            )}
          </button>
        )}
      </nav>

      <div className="relative z-[3100] overflow-visible px-2.5 pb-2.5">
        <button
          onClick={() => setMapStyleOpen(open => !open)}
          className={`mx-auto border transition-all rounded-full flex items-center justify-center ${
            collapsed ? 'w-10 h-10 px-0' : 'w-full min-h-[34px] px-3 gap-2 text-[10px]'
          } ${
            mapStyleOpen
              ? 'bg-violet-500/20 border-violet-400/45 text-violet-100 shadow-[0_0_18px_rgba(168,85,247,0.12)]'
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
            className={`absolute z-[3200] bottom-[48px] rounded-2xl border border-white/15 bg-[#07101f]/96 backdrop-blur-2xl shadow-[0_22px_70px_rgba(0,0,0,0.55)] p-2 ${collapsed ? 'left-[58px] w-[270px]' : 'left-2.5 w-[270px]'}`}
            role="menu"
          >
            <div className="flex items-center justify-between px-2 pt-1 pb-2">
              <div>
                <p className="text-[10px] font-medium text-slate-200">Map View</p>
                <p className="text-[9px] text-slate-600 mt-0.5">MapTiler basemap palette</p>
              </div>
              <span className="map-provider-badge">MapTiler</span>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {HIRING_MAP_STYLES.map(style => {
                const active = style.id === mapStyle;
                return (
                  <button
                    key={style.id}
                    onClick={() => chooseMapStyle(style.id)}
                    className={`group rounded-xl border p-2 text-left transition-all ${style.id === 'satellite-v4' ? 'col-span-2' : ''} ${active ? 'bg-violet-500/15 border-violet-400/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]' : 'bg-white/[0.025] border-white/[0.07] hover:bg-white/[0.06] hover:border-white/15'}`}
                    role="menuitem"
                  >
                    <span className="block h-8 rounded-lg border border-white/10 shadow-inner mb-1.5" style={{ background: `linear-gradient(135deg, ${style.swatch[0]}, ${style.swatch[1]})` }} />
                    <span className={`block text-[10px] leading-tight ${active ? 'text-violet-200' : 'text-slate-300'}`}>{style.label}</span>
                    <span className="block text-[8px] uppercase tracking-[0.12em] text-slate-600 mt-1">{style.tone === 'dark' ? 'Dark' : style.tone === 'light' ? 'Light' : 'Photo'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <button
        onClick={() => { setMapStyleOpen(false); setCollapsed(!collapsed); }}
        className="px-4 py-4 border-t border-white/10 text-slate-500 hover:text-slate-200 text-[11px] flex items-center gap-2 transition-colors min-h-[48px]"
      >
        <span className="text-slate-400 text-sm leading-none">{collapsed ? '›' : '‹'}</span>
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}
