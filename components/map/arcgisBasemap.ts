export type HiringBasemapConfig = {
  provider: 'arcgis' | 'carto';
  url: string;
  attribution: string;
  tileSize?: number;
  zoomOffset?: number;
  maxZoom: number;
};

const ARCGIS_STATIC_BASE =
  'https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1';

export function getHiringBasemap(): HiringBasemapConfig {
  const token = process.env.NEXT_PUBLIC_ARCGIS_API_KEY?.trim();

  if (token) {
    return {
      provider: 'arcgis',
      url: `${ARCGIS_STATIC_BASE}/arcgis/dark-gray/static/tile/{z}/{y}/{x}?language=en&worldview=unitedStatesOfAmerica&token=${encodeURIComponent(token)}`,
      attribution: '© Esri · TomTom · Garmin · FAO · NOAA · USGS · © OpenStreetMap contributors · GIS User Community',
      tileSize: 512,
      zoomOffset: -1,
      maxZoom: 22,
    };
  }

  // Keep the map usable in local/preview environments where the public ArcGIS
  // key has not been configured yet. Production should use ArcGIS.
  return {
    provider: 'carto',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap contributors · © CARTO',
    maxZoom: 19,
  };
}
