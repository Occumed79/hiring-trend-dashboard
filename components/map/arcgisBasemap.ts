export type HiringMapStyleId =
  | 'navigation-night'
  | 'streets-night'
  | 'dark-gray'
  | 'human-geography-dark'
  | 'light-gray'
  | 'topographic'
  | 'imagery';

export type HiringMapStyleOption = {
  id: HiringMapStyleId;
  label: string;
  shortLabel: string;
  description: string;
  arcgisStyle: string;
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
  {
    id: 'navigation-night',
    label: 'Navigation Night',
    shortLabel: 'Night',
    description: 'Blue-black navigation map',
    arcgisStyle: 'arcgis/navigation-night',
    swatch: ['#07111f', '#14325d'],
  },
  {
    id: 'streets-night',
    label: 'Streets Night',
    shortLabel: 'Streets',
    description: 'Dark street-focused map',
    arcgisStyle: 'arcgis/streets-night',
    swatch: ['#111827', '#334155'],
  },
  {
    id: 'dark-gray',
    label: 'Dark Gray',
    shortLabel: 'Gray',
    description: 'Warm neutral dark canvas',
    arcgisStyle: 'arcgis/dark-gray',
    swatch: ['#22262a', '#53575b'],
  },
  {
    id: 'human-geography-dark',
    label: 'Human Geography Dark',
    shortLabel: 'Human',
    description: 'Dark contextual geography',
    arcgisStyle: 'arcgis/human-geography-dark',
    swatch: ['#171a21', '#39445a'],
  },
  {
    id: 'light-gray',
    label: 'Light Gray',
    shortLabel: 'Light',
    description: 'Minimal light canvas',
    arcgisStyle: 'arcgis/light-gray',
    swatch: ['#d9dde2', '#f2f4f6'],
  },
  {
    id: 'topographic',
    label: 'Topographic',
    shortLabel: 'Topo',
    description: 'Terrain and physical detail',
    arcgisStyle: 'arcgis/topographic',
    swatch: ['#c5c9a4', '#e8e3ca'],
  },
  {
    id: 'imagery',
    label: 'Imagery',
    shortLabel: 'Satellite',
    description: 'Satellite imagery view',
    arcgisStyle: 'arcgis/imagery',
    swatch: ['#1b3126', '#6b785b'],
  },
];

const ARCGIS_STATIC_BASE =
  'https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1';

export function getHiringBasemap(styleId: HiringMapStyleId = DEFAULT_HIRING_MAP_STYLE): HiringBasemapConfig {
  const token = process.env.NEXT_PUBLIC_ARCGIS_API_KEY?.trim();
  const selected = HIRING_MAP_STYLES.find(style => style.id === styleId) || HIRING_MAP_STYLES[0];

  if (token) {
    return {
      provider: 'arcgis',
      styleId: selected.id,
      styleLabel: selected.label,
      url: `${ARCGIS_STATIC_BASE}/${selected.arcgisStyle}/static/tile/{z}/{y}/{x}?language=en&worldview=unitedStatesOfAmerica&token=${encodeURIComponent(token)}`,
      attribution: '© Esri · TomTom · Garmin · FAO · NOAA · USGS · © OpenStreetMap contributors · GIS User Community',
      tileSize: 512,
      zoomOffset: -1,
      maxZoom: 22,
    };
  }

  return {
    provider: 'carto',
    styleId: selected.id,
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
