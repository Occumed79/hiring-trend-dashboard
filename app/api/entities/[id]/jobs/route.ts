import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/client';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(req.url);
  const active = searchParams.get('active') !== 'false';
  const role = searchParams.get('role');
  const source = searchParams.get('source');
  const limit = Math.min(Number(searchParams.get('limit') || 100), 500);

  let sql = `
    SELECT id, title, department, role_category, location, city, state, country,
           source, external_id, posted_at, created_at, updated_at, is_active,
           raw_data->>'url' AS url,
           raw_data->>'careerPageUrl' AS career_page_url
    FROM jobs
    WHERE entity_id = $1`;
  const args: any[] = [params.id];

  if (active) sql += ` AND is_active = true`;
  if (role) {
    args.push(role);
    sql += ` AND role_category = $${args.length}`;
  }
  if (source) {
    args.push(source);
    sql += ` AND source = $${args.length}`;
  }

  args.push(limit);
  sql += ` ORDER BY COALESCE(posted_at, created_at) DESC NULLS LAST, title ASC LIMIT $${args.length}`;

  const rows = await query(sql, args);
  return NextResponse.json(rows);
}
