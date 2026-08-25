import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/client';
import { filterVerifiedJobs, isNewThisWeek } from '@/lib/verifiedJobs';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const VALID_PORTALS = new Set(['current_clients','prospects','private_companies','federal_agencies','state_agencies','counties_and_cities']);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const portal = searchParams.get('portal');
    if (!portal) return NextResponse.json({ error: 'portal required' }, { status: 400 });
    if (!VALID_PORTALS.has(portal)) return NextResponse.json({ error: 'Invalid portal' }, { status: 400 });

    const entities = await query(`SELECT id FROM entities WHERE is_active = true AND portal = $1`, [portal]);
    if (!entities.length) return NextResponse.json({ total_entities: 0, active_hiring: 0, open_roles: 0, new_this_week: 0 }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
    const ids = entities.map((row: any) => row.id);
    const rawJobs = await query(
      `SELECT id, entity_id, title, department, role_category, location, city, state, country, lat, lng,
              source, external_id, posted_at, created_at, updated_at, is_remote, is_overseas, raw_data
       FROM jobs WHERE is_active = true AND entity_id = ANY($1::uuid[])`, [ids]
    );
    const jobs = filterVerifiedJobs(rawJobs);
    const hiringEntities = new Set(jobs.map((job: any) => job.entity_id));

    return NextResponse.json({
      total_entities: entities.length,
      active_hiring: hiringEntities.size,
      open_roles: jobs.length,
      new_this_week: jobs.filter((job: any) => isNewThisWeek(job)).length,
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
