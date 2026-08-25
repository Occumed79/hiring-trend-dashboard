export type HiringMapStyleId =
  | 'navigation-night'
  | 'streets-night'
  | 'dark-gray'
  | 'navigation'
  | 'streets'
  | 'topographic'
  | 'imagery';

export type HiringMapStyleOption = {
  id: HiringMapStyleId;
  label: string;
  shortLabel: string;
  description: string;
  arcgisStyle: string;
  tone: 'dark' | 'light' | 'photo';
  swatch: [string, string];
};

export type HiringBasemapConfig = {
  provider: 'arcgis' | 'carto';
  styleId: HiringMapStyleId;
  styleLabel: string;
  url: string;
  attribution: string;
  tileSize?: number;
  zoomOffset?: number;
  maxZoom: number;
};

export const HIRING_MAP_STYLE_STORAGE_KEY = 'hiring-trend-map-style';
export const HIRING_MAP_STYLE_EVENT = 'hiring-trend-map-style-change';
export const DEFAULT_HIRING_MAP_STYLE: HiringMapStyleId = 'navigation-night';

export const HIRING_MAP_STYLES: HiringMapStyleOption[] = [
  { id: 'navigation-night', label: 'Navigation Night', shortLabel: 'Night', description: 'Blue-black navigation map', arcgisStyle: 'arcgis/navigation-night', tone: 'dark', swatch: ['#07111f', '#173a68'] },
  { id: 'streets-night', label: 'Streets Night', shortLabel: 'Streets Night', description: 'Dark street-focused map', arcgisStyle: 'arcgis/streets-night', tone: 'dark', swatch: ['#101827', '#334766'] },
  { id: 'dark-gray', label: 'Dark Gray', shortLabel: 'Dark Gray', description: 'Neutral charcoal reference map', arcgisStyle: 'arcgis/dark-gray', tone: 'dark', swatch: ['#25282b', '#555b60'] },
  { id: 'navigation', label: 'Navigation', shortLabel: 'Navigation', description: 'Bright blue-gray navigation map', arcgisStyle: 'arcgis/navigation', tone: 'light', swatch: ['#d9e8f4', '#ffffff'] },
  { id: 'streets', label: 'Streets', shortLabel: 'Streets', description: 'Clean daytime street map', arcgisStyle: 'arcgis/streets', tone: 'light', swatch: ['#e5edf4', '#f8fafc'] },
  { id: 'topographic', label: 'Topographic', shortLabel: 'Topo', description: 'Terrain and physical geography', arcgisStyle: 'arcgis/outdoor', tone: 'light', swatch: ['#d7ddbc', '#f0ead9'] },
  { id: 'imagery', label: 'Satellite', shortLabel: 'Satellite', description: 'Esri World Imagery satellite view', arcgisStyle: 'arcgis/imagery/labels', tone: 'photo', swatch: ['#11271f', '#62785f'] },
];

const ARCGIS_STATIC_BASE = 'https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1';
const ESRI_WORLD_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export function getHiringBasemap(styleId?: HiringMapStyleId): HiringBasemapConfig {
  const token = process.env.NEXT_PUBLIC_ARCGIS_API_KEY?.trim();
  const resolvedStyleId = styleId || readHiringMapStyle();
  const selected = HIRING_MAP_STYLES.find(style => style.id === resolvedStyleId) || HIRING_MAP_STYLES[0];

  if (token) {
    if (selected.id === 'imagery') {
      return {
        provider: 'arcgis', styleId: selected.id, styleLabel: selected.label, url: ESRI_WORLD_IMAGERY,
        attribution: '© Esri · Maxar · Earthstar Geographics · GIS User Community', tileSize: 256, zoomOffset: 0, maxZoom: 19,
      };
    }
    return {
      provider: 'arcgis', styleId: selected.id, styleLabel: selected.label,
      url: `${ARCGIS_STATIC_BASE}/${selected.arcgisStyle}/static/tile/{z}/{y}/{x}?language=en&worldview=unitedStatesOfAmerica&token=${encodeURIComponent(token)}`,
      attribution: '© Esri · TomTom · Garmin · FAO · NOAA · USGS · © OpenStreetMap contributors · GIS User Community',
      tileSize: 512, zoomOffset: -1, maxZoom: 22,
    };
  }

  return getFallbackHiringBasemap(resolvedStyleId);
}

export function getFallbackHiringBasemap(styleId: HiringMapStyleId = DEFAULT_HIRING_MAP_STYLE): HiringBasemapConfig {
  return {
    provider: 'carto',
    styleId,
    styleLabel: 'Fallback Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap contributors · © CARTO',
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
