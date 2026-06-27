type Point = { lat: number; lng: number; city?: string; state?: string; country?: string; note?: string };

const POINTS: Record<string, Point> = {
  'washington, dc': { lat: 38.9072, lng: -77.0369, city: 'Washington', state: 'DC', country: 'US' },
  'mclean, va': { lat: 38.9339, lng: -77.1773, city: 'McLean', state: 'VA', country: 'US' },
  'reston, va': { lat: 38.9586, lng: -77.3570, city: 'Reston', state: 'VA', country: 'US' },
  'herndon, va': { lat: 38.9696, lng: -77.3861, city: 'Herndon', state: 'VA', country: 'US' },
  'falls church, va': { lat: 38.8823, lng: -77.1711, city: 'Falls Church', state: 'VA', country: 'US' },
  'arlington, va': { lat: 38.8816, lng: -77.0910, city: 'Arlington', state: 'VA', country: 'US' },
  'chantilly, va': { lat: 38.8943, lng: -77.4311, city: 'Chantilly', state: 'VA', country: 'US' },
  'norfolk, va': { lat: 36.8508, lng: -76.2859, city: 'Norfolk', state: 'VA', country: 'US' },
  'fort worth, tx': { lat: 32.7555, lng: -97.3308, city: 'Fort Worth', state: 'TX', country: 'US' },
  'dallas, tx': { lat: 32.7767, lng: -96.7970, city: 'Dallas', state: 'TX', country: 'US' },
  'houston, tx': { lat: 29.7604, lng: -95.3698, city: 'Houston', state: 'TX', country: 'US' },
  'san antonio, tx': { lat: 29.4252, lng: -98.4946, city: 'San Antonio', state: 'TX', country: 'US' },
  'colorado springs, co': { lat: 38.8339, lng: -104.8214, city: 'Colorado Springs', state: 'CO', country: 'US' },
  'huntsville, al': { lat: 34.7304, lng: -86.5861, city: 'Huntsville', state: 'AL', country: 'US' },
  'orlando, fl': { lat: 28.5383, lng: -81.3792, city: 'Orlando', state: 'FL', country: 'US' },
  'tampa, fl': { lat: 27.9506, lng: -82.4572, city: 'Tampa', state: 'FL', country: 'US' },
  'jacksonville, fl': { lat: 30.3322, lng: -81.6557, city: 'Jacksonville', state: 'FL', country: 'US' },
  'atlanta, ga': { lat: 33.7490, lng: -84.3880, city: 'Atlanta', state: 'GA', country: 'US' },
  'charleston, sc': { lat: 32.7765, lng: -79.9311, city: 'Charleston', state: 'SC', country: 'US' },
  'raleigh, nc': { lat: 35.7796, lng: -78.6382, city: 'Raleigh', state: 'NC', country: 'US' },
  'san diego, ca': { lat: 32.7157, lng: -117.1611, city: 'San Diego', state: 'CA', country: 'US' },
  'los angeles, ca': { lat: 34.0522, lng: -118.2437, city: 'Los Angeles', state: 'CA', country: 'US' },
  'seattle, wa': { lat: 47.6062, lng: -122.3321, city: 'Seattle', state: 'WA', country: 'US' },
  'chicago, il': { lat: 41.8781, lng: -87.6298, city: 'Chicago', state: 'IL', country: 'US' },
  'new york, ny': { lat: 40.7128, lng: -74.0060, city: 'New York', state: 'NY', country: 'US' },
  'kuwait': { lat: 29.3759, lng: 47.9774, city: 'Kuwait City', country: 'KW' },
  'qatar': { lat: 25.2854, lng: 51.5310, city: 'Doha', country: 'QA' },
  'bahrain': { lat: 26.2235, lng: 50.5876, city: 'Manama', country: 'BH' },
  'iraq': { lat: 33.3152, lng: 44.3661, city: 'Baghdad', country: 'IQ' },
  'germany': { lat: 50.1109, lng: 8.6821, city: 'Frankfurt', country: 'DE' },
  'remote': { lat: 39.8283, lng: -98.5795, city: 'Remote', country: 'US' },
};

const STATE_POINTS: Record<string, Point> = {
  va: { lat: 37.7693, lng: -78.1700, state: 'VA', country: 'US' },
  tx: { lat: 31.0545, lng: -97.5635, state: 'TX', country: 'US' },
  fl: { lat: 27.7663, lng: -81.6868, state: 'FL', country: 'US' },
  ca: { lat: 36.1162, lng: -119.6816, state: 'CA', country: 'US' },
  co: { lat: 39.0598, lng: -105.3111, state: 'CO', country: 'US' },
  al: { lat: 32.8067, lng: -86.7911, state: 'AL', country: 'US' },
  ga: { lat: 33.0406, lng: -83.6431, state: 'GA', country: 'US' },
  sc: { lat: 33.8569, lng: -80.9450, state: 'SC', country: 'US' },
  nc: { lat: 35.6301, lng: -79.8064, state: 'NC', country: 'US' },
  dc: { lat: 38.9072, lng: -77.0369, state: 'DC', country: 'US' },
};

const ENTITY_FALLBACK_POINTS: Record<string, Point> = {
  v2x: { ...POINTS['mclean, va'], note: 'entity fallback' },
  vectrus: { ...POINTS['mclean, va'], note: 'entity fallback' },
  vertex: { ...POINTS['mclean, va'], note: 'entity fallback' },
  amentum: { ...POINTS['chantilly, va'], note: 'entity fallback' },
  peraton: { ...POINTS['reston, va'], note: 'entity fallback' },
  leidos: { ...POINTS['reston, va'], note: 'entity fallback' },
  caci: { ...POINTS['reston, va'], note: 'entity fallback' },
  gdit: { ...POINTS['falls church, va'], note: 'entity fallback' },
};

type LocationInput = {
  city?: string | null;
  state?: string | null;
  country?: string | null;
  location?: string | null;
  entity_name?: string | null;
  is_remote?: boolean | null;
};

export function inferPoint(input: LocationInput): Point | null {
  if (input.is_remote) return POINTS.remote;
  const city = clean(input.city);
  const state = clean(input.state);
  const location = clean(input.location);
  const country = clean(input.country);
  const entityName = clean(input.entity_name);

  if (city && state && POINTS[`${city}, ${state}`]) return POINTS[`${city}, ${state}`];
  if (location && POINTS[location]) return POINTS[location];
  if (location) {
    const hit = Object.keys(POINTS).find(key => location.includes(key));
    if (hit) return POINTS[hit];
  }
  if (state && STATE_POINTS[state]) return STATE_POINTS[state];
  if (country && POINTS[country]) return POINTS[country];
  if (entityName) {
    const entityHit = Object.keys(ENTITY_FALLBACK_POINTS).find(key => entityName === key || entityName.includes(key));
    if (entityHit) return ENTITY_FALLBACK_POINTS[entityHit];
  }
  return null;
}

function clean(value?: string | null): string {
  return String(value || '').trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
}
