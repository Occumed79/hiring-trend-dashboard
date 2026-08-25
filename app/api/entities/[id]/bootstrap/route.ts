import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/client';
import { runUniversalIngest } from '@/lib/ingest/runUniversalIngest';
import { runSupplementalIngest } from '@/lib/ingest/runSupplementalIngest';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Initial profile hydration path used by the one-time TheirStack tracker bootstrap.
 *
 * This intentionally does NOT call refreshTheirStackForEntity(). TheirStack remains
 * attached to the profile through the monitor registry, but creating 100+ profiles
 * should not spend Company Search credits just to hydrate their first profile view.
 * Official/ATS discovery runs first and the normal supplemental stack fills gaps.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const rows = await query(
      `SELECT id, name, category, is_active FROM entities WHERE id = $1 LIMIT 1`,
      [params.id],
    );
    if (!rows.length) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
    if (!rows[0].is_active) return NextResponse.json({ error: 'Entity is inactive' }, { status: 409 });

    const body = await req.json().catch(() => ({}));
    const reconcile = body?.reconcile !== false;

    const core = await runUniversalIngest(params.id, { reconcile });
    const supplemental = await runSupplementalIngest(params.id);

    return NextResponse.json({
      bootstrap_protocol: 'theirstack-profile-v1',
      entity_id: params.id,
      entity: rows[0].name,
      tracker_profile: String(rows[0].category || '').includes('theirstack-monitor'),
      core,
      supplemental,
      theirstack_company_search_spent: false,
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Could not bootstrap profile.',
      bootstrap_protocol: 'theirstack-profile-v1',
    }, { status: 500 });
  }
}
