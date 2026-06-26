import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/client';

const VALID_ROLE_CATEGORIES = new Set(['security', 'logistics', 'medical', 'admin', 'aviation', 'engineering', 'remote', 'overseas', 'other']);

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { searchParams } = new URL(req.url);
    const active = searchParams.get('active') !== 'false';
    const role = searchParams.get('role');
    const source = searchParams.get('source');
    const limit = getSafeLimit(searchParams.get('limit'));

    if (role && !VALID_ROLE_CATEGORIES.has(role)) {
      return NextResponse.json({ error: 'Invalid role category' }, { status: 400 });
    }

    let sql = `
      SELECT id, title, department, role_category, location, city, state, country,
             source, external_id, posted_at, created_at, updated_at, is_active,
             COALESCE(raw_data->>'normalized_apply_url', raw_data->>'url', raw_data->>'job_apply_link', raw_data->>'job_url') AS url,
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function getSafeLimit(value: string | null) {
  const parsed = Number(value || 100);
  if (!Number.isFinite(parsed) || parsed <= 0) return 100;
  return Math.min(Math.floor(parsed), 500);
}
