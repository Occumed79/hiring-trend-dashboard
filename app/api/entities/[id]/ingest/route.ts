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
import { detectedRuntimeEnvName, firstRuntimeEnv, RUNTIME_ENV } from '@/lib/runtimeEnv';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    await refreshStaleSourceReliabilityOnRead(params.id).catch(() => {});

    const [entities, logs, jobs, sourceCoverage, assessment, sourceGraph, sourceIncidents] = await Promise.all([
      query(`SELECT id, name, aliases, portal, created_at, updated_at, ats_provider, ats_board_id, career_page_url,
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

    const algoliaAppEnv = detectedRuntimeEnvName(RUNTIME_ENV.algoliaAppId);
    const algoliaKeyEnv = detectedRuntimeEnvName(['ALGOLIA_SEARCH_API_KEY', 'ALGOLIA_WRITE_API_KEY', 'ALGOLIA_API_KEY', 'NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY']);
    const algoliaAppId = firstRuntimeEnv(RUNTIME_ENV.algoliaAppId);
    const algoliaApiKey = firstRuntimeEnv(['ALGOLIA_SEARCH_API_KEY', 'ALGOLIA_WRITE_API_KEY', 'ALGOLIA_API_KEY', 'NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY']);
    const keenableEnv = detectedRuntimeEnvName(RUNTIME_ENV.keenable);
    const tinyFishEnv = detectedRuntimeEnvName(RUNTIME_ENV.tinyfish);
    const geoapifyEnv = detectedRuntimeEnvName(RUNTIME_ENV.geoapify);
    const mapTilerEnv = detectedRuntimeEnvName(RUNTIME_ENV.maptiler);
    const langSearch1Env = detectedRuntimeEnvName(RUNTIME_ENV.langSearch);
    const langSearch2Env = detectedRuntimeEnvName(RUNTIME_ENV.langSearch2);
    const langSearchEnv = langSearch1Env || langSearch2Env;
    const cosTokenEnv = detectedRuntimeEnvName(RUNTIME_ENV.careerOneStopToken);
    const cosUserEnv = detectedRuntimeEnvName(RUNTIME_ENV.careerOneStopUser);
    const samEnv = detectedRuntimeEnvName(RUNTIME_ENV.sam);
    const nlxEnv = detectedRuntimeEnvName(RUNTIME_ENV.nlx);

    const adzunaPairs = [
      [detectedRuntimeEnvName(RUNTIME_ENV.adzunaId1), detectedRuntimeEnvName(RUNTIME_ENV.adzunaKey1)],
      [detectedRuntimeEnvName(RUNTIME_ENV.adzunaId2), detectedRuntimeEnvName(RUNTIME_ENV.adzunaKey2)],
      [detectedRuntimeEnvName(RUNTIME_ENV.adzunaId3), detectedRuntimeEnvName(RUNTIME_ENV.adzunaKey3)],
    ];
    const configuredAdzunaPairs = adzunaPairs.filter(([id, key]) => Boolean(id && key));

    const aiProviders = [
      { label: 'Groq #1', env: detectedRuntimeEnvName(RUNTIME_ENV.groq1) },
      { label: 'Groq #2', env: detectedRuntimeEnvName(RUNTIME_ENV.groq2) },
      { label: 'Cerebras', env: detectedRuntimeEnvName(RUNTIME_ENV.cerebras) },
      { label: 'Fireworks', env: detectedRuntimeEnvName(RUNTIME_ENV.fireworks) },
      { label: 'OpenRouter', env: detectedRuntimeEnvName(RUNTIME_ENV.openRouter) },
    ];
    const configuredAiProviders = aiProviders.filter(provider => Boolean(provider.env));

    const datasetErrors = Array.isArray(datasetAccess.workspaces) ? datasetAccess.workspaces.filter((row:any) => row.status === 'error').length : 0;
    const datasetState = datasetAccess.any_accessible
      ? 'available'
      : datasetAccess.checked > 0 && datasetErrors < datasetAccess.checked
        ? 'not entitled'
        : datasetErrors > 0
          ? 'check error'
          : 'not configured';

    const jobSpyDisabled = ['0', 'false', 'no', 'off'].includes(String(process.env.JOBSPY_ENABLED || 'true').trim().toLowerCase())
      || String(process.env.JOBSPY_MODE || 'gap').trim().toLowerCase() === 'off';
    const jobSpyTargeted = ['current_clients', 'prospects', 'private_companies'].includes(String(entity.portal || ''));
    const jobSpyAvailable = !jobSpyDisabled && jobSpyTargeted;
    const jobSpyMode = String(process.env.JOBSPY_MODE || 'gap').trim().toLowerCase() || 'gap';
    const jobSpyHours = Math.max(1, Number(process.env.JOBSPY_HOURS_OLD || 240));

    const displaySourceCoverage = sourceCoverage
      .filter((row: any) => isVisibleHiringCoverage(row))
      .map((row: any) => normalizeCoverageDisplay(row));
    const displayIncidents = sourceIncidents.filter((row: any) => String(row?.source || '').toLowerCase() !== 'jobspy:linkedin');

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
      source_coverage: displaySourceCoverage,
      source_graph: sourceGraph,
      coverage_assessment: assessment,
      source_incidents: displayIncidents,
      integrations: {
        maptiler: {
          configured: Boolean(mapTilerEnv),
          status: mapTilerEnv ? 'configured' : 'not configured',
          mode: mapTilerEnv
            ? `${mapTilerEnv} visible to web runtime · MapTiler Dataviz Dark is the default hiring-map basemap.`
            : 'No MapTiler key alias is visible; maps will use the dark fallback until a MapTiler key is present.',
        },
        theirstack: {
          monitored: theirStackMonitors.length > 0,
          configured: configuredTheirStackMonitors.length > 0,
          mode: theirStackMonitors.length
            ? `${legacyTheirStack ? 'Full Job Search' : 'Credit-aware Company Search'} · ${configuredTheirStackMonitors.length}/${theirStackMonitors.length} workspace${theirStackMonitors.length === 1 ? '' : 's'} visible to web runtime · ${liveTheirStackMonitors.length ? 'live saved-list sync' : 'bootstrap monitor fallback'}`
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
        jobspy: {
          configured: jobSpyAvailable,
          status: jobSpyAvailable ? 'available' : jobSpyTargeted ? 'not configured' : 'not targeted',
          mode: jobSpyAvailable
            ? `Native Node JobSpy · Indeed only · LinkedIn removed · ${jobSpyMode === 'gap' ? 'runs only when stored inventory is materially below the TheirStack signal' : `${jobSpyMode} mode`} · ${Math.round(jobSpyHours / 24)}-day recency window · no per-job API key.`
            : jobSpyTargeted
              ? 'JobSpy is disabled by runtime configuration.'
              : 'JobSpy is intentionally limited to clients, prospects, and private companies.',
        },
        adzuna: {
          configured: configuredAdzunaPairs.length > 0,
          mode: configuredAdzunaPairs.length
            ? `${configuredAdzunaPairs.length}/3 complete credential pair(s) visible · fallback rotation uses the next pair only when an earlier pair errors.`
            : 'No complete ADZUNA_APP_ID + ADZUNA_APP_KEY credential pair is visible to the web runtime.',
        },
        keenable: { configured: Boolean(keenableEnv), mode: keenableEnv ? `${keenableEnv} visible to web runtime.` : 'No supported Keenable key name is visible to the web runtime.' },
        tinyfish: { configured: Boolean(tinyFishEnv), mode: tinyFishEnv ? `${tinyFishEnv} visible · strict official/ATS job-detail gate is active.` : 'TINYFISH_API_KEY is not visible to the web runtime.' },
        geoapify: { configured: Boolean(geoapifyEnv), mode: geoapifyEnv ? `${geoapifyEnv} visible · used by the active location geocoder.` : 'GEOAPIFY_API_KEY is not visible to the web runtime.' },
        algolia: {
          configured: Boolean(algoliaAppId && algoliaApiKey),
          status: algoliaAppId && algoliaApiKey ? 'configured' : 'not configured',
          mode: algoliaAppId && algoliaApiKey
            ? `${algoliaAppEnv} + ${algoliaKeyEnv} visible to web runtime.`
            : algoliaKeyEnv && !algoliaAppId
              ? `${algoliaKeyEnv} is visible, but no Algolia application ID is present. The application ID cannot be derived from an API key.`
              : algoliaAppId && !algoliaApiKey
                ? `${algoliaAppEnv} is visible, but no Algolia search/write key is present.`
                : 'Neither a usable Algolia application ID nor API key pair is visible to the web runtime.',
        },
        job_intelligence_ai: {
          configured: configuredAiProviders.length > 0,
          status: configuredAiProviders.length ? 'available' : 'not configured',
          mode: configuredAiProviders.length
            ? `${configuredAiProviders.length}/5 provider slot(s) visible: ${configuredAiProviders.map(provider => `${provider.label} (${provider.env})`).join(', ')}. Used for discovery expansion plus role and country/location normalization; no occupational-health scoring.`
            : 'No Groq, Cerebras, Fireworks, or OpenRouter credential is visible to the web runtime.',
        },
        langsearch: {
          configured: Boolean(langSearchEnv),
          status: langSearchEnv ? 'configured' : 'not configured',
          mode: langSearchEnv
            ? `Visible aliases: ${[langSearch1Env, langSearch2Env].filter(Boolean).join(', ')}.`
            : 'No LangSearch key is visible under the supported runtime aliases. The connector cannot run until the web process actually has a LangSearch key.',
        },
        nlx: {
          configured: Boolean(nlxEnv),
          status: nlxEnv ? 'configured' : 'not configured',
          mode: nlxEnv ? `${nlxEnv} visible · direct National Labor Exchange connector can run.` : 'NLX_API_KEY is not visible to the web runtime, so the direct NLx connector is not wired.',
        },
        careeronestop: {
          configured: Boolean(cosTokenEnv && cosUserEnv),
          status: cosTokenEnv && cosUserEnv ? 'configured' : 'not configured',
          mode: cosTokenEnv && cosUserEnv
            ? `${cosTokenEnv} + ${cosUserEnv} visible · CareerOneStop is the NLx-resilience mirror.`
            : `CareerOneStop needs both credentials (${cosTokenEnv || 'API token missing'}; ${cosUserEnv || 'user ID missing'}).`,
        },
        sam_identity: {
          configured: Boolean(samEnv),
          status: samEnv ? 'configured' : 'not configured',
          mode: samEnv ? `${samEnv} visible · SAM.gov is used for entity identity enrichment, not job inventory.` : 'SAM.gov identity enrichment is not wired because no SAM API key is visible. It is not a job source.',
        },
        usaspending_identity: {
          configured: true,
          status: 'available',
          mode: 'USAspending recipient identity is a no-key identity service. A successful identity lookup does not represent a job count.',
        },
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

function isVisibleHiringCoverage(row: any) {
  const source = String(row?.source || '').toLowerCase();
  if (source === 'jobspy:linkedin') return false;
  if (source.startsWith('identity:')) return false;
  if (source === 'registry:census_governments') return false;

  const status = String(row?.status || '').toLowerCase();
  const reason = String(row?.details?.reason || row?.details?.error || '').toLowerCase();
  if (status === 'skipped' && (source === 'nlx' || source.includes('careeronestop')) && /(?:key|credential|token).*(?:missing|not configured)|not configured/.test(reason)) return false;
  return true;
}

function normalizeCoverageDisplay(row: any) {
  const source = String(row?.source || '').toLowerCase();
  if (source.startsWith('sitemap:') && String(row?.status || '').toLowerCase() === 'zero') {
    return {
      ...row,
      details: {
        ...(row?.details || {}),
        reason: 'Checked successfully; the official sitemap contained no job-detail URLs for this employer.',
      },
    };
  }
  return row;
}
