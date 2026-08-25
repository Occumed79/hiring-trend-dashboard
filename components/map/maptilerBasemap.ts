export type HiringMapStyleId = 'dataviz-dark' | 'streets-v4' | 'satellite-v4' | 'outdoor-v4';

export type HiringMapStyleOption = {
  id: HiringMapStyleId;
  label: string;
  shortLabel: string;
  description: string;
  tone: 'dark' | 'light' | 'photo';
  swatch: [string, string];
};

export type HiringBasemapConfig = {
  provider: 'maptiler' | 'carto';
  styleId: HiringMapStyleId;
  styleLabel: string;
  url: string;
  attribution: string;
  tileSize?: number;
  zoomOffset?: number;
  minZoom?: number;
  maxZoom: number;
};

export const HIRING_MAP_STYLE_STORAGE_KEY = 'hiring-trend-maptiler-style';
export const HIRING_MAP_STYLE_EVENT = 'hiring-trend-maptiler-style-change';
export const DEFAULT_HIRING_MAP_STYLE: HiringMapStyleId = 'dataviz-dark';

export const HIRING_MAP_STYLES: HiringMapStyleOption[] = [
  {
    id: 'dataviz-dark',
    label: 'Dataviz Dark',
    shortLabel: 'Dataviz Dark',
    description: 'MapTiler dark data-visualization basemap',
    tone: 'dark',
    swatch: ['#17191d', '#34373d'],
  },
  {
    id: 'streets-v4',
    label: 'Streets',
    shortLabel: 'Streets',
    description: 'MapTiler Streets',
    tone: 'light',
    swatch: ['#dfe8ee', '#f8fafc'],
  },
  {
    id: 'outdoor-v4',
    label: 'Outdoor',
    shortLabel: 'Outdoor',
    description: 'MapTiler outdoor and terrain map',
    tone: 'light',
    swatch: ['#cad7bd', '#eef1dc'],
  },
  {
    id: 'satellite-v4',
    label: 'Satellite',
    shortLabel: 'Satellite',
    description: 'MapTiler satellite imagery',
    tone: 'photo',
    swatch: ['#10251d', '#6c7961'],
  },
];

export function getHiringBasemap(styleId: HiringMapStyleId = DEFAULT_HIRING_MAP_STYLE, apiKey = ''): HiringBasemapConfig {
  const selected = HIRING_MAP_STYLES.find(style => style.id === styleId) || HIRING_MAP_STYLES[0];
  const key = String(apiKey || '').trim();
  if (!key) return getFallbackHiringBasemap(selected.id);

  return {
    provider: 'maptiler',
    styleId: selected.id,
    styleLabel: selected.label,
    url: `https://api.maptiler.com/maps/${selected.id}/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`,
    attribution: '<a href="https://www.maptiler.com/copyright/" target="_blank">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>',
    tileSize: 512,
    zoomOffset: -1,
    minZoom: 1,
    maxZoom: 20,
  };
}

export function getFallbackHiringBasemap(styleId: HiringMapStyleId = DEFAULT_HIRING_MAP_STYLE): HiringBasemapConfig {
  const dark = styleId === 'dataviz-dark';
  return {
    provider: 'carto',
    styleId,
    styleLabel: dark ? 'Dark fallback' : 'Map fallback',
    url: dark
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap contributors · © CARTO',
    minZoom: 1,
    maxZoom: 19,
  };
}

export function readHiringMapStyle(): HiringMapStyleId {
  if (typeof window === 'undefined') return DEFAULT_HIRING_MAP_STYLE;
  const saved = window.localStorage.getItem(HIRING_MAP_STYLE_STORAGE_KEY);
  return isHiringMapStyleId(saved) ? saved : DEFAULT_HIRING_MAP_STYLE;
}

export function writeHiringMapStyle(styleId: HiringMapStyleId) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(HIRING_MAP_STYLE_STORAGE_KEY, styleId);
  window.dispatchEvent(new CustomEvent(HIRING_MAP_STYLE_EVENT, { detail: styleId }));
}

export function subscribeToHiringMapStyle(listener: (styleId: HiringMapStyleId) => void) {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (isHiringMapStyleId(detail)) listener(detail);
  };
  window.addEventListener(HIRING_MAP_STYLE_EVENT, handler);
  return () => window.removeEventListener(HIRING_MAP_STYLE_EVENT, handler);
}

function isHiringMapStyleId(value: unknown): value is HiringMapStyleId {
  return HIRING_MAP_STYLES.some(style => style.id === value);
}
