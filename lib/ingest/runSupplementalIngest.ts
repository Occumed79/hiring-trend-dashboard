import { query } from '@/db/client';
import { fetchTheirStackJobs } from './theirStack';
import { fetchKeenableJobs } from './keenable';
import { dedupeJobsAcrossSources, filterAllJobsForEntityEvidence } from './jobIdentity';
import { assessJobQuality } from './jobQuality';
import { upsertIngestedJob } from './upsertJob';
import { buildHiringSnapshot } from './buildSnapshot';
import { persistSourceCoverage } from './sourceCoverage';
import type { CoverageCheck } from './neogovFeed';

const THEIRSTACK_SOURCE = 'jobapi:theirstack';
const KEENABLE_SOURCE = 'web:keenable';

export async function runSupplementalIngest(entityId?: string | null) {
  const entities = entityId
    ? await query(`SELECT * FROM entities WHERE id = $1 AND is_active = true`, [entityId])
    : await query(`SELECT * FROM entities WHERE is_active = true ORDER BY name`);

  const results = [];
  for (const entity of entities) {
    try {
      results.push(await ingestSupplementalEntity(entity));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Supplemental ingest failed for ${entity.name}: ${message}`);
      results.push({
        entity: entity.name,
        entity_id: entity.id,
        total: 0,
        new: 0,
        closed: 0,
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

async function ingestSupplementalEntity(entity: any) {
  const [theirStack, keenable] = await Promise.all([
    fetchTheirStackJobs(entity),
    fetchKeenableJobs(entity),
  ]);

  const discovered = [...theirStack.jobs, ...keenable.jobs];
  const employerFiltered = filterAllJobsForEntityEvidence(discovered, entity);
  const qualityAccepted = employerFiltered.jobs.filter((job: any) => assessJobQuality(job).ok);
  const qualityRejected = employerFiltered.jobs.length - qualityAccepted.length;
  const deduped = dedupeJobsAcrossSources(qualityAccepted);

  let newCount = 0;
  for (const item of deduped.jobs) {
    if (await upsertIngestedJob(entity, item)) newCount++;
  }

  const theirStackComplete = isCompleteTheirStackRun(theirStack);
  const inventoryClosures = theirStackComplete
    ? await reconcileTheirStackInventory(entity.id, deduped.jobs.filter((job: any) => job.source === THEIRSTACK_SOURCE))
    : 0;

  // Canonical ATS/official rows win duplicate URLs. Between the supplemental
  // providers, TheirStack wins over Keenable.
  const duplicateClosures = await retireSupplementalUrlDuplicates(entity.id);
  const closedCount = inventoryClosures + duplicateClosures;

  await buildHiringSnapshot(entity.id);
  await persistSupplementalCoverage(entity.id, theirStack, keenable);

  const sourcesUsed = Array.from(new Set([...theirStack.used, ...keenable.used]));
  const sourcesSkipped = Array.from(new Set([...theirStack.skipped, ...keenable.skipped]));
  const status = sourcesUsed.length || sourcesSkipped.length ? 'success' : 'partial';

  return {
    entity: entity.name,
    entity_id: entity.id,
    total: deduped.jobs.length,
    new: newCount,
    closed: closedCount,
    duplicate_rows_closed: duplicateClosures,
    duplicates_removed: qualityAccepted.length - deduped.jobs.length,
    off_target_rejected: employerFiltered.rejected,
    quality_rejected: qualityRejected,
    theirstack_complete: theirStackComplete,
    sources_used: sourcesUsed,
    sources_skipped: sourcesSkipped,
    status,
  };
}

async function persistSupplementalCoverage(entityId: string, theirStack: any, keenable: any) {
  const checks: CoverageCheck[] = [];
  const theirStackConfiguredForEntity = theirStack.used.length > 0 || theirStack.skipped.length > 0;
  if (theirStackConfiguredForEntity) {
    checks.push({
      source: THEIRSTACK_SOURCE,
      source_class: 'supplemental',
      status: supplementalStatus(theirStack, '0 open jobs'),
      jobs_found: theirStack.jobs.length,
      authoritative_zero: false,
      details: { lineage_root: 'theirstack', skipped: theirStack.skipped },
    });
  }

  checks.push({
    source: KEENABLE_SOURCE,
    source_class: 'supplemental',
    status: supplementalStatus(keenable, '0 job-detail results'),
    jobs_found: keenable.jobs.length,
    authoritative_zero: false,
    details: { lineage_root: 'keenable', skipped: keenable.skipped },
  });

  await persistSourceCoverage(entityId, checks);
}

function supplementalStatus(result: { jobs: any[]; used: string[]; skipped: string[] }, zeroSignal: string): CoverageCheck['status'] {
  const messages = result.skipped.map(message => String(message).toLowerCase());
  if (messages.some(message => message.includes('key missing')) && !result.jobs.length) return 'skipped';
  if (result.jobs.length) {
    const hasError = messages.some(message => !message.includes(zeroSignal.toLowerCase()));
    return hasError ? 'error' : 'success';
  }
  if (messages.length && messages.every(message => message.includes(zeroSignal.toLowerCase()))) return 'zero';
  if (messages.length) return 'error';
  return result.used.length ? 'zero' : 'skipped';
}

function isCompleteTheirStackRun(result: { used: string[]; skipped: string[] }) {
  if (!result.used.includes(THEIRSTACK_SOURCE)) return false;
  return !result.skipped.some(message => {
    const normalized = String(message).toLowerCase();
    if (!normalized.startsWith('theirstack:')) return false;
    return !normalized.includes('0 open jobs');
  });
}

async function reconcileTheirStackInventory(entityId: string, jobs: any[]) {
  const ids = Array.from(new Set(jobs.map(job => String(job.external_id || '').trim()).filter(Boolean)));
  if (!ids.length) {
    const closed = await query(
      `WITH closed AS (
         UPDATE jobs SET is_active = false, closed_at = COALESCE(closed_at, NOW()), updated_at = NOW()
         WHERE entity_id = $1 AND source = $2 AND is_active = true
         RETURNING id
       ) SELECT COUNT(*) AS cnt FROM closed`,
      [entityId, THEIRSTACK_SOURCE],
    );
    return Number(closed[0]?.cnt || 0);
  }

  const closed = await query(
    `WITH closed AS (
       UPDATE jobs SET is_active = false, closed_at = COALESCE(closed_at, NOW()), updated_at = NOW()
       WHERE entity_id = $1 AND source = $2 AND is_active = true AND NOT (external_id = ANY($3::text[]))
       RETURNING id
     ) SELECT COUNT(*) AS cnt FROM closed`,
    [entityId, THEIRSTACK_SOURCE, ids],
  );
  return Number(closed[0]?.cnt || 0);
}

async function retireSupplementalUrlDuplicates(entityId: string) {
  const rows = await query(
    `WITH closed AS (
       UPDATE jobs AS supplemental
       SET is_active = false, closed_at = COALESCE(supplemental.closed_at, NOW()), updated_at = NOW()
       WHERE supplemental.entity_id = $1
         AND supplemental.is_active = true
         AND supplemental.source IN ($2, $3)
         AND NULLIF(supplemental.raw_data->>'normalized_apply_url', '') IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM jobs AS preferred
           WHERE preferred.entity_id = supplemental.entity_id
             AND preferred.id <> supplemental.id
             AND preferred.is_active = true
             AND NULLIF(preferred.raw_data->>'normalized_apply_url', '') = NULLIF(supplemental.raw_data->>'normalized_apply_url', '')
             AND (
               preferred.source NOT IN ($2, $3)
               OR (supplemental.source = $3 AND preferred.source = $2)
             )
         )
       RETURNING supplemental.id
     ) SELECT COUNT(*) AS cnt FROM closed`,
    [entityId, THEIRSTACK_SOURCE, KEENABLE_SOURCE],
  );
  return Number(rows[0]?.cnt || 0);
}
