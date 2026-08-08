import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/client';
import { governmentGeographicFips } from '@/lib/ingest/governmentRegistry';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = String(searchParams.get('q') || '').trim();
    const portal = String(searchParams.get('portal') || 'counties_and_cities');
    if (q.length < 2) return NextResponse.json([]);
    if (!['state_agencies','counties_and_cities'].includes(portal)) return NextResponse.json({ error: 'Unsupported portal' }, { status: 400 });

    const tokens = q.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(token => token.length >= 2).slice(0, 4);
    if (!tokens.length) return NextResponse.json([]);
    const stateHint = extractStateHint(q);
    const typeHint = extractTypeHint(q);

    const params: any[] = [`%${tokens[0]}%`];
    let sql = `
      SELECT census_government_id, name, government_type, state_code, state_name,
             county_name, state_fips, county_fips, place_fips, website
      FROM government_registry
      WHERE is_active = true AND canonical_name ILIKE $1
    `;
    if (portal === 'counties_and_cities') {
      params.push(['county','municipality','township']);
      sql += ` AND government_type = ANY($2::text[])`;
    }
    if (stateHint) {
      params.push(stateHint);
      sql += ` AND UPPER(COALESCE(state_code,'')) = $${params.length}`;
    }
    sql += ` LIMIT 250`;

    const rows = await query(sql, params);
    const canonicalQuery = canonical(q);
    const results = rows
      .map((row: any) => ({ ...row, score: score(row, canonicalQuery, tokens, typeHint) }))
      .filter((row: any) => row.score >= 35)
      .sort((a: any, b: any) => b.score - a.score || String(a.name).localeCompare(String(b.name)))
      .slice(0, 12)
      .map((row: any) => ({
        id: row.census_government_id,
        name: row.name,
        type: row.government_type,
        state: row.state_code || row.state_name || null,
        county: row.county_name || null,
        fips: governmentGeographicFips(row),
        website: row.website || null,
      }));

    return NextResponse.json(results);
  } catch (error) {
    // Registry population is asynchronous and should not break the add flow.
    return NextResponse.json([], { status: 200, headers: { 'x-registry-status': error instanceof Error ? 'unavailable' : 'error' } });
  }
}

function score(row: any, canonicalQuery: string, tokens: string[], typeHint: string | null) {
  const candidate = canonical(row.name);
  let value = candidate === canonicalQuery ? 100 : 0;
  const hits = tokens.filter(token => candidate.includes(token)).length;
  value += Math.round((hits / Math.max(tokens.length, 1)) * 55);
  if (candidate.includes(canonicalQuery) || canonicalQuery.includes(candidate)) value += 20;
  if (typeHint && String(row.government_type || '') === typeHint) value += 15;
  return value;
}
function canonical(value: unknown) { return String(value || '').toLowerCase().replace(/&/g,' and ').replace(/\b(the|government of)\b/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim(); }
function extractTypeHint(value: string) { const lower = value.toLowerCase(); if (/\bcounty\b/.test(lower)) return 'county'; if (/\b(city|municipality|village|borough)\b/.test(lower)) return 'municipality'; if (/\btown(ship)?\b/.test(lower)) return 'township'; return null; }
function extractStateHint(value: string) { const match = value.match(/(?:,|\s)\s*([A-Z]{2})\b/); return match?.[1] || null; }
