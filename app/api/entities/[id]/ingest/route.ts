import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/client';
import { runUniversalIngest } from '@/lib/ingest/runUniversalIngest';
import { readSourceCoverage } from '@/lib/ingest/sourceCoverage';
import { readCoverageAssessment } from '@/lib/ingest/coverageAssessment';
import { readEntityJobSources } from '@/lib/ingest/entityJobSources';
import { readOpenSourceIncidents, refreshStaleSourceReliabilityOnRead } from '@/lib/ingest/sourceReliability';
import { getVerifiedActiveJobs, hasRealMappedLocation } from '@/lib/verifiedJobs';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    // This read-path guard catches a full ingest/cron outage once authoritative
    // checks exceed the stale threshold. Failure here must not break the detail page.
    await refreshStaleSourceReliabilityOnRead(params.id).catch(() => {});

    const [entities, logs, jobs, sourceCoverage, assessment, sourceGraph, sourceIncidents] = await Promise.all([
      query(`SELECT id, created_at, updated_at, ats_provider, ats_board_id, career_page_url,
                    government_registry_id, government_type, government_state, government_fips
             FROM entities WHERE id = $1 LIMIT 1`, [params.id]),
      query(`SELECT status, source, jobs_found, jobs_new, jobs_closed, error_message, ran_at
             FROM ingest_log WHERE entity_id = $1 ORDER BY ran_at DESC LIMIT 1`, [params.id]),
      getVerifiedActiveJobs(params.id),
      readSourceCoverage(params.id),
      readCoverageAssessment(params.id),
      readEntityJobSources(params.id),
      readOpenSourceIncidents(params.id),
    ]);

    if (!entities.length) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
    const entity = entities[0];
    const latest = logs[0] || null;
    const createdAt = new Date(entity.created_at).getTime();
    const lastRunAt = latest?.ran_at ? new Date(latest.ran_at).getTime() : 0;
    const awaitingInitialIngest = !latest || lastRunAt < createdAt;
    const mapped = jobs.filter(hasRealMappedLocation);
    const geocoded = jobs.filter((job) => String(job.raw_data?.normalized_location_quality || '') === 'geocoded job location');

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
      government_registry: entity.government_registry_id ? {
        id: entity.government_registry_id,
        type: entity.government_type || null,
        state: entity.government_state || null,
        fips: entity.government_fips || null,
      } : null,
      source_coverage: sourceCoverage,
      source_graph: sourceGraph,
      coverage_assessment: assessment,
      source_incidents: sourceIncidents,
      coverage: {
        active_jobs: jobs.length,
        mapped_jobs: mapped.length,
        geocoded_jobs: geocoded.length,
        unmapped_jobs: jobs.length - mapped.length,
      },
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
