export function createHiringMarkerIcon(L: any, countValue: unknown, fallback = false) {
  const count = Math.max(1, Number(countValue || 1));
  const size = markerSize(count, fallback);
  const label = count > 1 ? (count > 999 ? '999+' : String(count)) : '';
  const labelClass = label.length >= 4 ? ' hiring-map-pin__label--tiny' : label.length >= 3 ? ' hiring-map-pin__label--small' : '';

  return L.divIcon({
    className: 'hiring-map-pin-wrap',
    html: `<span class="hiring-map-pin${fallback ? ' hiring-map-pin--fallback' : ''}" style="--pin-size:${size}px"><span class="hiring-map-pin__label${labelClass}">${label}</span></span>`,
    iconSize: [size + 10, size + 14],
    iconAnchor: [(size + 10) / 2, size + 11],
    popupAnchor: [0, -(size + 6)],
  });
}

function markerSize(count: number, fallback: boolean) {
  if (fallback) return count >= 10 ? 22 : 18;
  if (count >= 100) return 34;
  if (count >= 50) return 31;
  if (count >= 20) return 28;
  if (count >= 5) return 24;
  return 20;
}
