export function createHiringMarkerIcon(L: any, countValue: unknown, fallback = false) {
  const count = Math.max(1, Number(countValue || 1));
  const size = markerSize(count, fallback);

  return L.divIcon({
    className: 'hiring-map-city-dot-wrap',
    html: `<span class="hiring-map-city-dot${fallback ? ' hiring-map-city-dot--fallback' : ''}" style="--city-dot-size:${size}px"></span>`,
    iconSize: [size + 8, size + 8],
    iconAnchor: [(size + 8) / 2, (size + 8) / 2],
    popupAnchor: [0, -(size / 2 + 5)],
  });
}

function markerSize(count: number, fallback: boolean) {
  if (fallback) return 7;
  if (count >= 100) return 14;
  if (count >= 50) return 13;
  if (count >= 20) return 12;
  if (count >= 5) return 10;
  return 8;
}
