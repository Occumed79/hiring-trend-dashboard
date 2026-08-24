import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/client';
import { runUniversalIngest } from '@/lib/ingest/runUniversalIngest';
import { runSupplementalIngest } from '@/lib/ingest/runSupplementalIngest';
import { refreshTheirStackForEntity } from '@/lib/ingest/theirStackEntityRefresh';
import { readSourceCoverage } from '@/lib/ingest/sourceCoverage';
import { readCoverageAssessment } from '@/lib/ingest/coverageAssessment';
import { readEntityJobSources } from '@/lib/ingest/entityJobSources';
import { readOpenSourceIncidents, refreshStaleSourceReliabilityOnRead } from '@/lib/ingest/sourceReliability';
import { monitorsForEntityLive } from '@/lib/ingest/theirStackMonitors';
import { getTheirStackExportSecret } from '@/lib/ingest/theirStackExportSecret';
import { getVerifiedActiveJobs, hasRealMappedLocation } from '@/lib/verifiedJobs';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    await refreshStaleSourceReliabilityOnRead(params.id).catch(() => {});

    const [entities, logs, jobs, sourceCoverage, assessment, sourceGraph, sourceIncidents] = await Promise.all([
      query(`SELECT id, name, aliases, created_at, updated_at, ats_provider, ats_board_id, career_page_url,
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
    const theirStackMonitors = await monitorsForEntityLive(entity);
    const configuredTheirStackMonitors = theirStackMonitors.filter(monitor => Boolean(String(process.env[monitor.envKey] || '').trim()));
    const liveTheirStackMonitors = theirStackMonitors.filter(monitor => monitor.source === 'live_list');
    const theirStackExportSecret = await getTheirStackExportSecret().catch(() => null);
    const legacyTheirStack = ['1', 'true', 'yes', 'on'].includes(String(process.env.THEIRSTACK_LEGACY_JOB_SEARCH_ENABLED || '').trim().toLowerCase());

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
      integrations: {
        theirstack: {
          monitored: theirStackMonitors.length > 0,
          configured: configuredTheirStackMonitors.length > 0,
          mode: theirStackMonitors.length
            ? `${legacyTheirStack ? 'Full Job Search' : 'Credit-aware Company Search'} · ${configuredTheirStackMonitors.length}/${theirStackMonitors.length} workspace${theirStackMonitors.length === 1 ? '' : 's'} configured · ${liveTheirStackMonitors.length ? 'live saved-list sync' : 'bootstrap monitor fallback'}`
            : 'Not in the live TheirStack monitor assignments for this entity.',
        },
        theirstack_export: {
          configured: Boolean(theirStackExportSecret?.secret),
          mode: theirStackExportSecret
            ? `${theirStackExportSecret.source === 'environment' ? 'Configured' : 'Auto-provisioned'} receiver token · one-click TheirStack Job Search handoff + company-credit Job Export receiver.`
            : 'Export receiver token could not be provisioned.',
        },
        keenable: { configured: Boolean(String(process.env.KEENABLE_API_KEY || '').trim()), mode: 'Supplemental employer-specific web discovery.' },
        algolia: { configured: Boolean(String(process.env.ALGOLIA_APP_ID || '').trim() && String(process.env.ALGOLIA_SEARCH_API_KEY || process.env.ALGOLIA_WRITE_API_KEY || '').trim()), mode: 'Global job index · live database fallback enabled.' },
        clarifai: { configured: Boolean(String(process.env.CLARIFAI_PAT || '').trim()), mode: 'Primary occupational-health enrichment.' },
        groq: { configured: Boolean(String(process.env.GROQ_API_KEY || '').trim()), mode: 'Occupational-health fallback model.' },
        langsearch: { configured: Boolean(String(process.env.LANGSEARCH_API_KEY || process.env.LANGSEARCH_API_KEY_2 || '').trim()), mode: 'Verified web discovery and corroboration.' },
        nlx: { configured: Boolean(String(process.env.NLX_API_KEY || '').trim()), mode: 'National Labor Exchange verification.' },
        careeronestop: { configured: Boolean(String(process.env.CAREERONESTOP_API_TOKEN || '').trim() && String(process.env.CAREERONESTOP_USER_ID || '').trim()), mode: 'CareerOneStop verification.' },
      },
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

    const theirstack = await refreshTheirStackForEntity(params.id).catch(error => ({
      status: 'error',
      imported_jobs: 0,
      signal_jobs: 0,
      reason: error instanceof Error ? error.message : String(error),
    }));
    const supplemental = await runSupplementalIngest(params.id);

    return NextResponse.json({ ...result, supplemental, theirstack });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not refresh entity.' }, { status: 500 });
  }
}
