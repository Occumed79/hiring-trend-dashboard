import { query } from '@/db/client';
import { fetchAdzunaJobs } from './adzuna';
import { fetchPortalSpecificJobs } from './portalSources';
import { fetchJobsForEntity } from './connectorRegistry';
import { fetchGovernmentFallbackJobs } from './govFallback';
import { fetchLangSearchJobs } from './langSearch';
import { fetchJobApiJobs } from './jobApiAdapters';
import { dedupeJobsAcrossSources } from './jobIdentity';
import { upsertIngestedJob } from './upsertJob';
import { buildHiringSnapshot } from './buildSnapshot';

type SourceMode = 'off' | 'fallback' | 'always';

export async function runUniversalIngest(entityId?: string | null) {
  const entities = entityId
    ? await query(`SELECT * FROM entities WHERE id = $1 AND is_active = true`, [entityId])
    : await query(`SELECT * FROM entities WHERE is_active = true`);

  const results = [];
  for (const entity of entities) {
    try {
      const result = await ingestOneEntity(entity);
      await buildHiringSnapshot(entity.id);
      results.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logEntityIngestError(entity, message);
      results.push({
        entity: entity.name,
        portal: entity.portal,
        total: 0,
        new: 0,
        closed: 0,
        duplicates_removed: 0,
        sources_used: [],
        sources_skipped: [],
        status: 'error',
        error: message,
      });
    }
  }

  return {
    ingested: results.filter((result: any) => result.status !== 'error').length,
    failed: results.filter((result: any) => result.status === 'error').length,
    results,
  };
}

async function ingestOneEntity(entity: any) {
  const items: any[] = [];
  const used: string[] = [];
  const skipped: string[] = [];

  const shouldUseAdzuna = ['current_clients', 'prospects', 'private_companies', 'state_agencies', 'counties_and_cities'].includes(entity.portal);
  const [primary, portal, adzuna, gov] = await Promise.all([
    fetchJobsForEntity(entity).catch((error) => ({
      jobs: [],
      used: [],
      skipped: [`primary connector (${errorMessage(error)})`],
      detected: null,
    })),
    fetchPortalSpecificJobs(entity).catch((error) => ({
      jobs: [],
      used: [],
      skipped: [`portal connector (${errorMessage(error)})`],
    })),
    shouldUseAdzuna
      ? fetchAdzunaJobs(entity.name)
          .then(({ jobs }) => jobs.length
            ? { jobs, used: ['adzuna'], skipped: [] }
            : { jobs: [], used: [], skipped: ['adzuna (0 jobs returned or key missing)'] })
          .catch((error) => ({ jobs: [], used: [], skipped: [`adzuna (${errorMessage(error)})`] }))
      : Promise.resolve({ jobs: [], used: [], skipped: [] }),
    fetchGovernmentFallbackJobs(entity).catch((error) => ({
      jobs: [],
      used: [],
      skipped: [`government fallback (${errorMessage(error)})`],
    })),
  ]);

  items.push(...primary.jobs, ...portal.jobs, ...adzuna.jobs, ...gov.jobs);
  used.push(...primary.used, ...portal.used, ...adzuna.used, ...gov.used);
  skipped.push(...primary.skipped, ...portal.skipped, ...adzuna.skipped, ...gov.skipped);

  if (primary.detected) await saveDetectedMetadata(entity, primary.detected);

  let deduped = dedupeJobsAcrossSources(items);

  const langSearchMode = getSourceMode('LANGSEARCH_MODE', 'always');
  const langSearchMinimum = getThreshold('LANGSEARCH_FALLBACK_MIN_EXISTING', 1);
  if (shouldRunSource(langSearchMode, deduped.jobs.length, langSearchMinimum)) {
    const langSearch = await fetchLangSearchJobs(entity);
    items.push(...langSearch.jobs);
    used.push(...langSearch.used);
    skipped.push(...langSearch.skipped);
    deduped = dedupeJobsAcrossSources(items);
  } else {
    skipped.push(`langsearch skipped (${langSearchMode}; ${deduped.jobs.length} unique existing jobs)`);
  }

  const jobApiMode = getSourceMode('JOB_API_MODE', 'fallback');
  const jobApiMinimum = getThreshold('JOB_API_FALLBACK_MIN_EXISTING', 1);
  if (shouldRunSource(jobApiMode, deduped.jobs.length, jobApiMinimum)) {
    const jobApi = await fetchJobApiJobs(entity);
    items.push(...jobApi.jobs);
    used.push(...jobApi.used);
    skipped.push(...jobApi.skipped);
    deduped = dedupeJobsAcrossSources(items);
  } else {
    skipped.push(`jobs api skipped (${jobApiMode}; ${deduped.jobs.length} unique existing jobs)`);
  }

  const uniqueItems = deduped.jobs;
  const upsertConcurrency = clamp(getThreshold('INGEST_UPSERT_CONCURRENCY', 4), 1, 10);
  const upsertResults = await mapWithConcurrency(uniqueItems, upsertConcurrency, (item) => upsertIngestedJob(entity, item));
  const newCount = upsertResults.filter(Boolean).length;

  const duplicateClosures = await retireExactUrlDuplicates(entity.id);
  const staleClosures = await retireStaleJobs(entity.id, uniqueItems.length > 0);
  const closedCount = duplicateClosures + staleClosures;

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
    raw_discovered: items.length,
    new: newCount,
    closed: closedCount,
    duplicates_removed: items.length - uniqueItems.length + duplicateClosures,
    sources_used: sourcesUsed,
    sources_skipped: sourcesSkipped,
    status,
    detected: primary.detected,
  };
}

function getSourceMode(name: string, fallback: SourceMode): SourceMode {
  const mode = (process.env[name] || fallback).toLowerCase();
  if (mode === 'off' || mode === 'always' || mode === 'fallback') return mode;
  return fallback;
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
       SELECT id,
              ROW_NUMBER() OVER (
                PARTITION BY NULLIF(raw_data->>'normalized_apply_url', '')
                ORDER BY updated_at DESC, created_at ASC, id
              ) AS duplicate_rank
       FROM jobs
       WHERE entity_id = $1
         AND is_active = true
         AND NULLIF(raw_data->>'normalized_apply_url', '') IS NOT NULL
     ), closed AS (
       UPDATE jobs AS job
       SET is_active = false,
           closed_at = COALESCE(job.closed_at, NOW()),
           updated_at = NOW()
       FROM ranked
       WHERE job.id = ranked.id
         AND ranked.duplicate_rank > 1
       RETURNING job.id
     )
     SELECT COUNT(*) AS cnt FROM closed`,
    [entityId]
  );

  return Number(rows[0]?.cnt || 0);
}

async function retireStaleJobs(entityId: string, hasFreshResults: boolean) {
  if (!hasFreshResults) return 0;

  const staleAfterDays = clamp(getThreshold('JOB_STALE_AFTER_DAYS', 30), 7, 365);
  const rows = await query(
    `WITH closed AS (
       UPDATE jobs
       SET is_active = false,
           closed_at = COALESCE(closed_at, NOW()),
           updated_at = NOW()
       WHERE entity_id = $1
         AND is_active = true
         AND updated_at < NOW() - ($2::int * INTERVAL '1 day')
       RETURNING id
     )
     SELECT COUNT(*) AS cnt FROM closed`,
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
    `UPDATE entities
     SET career_page_url = COALESCE($2, career_page_url),
         ats_provider = $3,
         ats_board_id = COALESCE($4, ats_board_id),
         aliases = $5,
         updated_at = NOW()
     WHERE id = $1`,
    [entity.id, entity.career_page_url || detected.career_page_url || null, provider, entity.ats_board_id || detected.ats_board_id || null, aliases]
  );
}
