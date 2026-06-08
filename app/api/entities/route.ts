import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/client';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const portal = searchParams.get('portal');
  
  let sql = `SELECT * FROM entities WHERE is_active = true`;
  const params: any[] = [];
  if (portal) {
    params.push(portal);
    sql += ` AND portal = $${params.length}`;
  }
  sql += ` ORDER BY name ASC`;
  
  const rows = await query(sql, params);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, aliases, portal, career_page_url, ats_provider, ats_board_id, industry, category } = body;
  
  if (!name || !portal) {
    return NextResponse.json({ error: 'name and portal required' }, { status: 400 });
  }

  const rows = await query(
    `INSERT INTO entities (name, aliases, portal, career_page_url, ats_provider, ats_board_id, industry, category)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [name, aliases || [], portal, career_page_url, ats_provider || 'unknown', ats_board_id, industry, category]
  );

  // Trigger initial ingest for this new entity
  fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': process.env.CRON_SECRET || '' },
    body: JSON.stringify({ entity_id: rows[0].id }),
  }).catch(() => {});

  return NextResponse.json(rows[0], { status: 201 });
}
