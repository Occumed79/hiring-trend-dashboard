import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/client';
import { inferPoint } from '@/lib/geo/locationLookup';
import { extractLocationCandidates } from '@/lib/geo/locationSignals';
import { assessJobQuality } from '@/lib/ingest/jobQuality';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const VALID_PORTALS = new Set(['current_clients', 'prospects', 'private_companies', 'federal_agencies', 'state_agencies', 'counties_and_cities']);
const VALID_ROLE_CATEGORIES = new Set(['security', 'logistics', 'medical', 'admin', 'aviation', 'engineering', 'other']);
const US_STATE_CODES = new Set('AL AK AZ AR CA CO CT DC DE FL GA HI IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY'.split(' '));

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const portal = searchParams.get('portal');
    const entityId = searchParams.get('entity_id');
    const country = searchParams.get('country');
    const roleCategory = searchParams.get('role_category');
    const newOnly = searchParams.get('new_only') === 'true';
    const remoteOnly = searchParams.get('remote_only') === 'true';
    const federalOnly = searchParams.get('federal_only') === 'true';
    const includeMeta = searchParams.get('include_meta') === 'true';
    const includeFallback = searchParams.get('include_fallback') === 'true';

    if (portal && !VALID_PORTALS.has(portal)) return NextResponse.json({ error: 'Invalid portal' }, { status: 400 });
    if (roleCategory && !VALID_ROLE_CATEGORIES.has(roleCategory)) return NextResponse.json({ error: 'Invalid role category' }, { status: 400 });

    let sql = `
      SELECT j.id, j.title, j.source, j.city, j.state, j.country, j.location, j.lat, j.lng, j.role_category,
             j.is_remote, j.is_overseas, j.posted_at, j.created_at, j.raw_data,
             e.name as entity_name, e.portal
      FROM jobs j
      JOIN entities e ON e.id = j.entity_id
      WHERE j.is_active = true AND e.is_active = true
    `;
    const params: any[] = [];
    if (portal) { params.push(portal); sql += ` AND e.portal = $${params.length}`; }
    if (entityId) { params.push(entityId); sql += ` AND j.entity_id = $${params.length}`; }
    // Country filtering happens after normalization below. That is intentional:
    // legacy rows such as Chantilly, VA, GB must be reconciled to US by state evidence
    // before a country filter is applied.
    if (roleCategory) { params.push(roleCategory); sql += ` AND j.role_category = $${params.length}`; }
    if (newOnly) { params.push(new Date(Date.now() - 7 * 86400000).toISOString()); sql += ` AND j.posted_at IS NOT NULL AND j.posted_at >= $${params.length}`; }
    if (remoteOnly) sql += ` AND j.is_remote = true`;
    if (federalOnly) { params.push('federal_agencies'); sql += ` AND e.portal = $${params.length}`; }
    sql += ` ORDER BY COALESCE(j.posted_at, j.created_at) DESC NULLS LAST LIMIT 10000`;

    const rows = (await query(sql, params)).filter((row: any) => assessJobQuality(row).ok);
    const points: any[] = [];
    const distinctCities = new Set<string>();
    let unmappedJobs = 0;
    let fallbackJobs = 0;
    let realMappedJobs = 0;

    for (const row of rows) {
      const rawData = parseRawData(row.raw_data);
      const storedQuality = String(rawData?.normalized_location_quality || '').toLowerCase();
      const storedWasFallback = storedQuality.includes('fallback') || storedQuality.includes('unmapped_no_job_location') || !!rawData?.normalized_fallback_point;
      const candidates = extractLocationCandidates(row);
      const inferred = inferPoint({ ...row, lat: storedWasFallback ? null : row.lat, lng: storedWasFallback ? null : row.lng, location_candidates: candidates });
      const sourceLat = storedWasFallback ? null : toFiniteNumber(row.lat);
      const sourceLng = storedWasFallback ? null : toFiniteNumber(row.lng);
      const baseLat = sourceLat ?? toFiniteNumber(inferred?.lat);
      const baseLng = sourceLng ?? toFiniteNumber(inferred?.lng);
      if (baseLat === null || baseLng === null) { unmappedJobs += 1; continue; }

      const quality = storedWasFallback
        ? inferred?.note || 'entity fallback'
        : inferred?.note || (sourceLat !== null && sourceLng !== null ? 'source coordinates' : 'location match');
      const isFallback = /fallback/i.test(String(quality || ''));
      if (isFallback) {
        fallbackJobs += 1;
        if (!includeFallback) continue;
      }

      const city = cleanCity(storedWasFallback ? inferred?.city : row.city || inferred?.city);
      const state = normalizeState(storedWasFallback ? inferred?.state : row.state || inferred?.state);
      let rowCountry = normalizeCountry(row.country || inferred?.country);
      if (state && US_STATE_CODES.has(state)) rowCountry = 'US';

      // Production map precision is city-level or better. Country/state/HQ fallback
      // centroids are deliberately hidden from the normal map.
      if (!city || /^remote$/i.test(city)) { unmappedJobs += 1; continue; }
      if (country && rowCountry !== country.toUpperCase()) continue;

      const [lat, lng] = visualOffset(baseLat, baseLng, String(row.id));
      distinctCities.add([city.toLowerCase(), state || '', rowCountry || '', row.entity_name || ''].join('|'));
      if (!isFallback) realMappedJobs += 1;
      points.push({
        job_id: String(row.id),
        title: row.title,
        source: row.source,
        city,
        state,
        country: rowCountry,
        location: row.location,
        role_category: row.role_category,
        is_remote: Boolean(row.is_remote),
        is_overseas: rowCountry ? rowCountry !== 'US' : Boolean(row.is_overseas),
        entity_name: row.entity_name,
        portal: row.portal,
        location_quality: isFallback ? 'fallback city' : 'city-level job location',
        is_fallback: isFallback,
        lat,
        lng,
        base_lat: baseLat,
        base_lng: baseLng,
        cnt: 1,
      });
    }

    if (includeMeta) return NextResponse.json({
      locations: points,
      meta: {
        total_jobs: rows.length,
        mapped_jobs: realMappedJobs,
        real_mapped_jobs: realMappedJobs,
        fallback_jobs: fallbackJobs,
        unmapped_jobs: unmappedJobs,
        point_count: points.length,
        location_count: distinctCities.size,
        map_precision: 'city',
        point_mode: 'individual_jobs',
        fallback_visible: includeFallback,
      },
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });

    return NextResponse.json(points, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function visualOffset(lat: number, lng: number, seed: string): [number, number] {
  const hash = hashString(seed);
  const angle = ((hash % 3600) / 3600) * Math.PI * 2;
  const radius = 0.035 + (((hash >>> 8) % 1000) / 1000) * 0.28;
  const latitude = clamp(lat + Math.sin(angle) * radius, -84.5, 84.5);
  const longitudeScale = Math.max(0.35, Math.cos((lat * Math.PI) / 180));
  const longitude = wrapLongitude(lng + (Math.cos(angle) * radius) / longitudeScale);
  return [latitude, longitude];
}
function hashString(value: string) { let hash = 2166136261; for (let i=0;i<value.length;i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); } return hash >>> 0; }
function wrapLongitude(value: number) { let result = value; while (result > 180) result -= 360; while (result < -180) result += 360; return result; }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function cleanCity(value: unknown) { const text=String(value||'').replace(/\s+/g,' ').trim(); return text || null; }
function normalizeState(value: unknown) { const text=String(value||'').trim(); return /^[A-Za-z]{2}$/.test(text) ? text.toUpperCase() : text || null; }
function normalizeCountry(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  const map: Record<string,string> = {
    us:'US', usa:'US', 'united states':'US', 'united states of america':'US',
    gb:'GB', uk:'GB', 'united kingdom':'GB',
    ca:'CA', canada:'CA', de:'DE', germany:'DE', kw:'KW', kuwait:'KW', qa:'QA', qatar:'QA',
    bh:'BH', bahrain:'BH', iq:'IQ', iraq:'IQ', pl:'PL', poland:'PL', au:'AU', australia:'AU',
    jp:'JP', japan:'JP', kr:'KR', 'south korea':'KR', ae:'AE', uae:'AE', 'united arab emirates':'AE',
    sa:'SA', 'saudi arabia':'SA', mx:'MX', mexico:'MX', fr:'FR', france:'FR', es:'ES', spain:'ES',
    it:'IT', italy:'IT', be:'BE', belgium:'BE', nl:'NL', netherlands:'NL', ke:'KE', kenya:'KE',
    ug:'UG', uganda:'UG', mu:'MU', mauritius:'MU', sc:'SC', seychelles:'SC', io:'IO', 'british indian ocean territory':'IO',
  };
  return map[lower] || (/^[A-Za-z]{2}$/.test(text) ? text.toUpperCase() : null);
}
function toFiniteNumber(value: unknown) { if (value === null || value === undefined || value === '') return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function parseRawData(value: unknown) { if (!value) return {}; if (typeof value === 'object') return value as Record<string, any>; if (typeof value === 'string') { try { return JSON.parse(value); } catch { return {}; } } return {}; }
