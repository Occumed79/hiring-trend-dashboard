import { query } from '@/db/client';
import { fetchAdzunaJobs } from './adzuna';
import { fetchPortalSpecificJobs } from './portalSources';
import { fetchJobsForEntity } from './connectorRegistry';
import { fetchGovernmentFallbackJobs } from './govFallback';
import { fetchLangSearchJobs } from './langSearch';
import { fetchJobApiJobs } from './jobApiAdapters';
import { dedupeJobsAcrossSources, filterJobApiJobsForEntity, filterWebSearchJobsForEntity } from './jobIdentity';
import { upsertIngestedJob } from './upsertJob';
import { buildHiringSnapshot } from './buildSnapshot';

type SourceMode = 'off' | 'fallback' | 'always';
type IngestOptions = { reconcile?: boolean };

export async function runUniversalIngest(entityId?: string | null, options: IngestOptions = {}) {
  const entities = entityId
    ? await query(`SELECT * FROM entities WHERE id = $1 AND is_active = true`, [entityId])
    : await query(`SELECT * FROM entities WHERE is_active = true ORDER BY name`);

  const results = [];
  for (const entity of entities) {
    try {
      const result = await ingestOneEntity(entity, options);
      await buildHiringSnapshot(entity.id);
      results.push(result);
    } catch (error) {
      const message = errorMessage(error);
      await logEntityIngestError(entity, message);
      results.push({ entity: entity.name, portal: entity.portal, total: 0, new: 0, closed: 0, duplicates_removed: 0,
        off_target_rejected: 0, sources_used: [], sources_skipped: [], status: 'error', error: message });
    }
  }

  return {
    ingested: results.filter((result: any) => result.status !== 'error').length,
    failed: results.filter((result: any) => result.status === 'error').length,
    results,
  };
}

async function ingestOneEntity(entity: any, options: IngestOptions) {
  const runStartedAt = new Date().toISOString();
  const items: any[] = [];
  const used: string[] = [];
  const skipped: string[] = [];
  let rawDiscovered = 0;
  let offTargetRejected = 0;

  const primary = await fetchJobsForEntity(entity).catch((error) => ({
    jobs: [], used: [], skipped: [`primary connector (${errorMessage(error)})`], detected: null,
  }));
  rawDiscovered += primary.jobs.length;
  items.push(...primary.jobs);
  used.push(...primary.used);
  skipped.push(...primary.skipped);

  if (primary.detected) await saveDetectedMetadata(entity, primary.detected);
  const resolvedEntity = mergeDetectedEntity(entity, primary.detected);

  const [portal, gov] = await Promise.all([
    fetchPortalSpecificJobs(resolvedEntity).catch((error) => ({ jobs: [], used: [], skipped: [`portal connector (${errorMessage(error)})`] })),
    fetchGovernmentFallbackJobs(resolvedEntity).catch((error) => ({ jobs: [], used: [], skipped: [`government source (${errorMessage(error)})`] })),
  ]);
  rawDiscovered += portal.jobs.length + gov.jobs.length;
  items.push(...portal.jobs, ...gov.jobs);
  used.push(...portal.used, ...gov.used);
  skipped.push(...portal.skipped, ...gov.skipped);

  let deduped = dedupeJobsAcrossSources(items);
  const authoritativeBeforeFallback = deduped.jobs.filter(job => isAuthoritativeSource(job.source)).length;

  if (authoritativeBeforeFallback > 0) {
    skipped.push(`discovery fallback skipped (${authoritativeBeforeFallback} authoritative job${authoritativeBeforeFallback === 1 ? '' : 's'} found)`);
  } else {
    const shouldUseAdzuna = ['current_clients', 'prospects', 'private_companies', 'state_agencies', 'counties_and_cities'].includes(entity.portal);
    if (shouldUseAdzuna) {
      const adzuna = await fetchAdzunaJobs(entity.name)
        .then(({ jobs }) => jobs.length ? { jobs, used: ['adzuna'], skipped: [] } : { jobs: [], used: [], skipped: ['adzuna (0 jobs returned or key missing)'] })
        .catch((error) => ({ jobs: [], used: [], skipped: [`adzuna (${errorMessage(error)})`] }));
      rawDiscovered += adzuna.jobs.length;
      items.push(...adzuna.jobs);
      used.push(...adzuna.used);
      skipped.push(...adzuna.skipped);
      deduped = dedupeJobsAcrossSources(items);
    }

    const langSearchMode = getSourceMode('LANGSEARCH_MODE', 'always');
    const langSearchMinimum = getThreshold('LANGSEARCH_FALLBACK_MIN_EXISTING', 1);
    if (shouldRunSource(langSearchMode, deduped.jobs.length, langSearchMinimum)) {
      const langSearch = await fetchLangSearchJobs(resolvedEntity);
      rawDiscovered += langSearch.jobs.length;
      const filtered = filterWebSearchJobsForEntity(langSearch.jobs, resolvedEntity);
      offTargetRejected += filtered.rejected;
      items.push(...filtered.jobs);
      if (filtered.jobs.length) used.push(...langSearch.used);
      skipped.push(...langSearch.skipped);
      if (filtered.rejected) skipped.push(`langsearch (${filtered.rejected} off-target result${filtered.rejected === 1 ? '' : 's'} rejected)`);
      if (langSearch.jobs.length && !filtered.jobs.length) skipped.push('langsearch (all job-detail results failed employer evidence)');
      deduped = dedupeJobsAcrossSources(items);
    } else {
      skipped.push(`langsearch skipped (${langSearchMode}; ${deduped.jobs.length} unique existing jobs)`);
    }

    const jobApiMode = getSourceMode('JOB_API_MODE', 'fallback');
    const jobApiMinimum = getThreshold('JOB_API_FALLBACK_MIN_EXISTING', 1);
    if (shouldRunSource(jobApiMode, deduped.jobs.length, jobApiMinimum)) {
      const jobApi = await fetchJobApiJobs(resolvedEntity);
      rawDiscovered += jobApi.jobs.length;
      const filtered = filterJobApiJobsForEntity(jobApi.jobs, resolvedEntity);
      offTargetRejected += filtered.rejected;
      items.push(...filtered.jobs);
      if (filtered.jobs.length) used.push(...jobApi.used);
      skipped.push(...jobApi.skipped);
      if (filtered.rejected) skipped.push(`jobs api (${filtered.rejected} off-target result${filtered.rejected === 1 ? '' : 's'} rejected)`);
      if (jobApi.jobs.length && !filtered.jobs.length) skipped.push('jobs api (all results failed employer evidence)');
      deduped = dedupeJobsAcrossSources(items);
    } else {
      skipped.push(`jobs api skipped (${jobApiMode}; ${deduped.jobs.length} unique existing jobs)`);
    }
  }

  const uniqueItems = deduped.jobs;
  const upsertConcurrency = clamp(getThreshold('INGEST_UPSERT_CONCURRENCY', 4), 1, 10);
  const upsertResults = await mapWithConcurrency(uniqueItems, upsertConcurrency, (item) => upsertIngestedJob(resolvedEntity, item));
  const newCount = upsertResults.filter(Boolean).length;

  const duplicateClosures = await retireExactUrlDuplicates(entity.id);
  const hasAuthoritative = uniqueItems.some(job => isAuthoritativeSource(job.source));
  const reconcileDiscovery = options.reconcile === true || booleanEnv('INGEST_RECONCILE_DISCOVERY', true);
  const supersededClosures = hasAuthoritative && reconcileDiscovery
    ? await retireSupersededDiscoveryJobs(entity.id, runStartedAt)
    : 0;
  const staleClosures = await retireStaleJobs(entity.id, uniqueItems.length > 0);
  const closedCount = duplicateClosures + supersededClosures + staleClosures;

  const sourcesUsed = Array.from(new Set(used));
  const sourcesSkipped = Array.from(new Set(skipped));
  const status = uniqueItems.length ? 'success' : 'partial';

  await query(
    `INSERT INTO ingest_log (entity_id, source, status, jobs_found, jobs_new, jobs_closed)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [entity.id, sourcesUsed.join(',') || 'none', status, uniqueItems.length, newCount, closedCount]
  );

  return {
    entity: entity.name,
    portal: entity.portal,
    total: uniqueItems.length,
    raw_discovered: rawDiscovered,
    new: newCount,
    closed: closedCount,
    duplicates_removed: items.length - uniqueItems.length + duplicateClosures,
    superseded_discovery_closed: supersededClosures,
    off_target_rejected: offTargetRejected,
    authoritative: hasAuthoritative,
    sources_used: sourcesUsed,
    sources_skipped: sourcesSkipped,
    status,
    detected: primary.detected,
  };
}

function isAuthoritativeSource(source: unknown) {
  const value = String(source || '').toLowerCase();
  if (!value) return false;
  if (value.startsWith('ats:')) return true;
  return ['greenhouse', 'lever', 'smartrecruiters', 'bamboohr', 'ashby', 'recruitee', 'workday', 'usajobs', 'career_page'].includes(value)
    || value.startsWith('portal:') || value.startsWith('gov:');
}

async function retireSupersededDiscoveryJobs(entityId: string, runStartedAt: string) {
  const rows = await query(
    `WITH closed AS (
       UPDATE jobs
       SET is_active = false,
           closed_at = COALESCE(closed_at, NOW()),
           updated_at = NOW()
       WHERE entity_id = $1
         AND is_active = true
         AND updated_at < $2::timestamptz
         AND (source = 'adzuna' OR source = 'career_page' OR source LIKE 'web:%' OR source LIKE 'jobapi:%')
       RETURNING id
     )
     SELECT COUNT(*) AS cnt FROM closed`,
    [entityId, runStartedAt],
  );
  return Number(rows[0]?.cnt || 0);
}

function getSourceMode(name: string, fallback: SourceMode): SourceMode {
  const mode = (process.env[name] || fallback).toLowerCase();
  return mode === 'off' || mode === 'always' || mode === 'fallback' ? mode : fallback;
}
function getThreshold(name: string, fallback: number) {
  const parsed = Number(process.env[name] || fallback);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}
function shouldRunSource(mode: SourceMode, existingJobCount: number, minExistingJobs: number) {
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  return existingJobCount < minExistingJobs;
}

async function retireExactUrlDuplicates(entityId: string) {
  const rows = await query(
    `WITH ranked AS (
       SELECT id, ROW_NUMBER() OVER (
         PARTITION BY NULLIF(raw_data->>'normalized_apply_url', '')
         ORDER BY updated_at DESC, created_at ASC, id
       ) AS duplicate_rank
       FROM jobs
       WHERE entity_id = $1 AND is_active = true AND NULLIF(raw_data->>'normalized_apply_url', '') IS NOT NULL
     ), closed AS (
       UPDATE jobs AS job
       SET is_active = false, closed_at = COALESCE(job.closed_at, NOW()), updated_at = NOW()
       FROM ranked
       WHERE job.id = ranked.id AND ranked.duplicate_rank > 1
       RETURNING job.id
     ) SELECT COUNT(*) AS cnt FROM closed`,
    [entityId]
  );
  return Number(rows[0]?.cnt || 0);
}

async function retireStaleJobs(entityId: string, hasFreshResults: boolean) {
  if (!hasFreshResults) return 0;
  const staleAfterDays = clamp(getThreshold('JOB_STALE_AFTER_DAYS', 30), 7, 365);
  const rows = await query(
    `WITH closed AS (
       UPDATE jobs SET is_active = false, closed_at = COALESCE(closed_at, NOW()), updated_at = NOW()
       WHERE entity_id = $1 AND is_active = true AND updated_at < NOW() - ($2::int * INTERVAL '1 day')
       RETURNING id
     ) SELECT COUNT(*) AS cnt FROM closed`,
    [entityId, staleAfterDays]
  );
  return Number(rows[0]?.cnt || 0);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  if (!items.length) return [] as R[];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
  return results;
}

function clamp(value: number, min: number, max: number) { return Math.min(Math.max(value, min), max); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function booleanEnv(name: string, fallback: boolean) {
  const value = (process.env[name] || '').trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
  return fallback;
}

function mergeDetectedEntity(entity: any, detected: any) {
  if (!detected) return entity;
  return {
    ...entity,
    aliases: Array.from(new Set([...(entity.aliases || []), ...(detected.aliases || [])])),
    career_page_url: detected.career_page_url || entity.career_page_url || null,
    ats_provider: entity.ats_provider && entity.ats_provider !== 'unknown' ? entity.ats_provider : detected.ats_provider || 'unknown',
    ats_board_id: entity.ats_board_id || detected.ats_board_id || null,
  };
}

async function logEntityIngestError(entity: any, message: string) {
  await query(
    `INSERT INTO ingest_log (entity_id, source, status, jobs_found, jobs_new, jobs_closed, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [entity.id, 'universal_ingest', 'error', 0, 0, 0, message.slice(0, 2000)]
  ).catch(() => {});
}

async function saveDetectedMetadata(entity: any, detected: any) {
  const aliases = Array.from(new Set([...(entity.aliases || []), ...(detected.aliases || [])]));
  const provider = entity.ats_provider && entity.ats_provider !== 'unknown' ? entity.ats_provider : detected.ats_provider || 'unknown';
  await query(
    `UPDATE entities SET career_page_url = COALESCE($2, career_page_url), ats_provider = $3,
       ats_board_id = COALESCE($4, ats_board_id), aliases = $5, updated_at = NOW() WHERE id = $1`,
    [entity.id, detected.career_page_url || entity.career_page_url || null, provider, entity.ats_board_id || detected.ats_board_id || null, aliases]
  );
}
