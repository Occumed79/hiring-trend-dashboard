import { query } from '@/db/client';
import { fetchAdzunaJobs } from './adzuna';
import { fetchPortalSpecificJobs } from './portalSources';
import { fetchJobsForEntity } from './connectorRegistry';
import { fetchGovernmentFallbackJobs } from './govFallback';
import { fetchJobApiJobs } from './jobApiAdapters';
import { upsertIngestedJob } from './upsertJob';
import { buildHiringSnapshot } from './buildSnapshot';

type JobApiMode = 'off' | 'fallback' | 'always';

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

  const primary = await fetchJobsForEntity(entity);
  items.push(...primary.jobs);
  used.push(...primary.used);
  skipped.push(...primary.skipped);

  if (primary.detected) await saveDetectedMetadata(entity, primary.detected);

  const portal = await fetchPortalSpecificJobs(entity);
  items.push(...portal.jobs);
  used.push(...portal.used);
  skipped.push(...portal.skipped);

  if (['current_clients', 'prospects', 'private_companies', 'state_agencies', 'counties_and_cities'].includes(entity.portal)) {
    const { jobs } = await fetchAdzunaJobs(entity.name);
    items.push(...jobs);
    if (jobs.length) used.push('adzuna');
    else skipped.push('adzuna (0 jobs returned or key missing)');
  }

  const gov = await fetchGovernmentFallbackJobs(entity);
  items.push(...gov.jobs);
  used.push(...gov.used);
  skipped.push(...gov.skipped);

  const mode = getJobApiMode();
  const minExisting = getFallbackThreshold();
  if (shouldRunJobApi(mode, items.length, minExisting)) {
    const jobApi = await fetchJobApiJobs(entity);
    items.push(...jobApi.jobs);
    used.push(...jobApi.used);
    skipped.push(...jobApi.skipped);
  } else {
    skipped.push(`jobs api skipped (${mode}; ${items.length} existing jobs)`);
  }

  let newCount = 0;
  for (const item of items) {
    if (await upsertIngestedJob(entity, item)) newCount++;
  }

  const sourcesUsed = Array.from(new Set(used));
  const sourcesSkipped = Array.from(new Set(skipped));
  const status = items.length ? 'success' : 'partial';

  await query(
    `INSERT INTO ingest_log (entity_id, source, status, jobs_found, jobs_new)
     VALUES ($1, $2, $3, $4, $5)`,
    [entity.id, sourcesUsed.join(',') || 'none', status, items.length, newCount]
  );

  return {
    entity: entity.name,
    portal: entity.portal,
    total: items.length,
    new: newCount,
    sources_used: sourcesUsed,
    sources_skipped: sourcesSkipped,
    status,
    detected: primary.detected,
  };
}

function getJobApiMode(): JobApiMode {
  const mode = (process.env.JOB_API_MODE || 'fallback').toLowerCase();
  if (mode === 'off' || mode === 'always' || mode === 'fallback') return mode;
  return 'fallback';
}

function getFallbackThreshold() {
  const parsed = Number(process.env.JOB_API_FALLBACK_MIN_EXISTING || 1);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}

function shouldRunJobApi(mode: JobApiMode, existingJobCount: number, minExistingJobs: number) {
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  return existingJobCount < minExistingJobs;
}

async function logEntityIngestError(entity: any, message: string) {
  await query(
    `INSERT INTO ingest_log (entity_id, source, status, jobs_found, jobs_new, error_message)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [entity.id, 'universal_ingest', 'error', 0, 0, message.slice(0, 2000)]
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
