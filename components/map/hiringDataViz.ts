export type HiringDataVizMode = 'bubbles' | 'heatmap' | 'hybrid' | 'points';

export type HiringDataVizOption = {
  id: HiringDataVizMode;
  label: string;
  shortLabel: string;
  description: string;
};

export const HIRING_DATA_VIZ_STORAGE_KEY = 'hiring-trend-data-viz-mode';
export const HIRING_DATA_VIZ_EVENT = 'hiring-trend-data-viz-change';
export const DEFAULT_HIRING_DATA_VIZ: HiringDataVizMode = 'bubbles';

export const HIRING_DATA_VIZ_MODES: HiringDataVizOption[] = [
  { id: 'bubbles', label: 'Gradient Bubbles', shortLabel: 'Bubbles', description: 'City-level hiring volume sized as luminous gradient bubbles.' },
  { id: 'heatmap', label: 'Density Heatmap', shortLabel: 'Heatmap', description: 'Continuous blue-to-green-to-yellow hiring-density surface.' },
  { id: 'hybrid', label: 'Hybrid', shortLabel: 'Hybrid', description: 'Heatmap density underneath volume-scaled gradient bubbles.' },
  { id: 'points', label: 'Individual Jobs', shortLabel: 'Points', description: 'One small point for each mapped open job.' },
];

export type HiringBubble = {
  key: string;
  lat: number;
  lng: number;
  city: string | null;
  state: string | null;
  country: string | null;
  entityName: string | null;
  count: number;
  jobs: any[];
};

export function readHiringDataVizMode(): HiringDataVizMode {
  if (typeof window === 'undefined') return DEFAULT_HIRING_DATA_VIZ;
  const saved = window.localStorage.getItem(HIRING_DATA_VIZ_STORAGE_KEY);
  return isHiringDataVizMode(saved) ? saved : DEFAULT_HIRING_DATA_VIZ;
}

export function writeHiringDataVizMode(mode: HiringDataVizMode) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(HIRING_DATA_VIZ_STORAGE_KEY, mode);
  window.dispatchEvent(new CustomEvent(HIRING_DATA_VIZ_EVENT, { detail: mode }));
}

export function subscribeToHiringDataVizMode(listener: (mode: HiringDataVizMode) => void) {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (isHiringDataVizMode(detail)) listener(detail);
  };
  window.addEventListener(HIRING_DATA_VIZ_EVENT, handler);
  return () => window.removeEventListener(HIRING_DATA_VIZ_EVENT, handler);
}

export function aggregateHiringBubbles(rows: any[]): HiringBubble[] {
  const groups = new Map<string, HiringBubble>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const lat = finite(row?.base_lat) ?? finite(row?.lat);
    const lng = finite(row?.base_lng) ?? finite(row?.lng);
    if (lat === null || lng === null) continue;
    const city = clean(row?.city);
    const state = clean(row?.state);
    const country = clean(row?.country);
    const entityName = clean(row?.entity_name);
    const key = [roundCoord(lat), roundCoord(lng), city || '', state || '', country || '', entityName || ''].join('|');
    const existing = groups.get(key);
    if (existing) {
      existing.count += Math.max(1, Number(row?.cnt || 1));
      existing.jobs.push(row);
    } else {
      groups.set(key, { key, lat, lng, city, state, country, entityName, count: Math.max(1, Number(row?.cnt || 1)), jobs: [row] });
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.count - a.count);
}

export function createGradientBubbleIcon(L: any, count: number) {
  const diameter = bubbleDiameter(count);
  const strength = Math.min(1, Math.log2(Math.max(2, count + 1)) / 6);
  const inner = strength > 0.68 ? '#f472ff' : strength > 0.35 ? '#d946ef' : '#c084fc';
  const mid = strength > 0.68 ? '#c026d3' : '#a855f7';
  const outer = strength > 0.68 ? '#7e22ce' : '#6d28d9';
  const glow = Math.round(12 + strength * 18);
  const html = `<span aria-hidden="true" style="display:block;width:${diameter}px;height:${diameter}px;border-radius:9999px;background:radial-gradient(circle at 34% 28%,rgba(255,255,255,.56) 0%,${inner} 16%,${mid} 54%,${outer} 78%,rgba(76,29,149,.92) 100%);border:1px solid rgba(244,114,255,.42);box-shadow:0 0 ${glow}px rgba(192,38,211,.58),inset 0 1px 5px rgba(255,255,255,.38);opacity:.9;"></span>`;
  return L.divIcon({
    className: 'hiring-gradient-bubble',
    html,
    iconSize: [diameter, diameter],
    iconAnchor: [diameter / 2, diameter / 2],
    popupAnchor: [0, -(diameter / 2 + 4)],
  });
}

export function createHiringHeatmapLayer(L: any, rows: any[]) {
  const heatPoints = aggregateHeatPoints(rows);
  const HiringHeatLayer = L.Layer.extend({
    onAdd(map: any) {
      this._map = map;
      this._canvas = L.DomUtil.create('canvas', 'hiring-density-heatmap');
      this._canvas.style.position = 'absolute';
      this._canvas.style.pointerEvents = 'none';
      this._canvas.style.mixBlendMode = 'screen';
      this._canvas.style.opacity = '0.94';
      map.getPane('overlayPane')?.appendChild(this._canvas);
      map.on('moveend zoomend resize viewreset', this._reset, this);
      this._reset();
    },
    onRemove(map: any) {
      map.off('moveend zoomend resize viewreset', this._reset, this);
      if (this._canvas?.parentNode) this._canvas.parentNode.removeChild(this._canvas);
      this._canvas = null;
      this._map = null;
    },
    _reset() {
      const map = this._map;
      const canvas = this._canvas;
      if (!map || !canvas) return;
      const size = map.getSize();
      canvas.width = Math.max(1, Math.round(size.x));
      canvas.height = Math.max(1, Math.round(size.y));
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      const topLeft = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(canvas, topLeft);
      drawHeatSurface(canvas, map, heatPoints);
    },
  });
  return new HiringHeatLayer();
}

function aggregateHeatPoints(rows: any[]) {
  const groups = new Map<string, { lat: number; lng: number; count: number }>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const lat = finite(row?.base_lat) ?? finite(row?.lat);
    const lng = finite(row?.base_lng) ?? finite(row?.lng);
    if (lat === null || lng === null) continue;
    const key = `${roundCoord(lat)}|${roundCoord(lng)}`;
    const existing = groups.get(key);
    if (existing) existing.count += Math.max(1, Number(row?.cnt || 1));
    else groups.set(key, { lat, lng, count: Math.max(1, Number(row?.cnt || 1)) });
  }
  return Array.from(groups.values());
}

function drawHeatSurface(canvas: HTMLCanvasElement, map: any, points: Array<{lat:number;lng:number;count:number}>) {
  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return;
  const visible = document.createElement('canvas');
  visible.width = width;
  visible.height = height;
  const intensity = document.createElement('canvas');
  intensity.width = width;
  intensity.height = height;
  const intensityContext = intensity.getContext('2d', { willReadFrequently: true });
  const outputContext = visible.getContext('2d');
  const targetContext = canvas.getContext('2d');
  if (!intensityContext || !outputContext || !targetContext) return;

  const zoom = Number(map.getZoom?.() || 2);
  const radius = clamp(18 + zoom * 4.2, 24, 72);
  const sprite = makeIntensitySprite(radius);
  intensityContext.clearRect(0, 0, width, height);
  intensityContext.globalCompositeOperation = 'lighter';

  for (const point of points) {
    const pixel = map.latLngToContainerPoint([point.lat, point.lng]);
    if (pixel.x < -radius || pixel.y < -radius || pixel.x > width + radius || pixel.y > height + radius) continue;
    const weight = clamp(0.16 + Math.log1p(point.count) * 0.105, 0.18, 0.78);
    intensityContext.globalAlpha = weight;
    intensityContext.drawImage(sprite, pixel.x - radius, pixel.y - radius);
  }
  intensityContext.globalAlpha = 1;

  const image = intensityContext.getImageData(0, 0, width, height);
  const colored = outputContext.createImageData(width, height);
  const src = image.data;
  const dst = colored.data;
  for (let index = 0; index < src.length; index += 4) {
    const density = src[index + 3] / 255;
    if (density <= 0.015) continue;
    const [r, g, b, a] = heatColor(density);
    dst[index] = r;
    dst[index + 1] = g;
    dst[index + 2] = b;
    dst[index + 3] = a;
  }
  outputContext.putImageData(colored, 0, 0);
  targetContext.clearRect(0, 0, width, height);
  targetContext.drawImage(visible, 0, 0);
}

function makeIntensitySprite(radius: number) {
  const size = Math.max(2, Math.round(radius * 2));
  const sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;
  const context = sprite.getContext('2d');
  if (!context) return sprite;
  const gradient = context.createRadialGradient(radius, radius, 0, radius, radius, radius);
  gradient.addColorStop(0, 'rgba(255,255,255,0.96)');
  gradient.addColorStop(0.24, 'rgba(255,255,255,0.78)');
  gradient.addColorStop(0.58, 'rgba(255,255,255,0.28)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return sprite;
}

function heatColor(density: number): [number, number, number, number] {
  const stops: Array<[number, number, number, number, number]> = [
    [0.00, 20, 40, 180, 0],
    [0.10, 37, 99, 235, 88],
    [0.28, 28, 122, 245, 142],
    [0.46, 20, 184, 166, 176],
    [0.64, 34, 197, 94, 205],
    [0.82, 250, 204, 21, 228],
    [1.00, 255, 244, 125, 244],
  ];
  const value = clamp(density, 0, 1);
  for (let i = 1; i < stops.length; i += 1) {
    const previous = stops[i - 1];
    const next = stops[i];
    if (value <= next[0]) {
      const t = (value - previous[0]) / Math.max(0.0001, next[0] - previous[0]);
      return [
        lerp(previous[1], next[1], t),
        lerp(previous[2], next[2], t),
        lerp(previous[3], next[3], t),
        lerp(previous[4], next[4], t),
      ];
    }
  }
  const last = stops[stops.length - 1];
  return [last[1], last[2], last[3], last[4]];
}

function bubbleDiameter(count: number) {
  return Math.round(clamp(15 + Math.sqrt(Math.max(1, count)) * 7.2, 20, 78));
}
function isHiringDataVizMode(value: unknown): value is HiringDataVizMode {
  return HIRING_DATA_VIZ_MODES.some(mode => mode.id === value);
}
function clean(value: unknown) { const text = String(value || '').trim(); return text || null; }
function finite(value: unknown) { const number = Number(value); return value === null || value === undefined || value === '' || !Number.isFinite(number) ? null : number; }
function roundCoord(value: number) { return Math.round(value * 10000) / 10000; }
function lerp(a: number, b: number, t: number) { return Math.round(a + (b - a) * t); }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
