import { query } from '@/db/client';
import { buildDiscoveryAssist, enrichEntityJobTaxonomy } from '@/lib/ai/jobIntelligenceAi';
import { syncEntityToAlgolia } from '@/lib/search/algolia';
import { fetchTheirStackJobs } from './theirStack';
import { fetchKeenableJobs } from './keenable';
import { fetchJobSpyJobs } from './jobSpy';
import { fetchTinyFishJobs } from './tinyFishSearch';
import { dedupeJobsAcrossSources, filterAllJobsForEntityEvidence } from './jobIdentity';
import { assessJobQuality } from './jobQuality';
import { upsertIngestedJob } from './upsertJob';
import { buildHiringSnapshot } from './buildSnapshot';
import { persistSourceCoverage } from './sourceCoverage';
import type { CoverageCheck } from './neogovFeed';

const THEIRSTACK_SOURCE = 'jobapi:theirstack';
const KEENABLE_SOURCE = 'web:keenable';
const TINYFISH_SOURCE = 'web:tinyfish';
const JOBSPY_SOURCES = ['jobspy:indeed', 'jobspy:linkedin'];
const SUPPLEMENTAL_URL_SOURCES = [THEIRSTACK_SOURCE, KEENABLE_SOURCE, TINYFISH_SOURCE, ...JOBSPY_SOURCES];

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
  // One low-cost AI planning call may generate conservative employer-specific
  // search phrases. They are query expansion only; all returned jobs still need
  // the normal canonical employer-evidence checks before they can be stored.
  const discoveryAssist = await buildDiscoveryAssist(entity).catch(error => ({
    queries: [],
    provider: null,
    status: 'error',
    reason: errorMessage(error),
  }));
  const discoveryEntity = { ...entity, discovery_queries: discoveryAssist.queries };

  // These sources are intentionally independent promises. A scraper, search API,
  // rate-limit, quota failure, or AI-planning failure must never block the others.
  const [theirStack, keenable, jobSpy, tinyFish] = await Promise.all([
    fetchTheirStackJobs(entity).catch(error => ({ jobs: [], used: [], skipped: [`theirstack: ${errorMessage(error)}`] })),
    fetchKeenableJobs(discoveryEntity).catch(error => ({ jobs: [], used: [], skipped: [`keenable: ${errorMessage(error)}`] })),
    fetchJobSpyJobs(discoveryEntity).catch(error => ({
      jobs: [],
      used: [],
      skipped: [`jobspy: ${errorMessage(error)}`],
      site_results: [],
      trigger: { mode: 'error', run: false, reason: errorMessage(error), active_jobs: 0, theirstack_signal: 0 },
    })),
    fetchTinyFishJobs(discoveryEntity).catch(error => ({ jobs: [], used: [], skipped: [`tinyfish: ${errorMessage(error)}`] })),
  ]);

  const discovered = [...theirStack.jobs, ...keenable.jobs, ...jobSpy.jobs, ...tinyFish.jobs];
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

  // Authoritative/official rows always beat matching supplemental URLs. JobSpy,
  // TinyFish and other discovery sources can add corroborating inventory but can
  // never prove that an employer inventory is complete or close official jobs.
  const duplicateClosures = await retireSupplementalUrlDuplicates(entity.id);
  const closedCount = inventoryClosures + duplicateClosures;

  // The AI pool is deliberately limited to the two dashboard needs the user
  // requested: functional role categories and location categories. It does not
  // perform occupational-health inference.
  const jobTaxonomy = await enrichEntityJobTaxonomy(entity.id, entity.name).catch(error => ({
    status: 'error',
    analyzed: 0,
    changed_roles: 0,
    location_categorized: 0,
    reason: errorMessage(error),
  }));

  await buildHiringSnapshot(entity.id);

  const algolia = await syncEntityToAlgolia(entity.id);
  if (algolia.status === 'error') console.warn(`Algolia sync failed for ${entity.name}: ${algolia.reason}`);

  await persistSupplementalCoverage(entity.id, theirStack, keenable, jobSpy, tinyFish);

  const sourcesUsed = Array.from(new Set([...theirStack.used, ...keenable.used, ...jobSpy.used, ...tinyFish.used]));
  const sourcesSkipped = Array.from(new Set([...theirStack.skipped, ...keenable.skipped, ...jobSpy.skipped, ...tinyFish.skipped]));
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
    jobspy: {
      trigger: jobSpy.trigger,
      sites: jobSpy.site_results,
      jobs: jobSpy.jobs.length,
    },
    tinyfish: { jobs: tinyFish.jobs.length, used: tinyFish.used, skipped: tinyFish.skipped },
    discovery_assist: discoveryAssist,
    job_taxonomy_ai: jobTaxonomy,
    algolia,
    sources_used: sourcesUsed,
    sources_skipped: sourcesSkipped,
    status,
  };
}

async function persistSupplementalCoverage(entityId: string, theirStack: any, keenable: any, jobSpy: any, tinyFish: any) {
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

  checks.push({
    source: TINYFISH_SOURCE,
    source_class: 'supplemental',
    status: supplementalStatus(tinyFish, '0 employer-verified job-detail results'),
    jobs_found: tinyFish.jobs.length,
    authoritative_zero: false,
    details: {
      lineage_root: 'tinyfish-search',
      skipped: tinyFish.skipped,
      inventory_complete: false,
      role: 'free live-web job discovery',
    },
  });

  for (const site of Array.isArray(jobSpy?.site_results) ? jobSpy.site_results : []) {
    if (!site?.attempted) continue;
    checks.push({
      source: String(site.source),
      source_class: 'supplemental',
      status: site.status === 'success' ? 'success' : site.status === 'zero' ? 'zero' : 'error',
      jobs_found: Math.max(0, Number(site.jobs_found || 0)),
      authoritative_zero: false,
      details: {
        lineage_root: String(site.source),
        board: site.site,
        native_node_jobspy: true,
        employer_rejected: Math.max(0, Number(site.employer_rejected || 0)),
        elapsed_ms: Math.max(0, Number(site.elapsed_ms || 0)),
        trigger: jobSpy.trigger || null,
        reason: site.reason || null,
        inventory_complete: false,
      },
    });
  }

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
         AND supplemental.source = ANY($2::text[])
         AND NULLIF(supplemental.raw_data->>'normalized_apply_url', '') IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM jobs AS preferred
           WHERE preferred.entity_id = supplemental.entity_id
             AND preferred.id <> supplemental.id
             AND preferred.is_active = true
             AND NULLIF(preferred.raw_data->>'normalized_apply_url', '') = NULLIF(supplemental.raw_data->>'normalized_apply_url', '')
             AND (
               NOT (preferred.source = ANY($2::text[]))
               OR source_preference(preferred.source) > source_preference(supplemental.source)
             )
         )
       RETURNING supplemental.id
     ) SELECT COUNT(*) AS cnt FROM closed`,
    [entityId, SUPPLEMENTAL_URL_SOURCES],
  ).catch(async () => {
    return query(
      `WITH closed AS (
         UPDATE jobs AS supplemental
         SET is_active = false, closed_at = COALESCE(supplemental.closed_at, NOW()), updated_at = NOW()
         WHERE supplemental.entity_id = $1
           AND supplemental.is_active = true
           AND supplemental.source = ANY($2::text[])
           AND NULLIF(supplemental.raw_data->>'normalized_apply_url', '') IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM jobs AS preferred
             WHERE preferred.entity_id = supplemental.entity_id
               AND preferred.id <> supplemental.id
               AND preferred.is_active = true
               AND NOT (preferred.source = ANY($2::text[]))
               AND NULLIF(preferred.raw_data->>'normalized_apply_url', '') = NULLIF(supplemental.raw_data->>'normalized_apply_url', '')
           )
         RETURNING supplemental.id
       ) SELECT COUNT(*) AS cnt FROM closed`,
      [entityId, SUPPLEMENTAL_URL_SOURCES],
    );
  });
  return Number(rows[0]?.cnt || 0);
}

function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
