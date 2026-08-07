import { query } from '@/db/client';

type GeocodedPoint = {
  lat: number;
  lng: number;
  city: string | null;
  state: string | null;
  country: string | null;
  note: string;
};

const MAX_EXTERNAL_LOOKUPS = positiveIntegerEnv('GEOCODE_MAX_PER_PROCESS', 100);
let externalLookups = 0;
let cacheReady: Promise<void> | null = null;

export async function geocodeLocationCandidates(candidates: string[]): Promise<GeocodedPoint | null> {
  const specific = candidates.map(clean).filter(Boolean).find(isSpecificLocation);
  if (!specific) return null;

  await ensureCacheTable();
  const cacheKey = normalizeKey(specific);
  const cached = await readCache(cacheKey);
  if (cached) return cached;

  const apiKey = (process.env.GEOAPIFY_API_KEY || '').trim();
  if (!apiKey || externalLookups >= MAX_EXTERNAL_LOOKUPS) return null;
  externalLookups += 1;

  try {
    const url = new URL('https://api.geoapify.com/v1/geocode/search');
    url.searchParams.set('text', specific);
    url.searchParams.set('limit', '1');
    url.searchParams.set('format', 'json');
    url.searchParams.set('apiKey', apiKey);

    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'OccuMedHiringTrendDashboard/1.0' },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    const row = Array.isArray(payload?.results) ? payload.results[0] : null;
    const lat = Number(row?.lat);
    const lng = Number(row?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const point: GeocodedPoint = {
      lat,
      lng,
      city: text(row?.city || row?.town || row?.village || row?.municipality),
      state: text(row?.state_code || row?.state),
      country: normalizeCountry(row?.country_code || row?.country),
      note: 'geocoded job location',
    };
    await writeCache(cacheKey, specific, point);
    return point;
  } catch {
    return null;
  }
}

function ensureCacheTable() {
  if (!cacheReady) {
    cacheReady = query(`
      CREATE TABLE IF NOT EXISTS location_geocode_cache (
        query_key TEXT PRIMARY KEY,
        query_text TEXT NOT NULL,
        lat DECIMAL(10,7) NOT NULL,
        lng DECIMAL(10,7) NOT NULL,
        city TEXT,
        state TEXT,
        country TEXT,
        quality TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `).then(() => undefined).catch(() => undefined);
  }
  return cacheReady;
}

async function readCache(cacheKey: string): Promise<GeocodedPoint | null> {
  try {
    const rows = await query(`SELECT lat, lng, city, state, country, quality FROM location_geocode_cache WHERE query_key = $1 LIMIT 1`, [cacheKey]);
    if (!rows.length) return null;
    const lat = Number(rows[0].lat);
    const lng = Number(rows[0].lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, city: rows[0].city || null, state: rows[0].state || null, country: rows[0].country || null, note: rows[0].quality || 'cached geocoded job location' };
  } catch {
    return null;
  }
}

async function writeCache(cacheKey: string, queryText: string, point: GeocodedPoint) {
  await query(
    `INSERT INTO location_geocode_cache (query_key, query_text, lat, lng, city, state, country, quality, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT (query_key) DO UPDATE SET query_text = EXCLUDED.query_text, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
       city = EXCLUDED.city, state = EXCLUDED.state, country = EXCLUDED.country, quality = EXCLUDED.quality, updated_at = NOW()`,
    [cacheKey, queryText, point.lat, point.lng, point.city, point.state, point.country, point.note],
  ).catch(() => {});
}

function isSpecificLocation(value: string) {
  if (/\b(remote|virtual|worldwide|anywhere|multiple locations?)\b/i.test(value)) return false;
  const normalized = value.toLowerCase().trim();
  if (/^(?:us|usa|united states|canada|germany|kuwait|qatar|bahrain|iraq|poland|australia|japan|mexico|spain|italy|greece)$/i.test(normalized)) return false;
  if (/^[A-Z]{2}$/i.test(value.trim())) return false;
  if (/^[^,]{2,60},\s*[^,]{2,60}/.test(value)) return true;
  return value.trim().split(/\s+/).length >= 2 && value.length >= 5;
}
function normalizeKey(value: string) { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function clean(value: unknown) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function text(value: unknown) { const v = clean(value); return v || null; }
function normalizeCountry(value: unknown) {
  const raw = clean(value);
  if (!raw) return null;
  if (/^[a-z]{2}$/i.test(raw)) return raw.toUpperCase();
  const map: Record<string, string> = {
    'united states': 'US', usa: 'US', canada: 'CA', 'united kingdom': 'GB', germany: 'DE', kuwait: 'KW',
    qatar: 'QA', bahrain: 'BH', iraq: 'IQ', poland: 'PL', australia: 'AU', japan: 'JP', 'south korea': 'KR',
    mexico: 'MX', spain: 'ES', italy: 'IT', greece: 'GR',
  };
  return map[raw.toLowerCase()] || null;
}
function positiveIntegerEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
