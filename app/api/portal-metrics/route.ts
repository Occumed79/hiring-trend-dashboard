import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/client';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const portal = searchParams.get('portal');
  if (!portal) return NextResponse.json({ error: 'portal required' }, { status: 400 });

  const rows = await query(
    `SELECT
       COUNT(DISTINCT e.id)::int AS total_entities,
       COUNT(DISTINCT e.id) FILTER (WHERE EXISTS (
         SELECT 1 FROM jobs j WHERE j.entity_id = e.id AND j.is_active = true
       ))::int AS active_hiring,
       COUNT(j.id)::int AS open_roles,
       COUNT(j.id) FILTER (WHERE COALESCE(j.posted_at, j.created_at) >= NOW() - INTERVAL '7 days')::int AS new_this_week
     FROM entities e
     LEFT JOIN jobs j ON j.entity_id = e.id AND j.is_active = true
     WHERE e.is_active = true AND e.portal = $1`,
    [portal]
  );

  return NextResponse.json(rows[0] || {
    total_entities: 0,
    active_hiring: 0,
    open_roles: 0,
    new_this_week: 0,
  });
}
