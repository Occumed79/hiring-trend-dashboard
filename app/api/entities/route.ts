import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/client';
import { resolveCompany } from '@/lib/ingest/companyResolver';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const portal = searchParams.get('portal');

  let sql = `
    SELECT e.*,
      COALESCE((SELECT COUNT(*) FROM jobs j WHERE j.entity_id = e.id AND j.is_active = true), 0) AS open_jobs,
      COALESCE((SELECT COUNT(*) FROM jobs j WHERE j.entity_id = e.id AND (j.posted_at >= NOW() - INTERVAL '7 days' OR j.created_at >= NOW() - INTERVAL '7 days')), 0) AS new_this_week
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
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { aliases, portal, career_page_url, ats_provider, ats_board_id, industry, category } = body;
  const name = String(body.name || '').trim();

  if (!name || !portal) {
    return NextResponse.json({ error: 'name and portal required' }, { status: 400 });
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

  const finalAliases = Array.from(new Set([...(aliases || []), ...(resolved?.aliases || [])]));
  const finalCareerUrl = career_page_url || resolved?.career_page_url || null;
  const finalAtsProvider = ats_provider && ats_provider !== 'unknown'
    ? ats_provider
    : resolved?.ats_provider || 'unknown';
  const finalBoardId = ats_board_id || resolved?.ats_board_id || null;

  const rows = await query(
    `INSERT INTO entities (name, aliases, portal, career_page_url, ats_provider, ats_board_id, industry, category)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [name, finalAliases, portal, finalCareerUrl, finalAtsProvider, finalBoardId, industry, category]
  );

  fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': process.env.CRON_SECRET || '' },
    body: JSON.stringify({ entity_id: rows[0].id }),
  }).catch(() => {});

  return NextResponse.json({ ...rows[0], resolution: resolved }, { status: 201 });
}
