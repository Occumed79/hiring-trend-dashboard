import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/client';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const portal = searchParams.get('portal');
  const entityId = searchParams.get('entity_id');
  const country = searchParams.get('country');
  const roleCategory = searchParams.get('role_category');
  const newOnly = searchParams.get('new_only') === 'true';
  const overseasOnly = searchParams.get('overseas_only') === 'true';
  const federalOnly = searchParams.get('federal_only') === 'true';

  let sql = `
    SELECT j.city, j.state, j.country, j.lat, j.lng, j.role_category,
           j.is_remote, j.is_overseas, j.posted_at, e.name as entity_name, e.portal,
           COUNT(*) as cnt
    FROM jobs j
    JOIN entities e ON e.id = j.entity_id
    WHERE j.is_active = true AND j.lat IS NOT NULL AND j.lng IS NOT NULL
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
    params.push(country);
    sql += ` AND j.country = $${params.length}`;
  }
  if (roleCategory) {
    params.push(roleCategory);
    sql += ` AND j.role_category = $${params.length}`;
  }
  if (newOnly) {
    const d7 = new Date(Date.now() - 7 * 86400000).toISOString();
    params.push(d7);
    sql += ` AND j.posted_at >= $${params.length}`;
  }
  if (overseasOnly) {
    sql += ` AND j.is_overseas = true`;
  }
  if (federalOnly) {
    params.push('federal_agencies');
    sql += ` AND e.portal = $${params.length}`;
  }

  sql += ` GROUP BY j.city, j.state, j.country, j.lat, j.lng, j.role_category, j.is_remote, j.is_overseas, j.posted_at, e.name, e.portal`;
  sql += ` LIMIT 5000`;

  const rows = await query(sql, params);
  return NextResponse.json(rows);
}
