import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/client';
import { inferPoint } from '@/lib/geo/locationLookup';
import { extractLocationCandidates } from '@/lib/geo/locationSignals';
import { assessJobQuality } from '@/lib/ingest/jobQuality';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const VALID_PORTALS = new Set(['current_clients', 'prospects', 'private_companies', 'federal_agencies', 'state_agencies', 'counties_and_cities']);
const VALID_ROLE_CATEGORIES = new Set(['security', 'logistics', 'medical', 'admin', 'aviation', 'engineering', 'remote', 'overseas', 'other']);
const US_STATE_CODES = new Set('AL AK AZ AR CA CO CT DC DE FL GA HI IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY'.split(' '));

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const portal = searchParams.get('portal');
    const entityId = searchParams.get('entity_id');
    const country = searchParams.get('country');
    const roleCategory = searchParams.get('role_category');
    const newOnly = searchParams.get('new_only') === 'true';
    const overseasOnly = searchParams.get('overseas_only') === 'true';
    const federalOnly = searchParams.get('federal_only') === 'true';
    const includeMeta = searchParams.get('include_meta') === 'true';
    // Fake entity/state fallback pins are intentionally OFF by default. The map
    // should represent known job cities, not an employer headquarters guess.
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
    if (country) { params.push(country.toUpperCase()); sql += ` AND UPPER(j.country) = $${params.length}`; }
    if (roleCategory) { params.push(roleCategory); sql += ` AND j.role_category = $${params.length}`; }
    if (newOnly) { params.push(new Date(Date.now() - 7 * 86400000).toISOString()); sql += ` AND j.posted_at IS NOT NULL AND j.posted_at >= $${params.length}`; }
    if (overseasOnly) sql += ` AND j.is_overseas = true`;
    if (federalOnly) { params.push('federal_agencies'); sql += ` AND e.portal = $${params.length}`; }
    sql += ` LIMIT 5000`;

    const rows = (await query(sql, params)).filter((row: any) => assessJobQuality(row).ok);
    const buckets = new Map<string, any>();
    let unmappedJobs = 0;
    let realMappedJobs = 0;
    let fallbackJobs = 0;

    for (const row of rows) {
      const rawData = parseRawData(row.raw_data);
      const storedQuality = String(rawData?.normalized_location_quality || '').toLowerCase();
      const storedWasFallback = storedQuality.includes('fallback') || storedQuality.includes('unmapped_no_job_location') || !!rawData?.normalized_fallback_point;
      const candidates = extractLocationCandidates(row);
      const inferred = inferPoint({ ...row, lat: storedWasFallback ? null : row.lat, lng: storedWasFallback ? null : row.lng, location_candidates: candidates });
      const sourceLat = storedWasFallback ? null : toFiniteNumber(row.lat);
      const sourceLng = storedWasFallback ? null : toFiniteNumber(row.lng);
      const inferredLat = toFiniteNumber(inferred?.lat);
      const inferredLng = toFiniteNumber(inferred?.lng);
      const lat = sourceLat ?? inferredLat;
      const lng = sourceLng ?? inferredLng;
      if (lat === null || lng === null) { unmappedJobs += 1; continue; }

      const quality = storedWasFallback ? inferred?.note || 'entity fallback' : inferred?.note || (sourceLat !== null && sourceLng !== null ? 'source coordinates' : 'location match');
      const isFallback = /fallback/i.test(String(quality || ''));
      if (isFallback) {
        fallbackJobs += 1;
        if (!includeFallback) continue;
      }

      const city = cleanCity(storedWasFallback ? inferred?.city : row.city || inferred?.city);
      const state = normalizeState(storedWasFallback ? inferred?.state : row.state || inferred?.state);
      let rowCountry = normalizeCountry(row.country || inferred?.country);
      if (state && US_STATE_CODES.has(state)) rowCountry = 'US';

      // City is the minimum precision shown on the production map. State-only,
      // country-only, remote-centroid, or entity-HQ guesses remain in diagnostics
      // instead of becoming misleading dots.
      if (!city || /^remote$/i.test(city)) {
        if (!isFallback) unmappedJobs += 1;
        continue;
      }

      if (isFallback && !includeFallback) continue;
      if (!isFallback) realMappedJobs += 1;

      const key = [city.toLowerCase(), state || '', rowCountry || '', row.entity_name || '', isFallback ? 'fallback' : 'real'].join('|');
      const existing = buckets.get(key) || {
        city,
        state,
        country: rowCountry,
        role_category: row.role_category,
        is_remote: row.is_remote,
        is_overseas: row.is_overseas,
        entity_name: row.entity_name,
        portal: row.portal,
        location_quality: isFallback ? 'fallback city' : 'city-level job location',
        is_fallback: isFallback,
        cnt: 0,
        lat_sum: 0,
        lng_sum: 0,
        point_count: 0,
      };
      existing.cnt += 1;
      existing.lat_sum += lat;
      existing.lng_sum += lng;
      existing.point_count += 1;
      buckets.set(key, existing);
    }

    const locations = Array.from(buckets.values()).map(bucket => {
      // Prefer a known canonical city center when our deterministic lookup knows
      // the city; otherwise average trusted job coordinates within that city.
      const cityCenter = inferPoint({ city: bucket.city, state: bucket.state, country: bucket.country, location: [bucket.city, bucket.state, bucket.country].filter(Boolean).join(', ') });
      const canonicalIsFallback = /fallback/i.test(String(cityCenter?.note || ''));
      const lat = cityCenter && !canonicalIsFallback ? Number(cityCenter.lat) : bucket.lat_sum / Math.max(1, bucket.point_count);
      const lng = cityCenter && !canonicalIsFallback ? Number(cityCenter.lng) : bucket.lng_sum / Math.max(1, bucket.point_count);
      const { lat_sum, lng_sum, point_count, ...publicBucket } = bucket;
      return { ...publicBucket, lat, lng };
    });

    if (includeMeta) return NextResponse.json({
      locations,
      meta: {
        total_jobs: rows.length,
        real_mapped_jobs: realMappedJobs,
        mapped_jobs: realMappedJobs,
        fallback_jobs: fallbackJobs,
        unmapped_jobs: Math.max(0, rows.length - realMappedJobs - fallbackJobs),
        location_count: locations.length,
        map_precision: 'city',
        fallback_visible: includeFallback,
      },
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
    return NextResponse.json(locations, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function cleanCity(value: unknown) { const text=String(value||'').replace(/\s+/g,' ').trim(); return text || null; }
function normalizeState(value: unknown) { const text=String(value||'').trim(); return /^[A-Za-z]{2}$/.test(text) ? text.toUpperCase() : text || null; }
function normalizeCountry(value: unknown) { const text=String(value||'').trim(); if (!text) return null; const lower=text.toLowerCase(); const map:Record<string,string>={us:'US',usa:'US','united states':'US','united states of america':'US',gb:'GB',uk:'GB','united kingdom':'GB',ca:'CA',canada:'CA',de:'DE',germany:'DE',kw:'KW',kuwait:'KW',qa:'QA',qatar:'QA',bh:'BH',bahrain:'BH',iq:'IQ',iraq:'IQ',pl:'PL',poland:'PL',au:'AU',australia:'AU',jp:'JP',japan:'JP'}; return map[lower] || (/^[A-Za-z]{2}$/.test(text) ? text.toUpperCase() : text); }
function toFiniteNumber(value: unknown) { if (value === null || value === undefined || value === '') return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function parseRawData(value: unknown) {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, any>;
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return {}; } }
  return {};
}
