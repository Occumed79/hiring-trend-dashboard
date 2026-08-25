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
import { probeTheirStackJobDatasets } from '@/lib/ingest/theirStackDatasets';
import { getVerifiedActiveJobs, hasRealMappedLocation } from '@/lib/verifiedJobs';
import { firstRuntimeEnv, hasRuntimeEnv, RUNTIME_ENV } from '@/lib/runtimeEnv';

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
    const [theirStackMonitors, theirStackExportSecret, datasetAccess] = await Promise.all([
      monitorsForEntityLive(entity),
      getTheirStackExportSecret().catch(() => null),
      probeTheirStackJobDatasets().catch(error => ({
        checked: 0,
        accessible_workspaces: 0,
        any_accessible: false,
        workspaces: [],
        note: `Dataset entitlement check failed: ${error instanceof Error ? error.message : String(error)}`,
      })),
    ]);
    const configuredTheirStackMonitors = theirStackMonitors.filter(monitor => Boolean(String(process.env[monitor.envKey] || '').trim()));
    const liveTheirStackMonitors = theirStackMonitors.filter(monitor => monitor.source === 'live_list');
    const legacyTheirStack = ['1', 'true', 'yes', 'on'].includes(String(process.env.THEIRSTACK_LEGACY_JOB_SEARCH_ENABLED || '').trim().toLowerCase());

    const algoliaAppId = firstRuntimeEnv([...RUNTIME_ENV.algoliaAppId]);
    const algoliaApiKey = firstRuntimeEnv(['ALGOLIA_SEARCH_API_KEY', 'ALGOLIA_WRITE_API_KEY', 'ALGOLIA_API_KEY']);
    const datasetErrors = Array.isArray(datasetAccess.workspaces) ? datasetAccess.workspaces.filter((row:any) => row.status === 'error').length : 0;
    const datasetState = datasetAccess.any_accessible
      ? 'available'
      : datasetAccess.checked > 0 && datasetErrors < datasetAccess.checked
        ? 'not entitled'
        : datasetErrors > 0
          ? 'check error'
          : 'not configured';

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
        theirstack_dataset: {
          configured: Boolean(datasetAccess.any_accessible),
          status: datasetState,
          mode: datasetAccess.any_accessible
            ? `${datasetAccess.accessible_workspaces}/${datasetAccess.checked} configured TheirStack workspace(s) have Jobs Dataset access.`
            : `${datasetAccess.checked}/5 workspace(s) checked · Jobs Dataset entitlement is separate from normal API-key access.`,
          detail: datasetAccess.note,
        },
        theirstack_export: {
          configured: Boolean(theirStackExportSecret?.secret),
          mode: theirStackExportSecret
            ? `${theirStackExportSecret.source === 'environment' ? 'Configured' : 'Auto-provisioned'} receiver token · one-click TheirStack Job Search handoff + company-credit Job Export receiver.`
            : 'Export receiver token could not be provisioned.',
        },
        keenable: { configured: hasRuntimeEnv([...RUNTIME_ENV.keenable]), mode: 'Supplemental employer-specific web discovery.' },
        algolia: {
          configured: Boolean(algoliaAppId && algoliaApiKey),
          mode: algoliaAppId ? 'Global job index · live database fallback enabled.' : 'API key detected only when present; Algolia still requires an application ID.',
        },
        clarifai: { configured: hasRuntimeEnv([...RUNTIME_ENV.clarifai]), mode: 'Primary occupational-health enrichment.' },
        groq: { configured: hasRuntimeEnv([...RUNTIME_ENV.groq]), mode: 'Occupational-health fallback model · primary/secondary key aliases supported.' },
        langsearch: { configured: hasRuntimeEnv([...RUNTIME_ENV.langSearch]) || hasRuntimeEnv([...RUNTIME_ENV.langSearch2]), mode: 'Verified web discovery and corroboration · hyphenated and underscored key names supported.' },
        nlx: { configured: hasRuntimeEnv([...RUNTIME_ENV.nlx]), mode: 'National Labor Exchange verification.' },
        careeronestop: { configured: hasRuntimeEnv([...RUNTIME_ENV.careerOneStopToken]) && hasRuntimeEnv([...RUNTIME_ENV.careerOneStopUser]), mode: 'CareerOneStop verification.' },
      },
      coverage: {
        active_jobs: jobs.length,
        mapped_jobs: mapped.length,
        geocoded_jobs: geocoded.length,
        unmapped_jobs: jobs.length - mapped.length,
      },
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
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
