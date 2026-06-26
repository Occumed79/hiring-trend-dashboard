import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/client';
import { inferPoint } from '@/lib/geo/locationLookup';

const VALID_PORTALS = new Set(['current_clients', 'prospects', 'private_companies', 'federal_agencies', 'state_agencies', 'counties_and_cities']);
const VALID_ROLE_CATEGORIES = new Set(['security', 'logistics', 'medical', 'admin', 'aviation', 'engineering', 'remote', 'overseas', 'other']);

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

    if (portal && !VALID_PORTALS.has(portal)) {
      return NextResponse.json({ error: 'Invalid portal' }, { status: 400 });
    }
    if (roleCategory && !VALID_ROLE_CATEGORIES.has(roleCategory)) {
      return NextResponse.json({ error: 'Invalid role category' }, { status: 400 });
    }

    let sql = `
      SELECT j.city, j.state, j.country, j.location, j.lat, j.lng, j.role_category,
             j.is_remote, j.is_overseas, j.posted_at, j.created_at,
             e.name as entity_name, e.portal
      FROM jobs j
      JOIN entities e ON e.id = j.entity_id
      WHERE j.is_active = true AND e.is_active = true
    `;
    const params: any[] = [];

    if (portal) {
      params.push(portal);
      sql += ` AND e.portal = $${params.length}`;
    }
    if (entityId) {
      params.push(entityId);
      sql += ` AND j.entity_id = $${params.length}`;
    }
    if (country) {
      params.push(country.toUpperCase());
      sql += ` AND UPPER(j.country) = $${params.length}`;
    }
    if (roleCategory) {
      params.push(roleCategory);
      sql += ` AND j.role_category = $${params.length}`;
    }
    if (newOnly) {
      const d7 = new Date(Date.now() - 7 * 86400000).toISOString();
      params.push(d7);
      sql += ` AND COALESCE(j.posted_at, j.created_at) >= $${params.length}`;
    }
    if (overseasOnly) {
      sql += ` AND j.is_overseas = true`;
    }
    if (federalOnly) {
      params.push('federal_agencies');
      sql += ` AND e.portal = $${params.length}`;
    }

    sql += ` LIMIT 5000`;

    const rows = await query(sql, params);
    const buckets = new Map<string, any>();

    for (const row of rows) {
      const inferred = inferPoint(row);
      const lat = toFiniteNumber(row.lat ?? inferred?.lat);
      const lng = toFiniteNumber(row.lng ?? inferred?.lng);
      if (lat === null || lng === null) continue;

      const city = row.city || inferred?.city || null;
      const state = row.state || inferred?.state || null;
      const rowCountry = row.country || inferred?.country || 'US';
      const key = [lat.toFixed(4), lng.toFixed(4), city || '', state || '', rowCountry || '', row.entity_name || ''].join('|');

      const existing = buckets.get(key) || {
        city,
        state,
        country: rowCountry,
        lat,
        lng,
        role_category: row.role_category,
        is_remote: row.is_remote,
        is_overseas: row.is_overseas,
        entity_name: row.entity_name,
        portal: row.portal,
        cnt: 0,
      };
      existing.cnt += 1;
      buckets.set(key, existing);
    }

    return NextResponse.json(Array.from(buckets.values()));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function toFiniteNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
