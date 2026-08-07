import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/client';
import { runUniversalIngest } from '@/lib/ingest/runUniversalIngest';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const [entities, logs, coverage] = await Promise.all([
      query(`SELECT id, created_at, updated_at, ats_provider, ats_board_id, career_page_url FROM entities WHERE id = $1 LIMIT 1`, [params.id]),
      query(`SELECT status, source, jobs_found, jobs_new, jobs_closed, error_message, ran_at
             FROM ingest_log WHERE entity_id = $1 ORDER BY ran_at DESC LIMIT 1`, [params.id]),
      query(`SELECT
               COUNT(*) FILTER (WHERE is_active = true)::int AS active_jobs,
               COUNT(*) FILTER (WHERE is_active = true AND lat IS NOT NULL AND lng IS NOT NULL
                 AND COALESCE(raw_data->>'normalized_location_quality','') NOT ILIKE '%fallback%')::int AS mapped_jobs,
               COUNT(*) FILTER (WHERE is_active = true AND COALESCE(raw_data->>'normalized_location_quality','') = 'geocoded job location')::int AS geocoded_jobs,
               COUNT(*) FILTER (WHERE is_active = true AND (lat IS NULL OR lng IS NULL))::int AS unmapped_jobs
             FROM jobs WHERE entity_id = $1`, [params.id]),
    ]);

    if (!entities.length) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
    const entity = entities[0];
    const latest = logs[0] || null;
    const createdAt = new Date(entity.created_at).getTime();
    const lastRunAt = latest?.ran_at ? new Date(latest.ran_at).getTime() : 0;
    const awaitingInitialIngest = !latest || lastRunAt < createdAt;

    return NextResponse.json({
      status: awaitingInitialIngest ? 'queued' : latest.status,
      source: latest?.source || null,
      last_run_at: latest?.ran_at || null,
      jobs_found: Number(latest?.jobs_found || 0),
      jobs_new: Number(latest?.jobs_new || 0),
      jobs_closed: Number(latest?.jobs_closed || 0),
      error: latest?.error_message || null,
      ats_provider: entity.ats_provider || 'unknown',
      ats_board_id: entity.ats_board_id || null,
      career_page_url: entity.career_page_url || null,
      coverage: coverage[0] || { active_jobs: 0, mapped_jobs: 0, geocoded_jobs: 0, unmapped_jobs: 0 },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load ingest status.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = await runUniversalIngest(params.id, { reconcile: body?.reconcile !== false });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not refresh entity.' }, { status: 500 });
  }
}
