import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/client';
import { resolveCompany } from '@/lib/ingest/companyResolver';
import { runUniversalIngest } from '@/lib/ingest/runUniversalIngest';

const VALID_PORTALS = new Set([
  'current_clients',
  'prospects',
  'private_companies',
  'federal_agencies',
  'state_agencies',
  'counties_and_cities',
]);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const portal = searchParams.get('portal');

    if (portal && !VALID_PORTALS.has(portal)) {
      return NextResponse.json({ error: 'Invalid portal' }, { status: 400 });
    }

    let sql = `
      SELECT e.*,
        COALESCE((SELECT COUNT(*) FROM jobs j WHERE j.entity_id = e.id AND j.is_active = true), 0)::int AS open_jobs,
        COALESCE((SELECT COUNT(*) FROM jobs j WHERE j.entity_id = e.id AND (j.posted_at >= NOW() - INTERVAL '7 days' OR j.created_at >= NOW() - INTERVAL '7 days')), 0)::int AS new_this_week
      FROM entities e
      WHERE e.is_active = true`;
    const params: any[] = [];

    if (portal) {
      params.push(portal);
      sql += ` AND e.portal = $${params.length}`;
    }

    sql += ` ORDER BY name ASC`;

    const rows = await query(sql, params);
    return NextResponse.json(rows);
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { portal, career_page_url, ats_provider, ats_board_id, industry, category } = body as any;
    const name = String((body as any).name || '').trim();
    const aliases = Array.isArray((body as any).aliases)
      ? (body as any).aliases.map((alias: unknown) => String(alias).trim()).filter(Boolean)
      : [];

    if (!name || !portal) {
      return NextResponse.json({ error: 'name and portal required' }, { status: 400 });
    }
    if (!VALID_PORTALS.has(portal)) {
      return NextResponse.json({ error: 'Invalid portal' }, { status: 400 });
    }

    const duplicate = await query(
      `SELECT * FROM entities WHERE is_active = true AND portal = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2)) LIMIT 1`,
      [portal, name]
    );
    if (duplicate.length) {
      return NextResponse.json({ ...duplicate[0], duplicate: true }, { status: 200 });
    }

    const needsResolve = !career_page_url || !ats_provider || ats_provider === 'unknown' || !ats_board_id;
    const resolved = needsResolve ? await resolveCompany(name, career_page_url || null) : null;

    const finalAliases = Array.from(new Set([...aliases, ...(resolved?.aliases || [])]));
    const finalCareerUrl = career_page_url || resolved?.career_page_url || null;
    const finalAtsProvider = ats_provider && ats_provider !== 'unknown'
      ? ats_provider
      : resolved?.ats_provider || 'unknown';
    const finalBoardId = ats_board_id || resolved?.ats_board_id || null;

    const rows = await query(
      `INSERT INTO entities (name, aliases, portal, career_page_url, ats_provider, ats_board_id, industry, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [name, finalAliases, portal, finalCareerUrl, finalAtsProvider, finalBoardId, industry || null, category || null]
    );

    void runUniversalIngest(rows[0].id).catch((error) => {
      console.error(`Background ingest failed for entity ${rows[0].id}:`, error);
    });

    return NextResponse.json({ ...rows[0], resolution: resolved }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected server error';
}
