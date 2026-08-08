import { query } from '@/db/client';
import { fetchAdzunaJobs } from './adzuna';
import { fetchPortalSpecificJobs } from './portalSources';
import { fetchJobsForEntity } from './connectorRegistry';
import { fetchGovernmentFallbackJobs } from './govFallback';
import { fetchLangSearchJobs } from './langSearch';
import { fetchJobApiJobs } from './jobApiAdapters';
import { fetchExpandedCoverageSources } from './coverageSources';
import { enrichEntityFromGovernmentRegistry } from './governmentRegistry';
import { persistSourceCoverage } from './sourceCoverage';
import type { CoverageCheck } from './neogovFeed';
import { dedupeJobsAcrossSources, filterAdzunaJobsForEntity, filterJobApiJobsForEntity, filterWebSearchJobsForEntity } from './jobIdentity';
import { assessJobQuality, isAuthoritativeJob, isLegacyWeakSource } from './jobQuality';
import { upsertIngestedJob } from './upsertJob';
import { buildHiringSnapshot } from './buildSnapshot';

type SourceMode = 'off' | 'fallback' | 'always';
type IngestOptions = { reconcile?: boolean };

export async function runUniversalIngest(entityId?: string | null, options: IngestOptions = {}) {
  const entities = entityId
    ? await query(`SELECT * FROM entities WHERE id = $1 AND is_active = true`, [entityId])
    : await query(`SELECT * FROM entities WHERE is_active = true ORDER BY name`);

  const results = [];
  for (const storedEntity of entities) {
    try {
      const entity = await enrichEntityFromGovernmentRegistry(storedEntity);
      const result = await ingestOneEntity(entity, options);
      await buildHiringSnapshot(entity.id);
      results.push(result);
    } catch (error) {
      const message = errorMessage(error);
      await logEntityIngestError(storedEntity, message);
      results.push({ entity: storedEntity.name, portal: storedEntity.portal, total: 0, new: 0, closed: 0, duplicates_removed: 0,
        off_target_rejected: 0, quality_rejected: 0, sources_used: [], sources_skipped: [], status: 'error', error: message });
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
  const coverageChecks: CoverageCheck[] = [];
  let rawDiscovered = 0;
  let offTargetRejected = 0;
  let qualityRejected = 0;

  if (entity.government_registry_id) {
    coverageChecks.push({
      source: 'registry:census_governments',
      source_class: 'authoritative',
      status: 'success',
      jobs_found: 0,
      details: {
        government_registry_id: entity.government_registry_id,
        government_type: entity.government_type || null,
        government_state: entity.government_state || null,
        government_fips: entity.government_fips || null,
        purpose: 'entity identity',
      },
    });
  }

  const primary = await fetchJobsForEntity(entity).catch((error) => ({
    jobs: [], used: [], skipped: [`primary connector (${errorMessage(error)})`], detected: null,
  }));
  rawDiscovered += primary.jobs.length;
  const primaryQuality = filterQuality(primary.jobs);
  qualityRejected += primaryQuality.rejected;
  items.push(...primaryQuality.jobs);
  used.push(...primary.used);
  skipped.push(...primary.skipped);
  coverageChecks.push(...checksForJobs(primaryQuality.jobs, primary.used, 'authoritative'));

  if (primary.detected) await saveDetectedMetadata(entity, primary.detected);
  const resolvedEntity = mergeDetectedEntity(entity, primary.detected);

  // These sources are intentionally run together. A strong ATS/official source
  // does not suppress NLx or the public-sector corroborating sources; only weak
  // generic discovery is gated once authoritative coverage exists.
  const [portal, gov, expanded] = await Promise.all([
    fetchPortalSpecificJobs(resolvedEntity).catch((error) => ({ jobs: [], used: [], skipped: [`portal connector (${errorMessage(error)})`] })),
    fetchGovernmentFallbackJobs(resolvedEntity).catch((error) => ({ jobs: [], used: [], skipped: [`government source (${errorMessage(error)})`] })),
    fetchExpandedCoverageSources(resolvedEntity).catch((error) => ({
      jobs: [], checks: [{ source: 'coverage:expanded', source_class: 'supplemental' as const, status: 'error' as const, jobs_found: 0, details: { error: errorMessage(error) } }], authoritativeClaim: false,
    })),
  ]);

  rawDiscovered += portal.jobs.length + gov.jobs.length + expanded.jobs.length;
  const baselineQuality = filterQuality([...portal.jobs, ...gov.jobs, ...expanded.jobs]);
  qualityRejected += baselineQuality.rejected;
  items.push(...baselineQuality.jobs);
  used.push(...portal.used, ...gov.used);
  used.push(...expanded.checks.filter(check => check.status === 'success').map(check => check.source));
  skipped.push(...portal.skipped, ...gov.skipped);
  skipped.push(...expanded.checks.filter(check => check.status === 'error' || check.status === 'skipped').map(check => `${check.source} (${String(check.details?.reason || check.details?.error || check.status)})`));
  coverageChecks.push(...checksForJobs(portal.jobs, portal.used, 'authoritative'));
  coverageChecks.push(...checksForJobs(gov.jobs, gov.used, 'authoritative'));
  coverageChecks.push(...expanded.checks);

  let deduped = dedupeJobsAcrossSources(items);
  const authoritativeBeforeFallback = deduped.jobs.filter(isAuthoritativeJob).length;
  const authoritativeFederalSource = resolvedEntity.portal === 'federal_agencies'
    && resolvedEntity.ats_provider === 'usajobs'
    && Boolean(resolvedEntity.ats_board_id);
  const authoritativeCoverageClaim = expanded.authoritativeClaim;

  if (authoritativeBeforeFallback > 0 || authoritativeFederalSource || authoritativeCoverageClaim) {
    if (authoritativeFederalSource && authoritativeBeforeFallback === 0 && !authoritativeCoverageClaim) {
      skipped.push(`discovery fallback skipped (resolved USAJOBS organization ${resolvedEntity.ats_board_id}; current authoritative inventory is 0)`);
    } else if (authoritativeCoverageClaim && authoritativeBeforeFallback === 0) {
      skipped.push('discovery fallback skipped (authoritative source returned a verified zero inventory)');
    } else {
      skipped.push(`discovery fallback skipped (${authoritativeBeforeFallback} verified authoritative job${authoritativeBeforeFallback === 1 ? '' : 's'} found)`);
    }
  } else {
    const shouldUseAdzuna = ['current_clients', 'prospects', 'private_companies'].includes(entity.portal);
    if (shouldUseAdzuna) {
      const adzuna = await fetchAdzunaJobs(entity.name)
        .then(({ jobs }) => jobs.length ? { jobs, used: ['adzuna'], skipped: [] } : { jobs: [], used: [], skipped: ['adzuna (0 jobs returned or key missing)'] })
        .catch((error) => ({ jobs: [], used: [], skipped: [`adzuna (${errorMessage(error)})`] }));
      rawDiscovered += adzuna.jobs.length;
      const employerFiltered = filterAdzunaJobsForEntity(adzuna.jobs, resolvedEntity);
      offTargetRejected += employerFiltered.rejected;
      const accepted = filterQuality(employerFiltered.jobs);
      qualityRejected += accepted.rejected;
      items.push(...accepted.jobs);
      if (accepted.jobs.length) used.push(...adzuna.used);
      skipped.push(...adzuna.skipped);
      coverageChecks.push(...checksForJobs(accepted.jobs, adzuna.used, 'supplemental'));
      if (employerFiltered.rejected) skipped.push(`adzuna (${employerFiltered.rejected} off-target result${employerFiltered.rejected === 1 ? '' : 's'} rejected)`);
      if (accepted.rejected) skipped.push(`adzuna (${accepted.rejected} low-quality result${accepted.rejected === 1 ? '' : 's'} rejected)`);
      deduped = dedupeJobsAcrossSources(items);
    } else if (['federal_agencies', 'state_agencies', 'counties_and_cities'].includes(entity.portal)) {
      skipped.push('adzuna skipped (government portal requires authoritative or employer-verified sources)');
    }

    const langSearchMode = getSourceMode('LANGSEARCH_MODE', 'always');
    const langSearchMinimum = getThreshold('LANGSEARCH_FALLBACK_MIN_EXISTING', 1);
    if (shouldRunSource(langSearchMode, deduped.jobs.length, langSearchMinimum)) {
      const langSearch = await fetchLangSearchJobs(resolvedEntity);
      rawDiscovered += langSearch.jobs.length;
      const employerFiltered = filterWebSearchJobsForEntity(langSearch.jobs, resolvedEntity);
      offTargetRejected += employerFiltered.rejected;
      const accepted = filterQuality(employerFiltered.jobs);
      qualityRejected += accepted.rejected;
      items.push(...accepted.jobs);
      if (accepted.jobs.length) used.push(...langSearch.used);
      skipped.push(...langSearch.skipped);
      coverageChecks.push(...checksForJobs(accepted.jobs, langSearch.used, 'supplemental'));
      if (employerFiltered.rejected) skipped.push(`langsearch (${employerFiltered.rejected} off-target result${employerFiltered.rejected === 1 ? '' : 's'} rejected)`);
      if (accepted.rejected) skipped.push(`langsearch (${accepted.rejected} low-quality/non-detail result${accepted.rejected === 1 ? '' : 's'} rejected)`);
      deduped = dedupeJobsAcrossSources(items);
    } else {
      skipped.push(`langsearch skipped (${langSearchMode}; ${deduped.jobs.length} verified existing jobs)`);
    }

    const jobApiMode = getSourceMode('JOB_API_MODE', 'fallback');
    const jobApiMinimum = getThreshold('JOB_API_FALLBACK_MIN_EXISTING', 1);
    if (shouldRunSource(jobApiMode, deduped.jobs.length, jobApiMinimum)) {
      const jobApi = await fetchJobApiJobs(resolvedEntity);
      rawDiscovered += jobApi.jobs.length;
      const employerFiltered = filterJobApiJobsForEntity(jobApi.jobs, resolvedEntity);
      offTargetRejected += employerFiltered.rejected;
      const accepted = filterQuality(employerFiltered.jobs);
      qualityRejected += accepted.rejected;
      items.push(...accepted.jobs);
      if (accepted.jobs.length) used.push(...jobApi.used);
      skipped.push(...jobApi.skipped);
      coverageChecks.push(...checksForJobs(accepted.jobs, jobApi.used, 'supplemental'));
      if (employerFiltered.rejected) skipped.push(`jobs api (${employerFiltered.rejected} off-target result${employerFiltered.rejected === 1 ? '' : 's'} rejected)`);
      if (accepted.rejected) skipped.push(`jobs api (${accepted.rejected} low-quality/non-detail result${accepted.rejected === 1 ? '' : 's'} rejected)`);
      deduped = dedupeJobsAcrossSources(items);
    } else {
      skipped.push(`jobs api skipped (${jobApiMode}; ${deduped.jobs.length} verified existing jobs)`);
    }
  }

  const uniqueItems = deduped.jobs;
  const upsertConcurrency = clamp(getThreshold('INGEST_UPSERT_CONCURRENCY', 4), 1, 10);
  const upsertResults = await mapWithConcurrency(uniqueItems, upsertConcurrency, (item) => upsertIngestedJob(resolvedEntity, item));
  const newCount = upsertResults.filter(Boolean).length;

  const duplicateClosures = await retireExactUrlDuplicates(entity.id);
  const hasAuthoritative = uniqueItems.some(isAuthoritativeJob) || authoritativeFederalSource || authoritativeCoverageClaim;
  const invalidClosures = await retireInvalidLegacyJobs(entity.id, hasAuthoritative);
  const reconcileDiscovery = options.reconcile === true || booleanEnv('INGEST_RECONCILE_DISCOVERY', true);
  const supersededClosures = hasAuthoritative && reconcileDiscovery
    ? await retireSupersededDiscoveryJobs(entity.id, runStartedAt)
    : 0;

  const completeSources = new Set<string>();
  if (authoritativeFederalSource) completeSources.add('usajobs');
  for (const check of expanded.checks) {
    if (check.source_class === 'authoritative' && (check.status === 'success' || check.authoritative_zero === true)) completeSources.add(check.source);
  }
  const authoritativeInventoryClosures = await retireMissingAuthoritativeJobs(entity.id, uniqueItems, Array.from(completeSources));
  const staleClosures = await retireStaleJobs(entity.id, uniqueItems.length > 0 || authoritativeFederalSource || authoritativeCoverageClaim);
  const closedCount = duplicateClosures + invalidClosures + supersededClosures + authoritativeInventoryClosures + staleClosures;

  await persistSourceCoverage(entity.id, coverageChecks);

  const sourcesUsed = Array.from(new Set(used));
  const sourcesSkipped = Array.from(new Set(skipped));
  const status = uniqueItems.length || authoritativeFederalSource || authoritativeCoverageClaim ? 'success' : 'partial';

  await query(
    `INSERT INTO ingest_log (entity_id, source, status, jobs_found, jobs_new, jobs_closed)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [entity.id, sourcesUsed.join(',') || (authoritativeFederalSource ? `usajobs:${resolvedEntity.ats_board_id}` : 'none'), status, uniqueItems.length, newCount, closedCount]
  );

  return {
    entity: entity.name,
    portal: entity.portal,
    total: uniqueItems.length,
    raw_discovered: rawDiscovered,
    new: newCount,
    closed: closedCount,
    invalid_legacy_closed: invalidClosures,
    authoritative_inventory_closed: authoritativeInventoryClosures,
    duplicates_removed: items.length - uniqueItems.length + duplicateClosures,
    superseded_discovery_closed: supersededClosures,
    off_target_rejected: offTargetRejected,
    quality_rejected: qualityRejected,
    authoritative: hasAuthoritative,
    sources_used: sourcesUsed,
    sources_skipped: sourcesSkipped,
    source_coverage: coverageChecks,
    status,
    detected: primary.detected,
  };
}

function filterQuality(rows: any[]) {
  const jobs: any[] = [];
  let rejected = 0;
  for (const row of rows) {
    if (assessJobQuality(row).ok) jobs.push(row);
    else rejected++;
  }
  return { jobs, rejected };
}

function checksForJobs(jobs: any[], usedSources: string[], sourceClass: CoverageCheck['source_class']): CoverageCheck[] {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    const source = String(job?.source || '').trim();
    if (source) counts.set(source, (counts.get(source) || 0) + 1);
  }
  const sources = new Set<string>([...usedSources.map(String), ...Array.from(counts.keys())]);
  return Array.from(sources).filter(Boolean).map(source => ({
    source,
    source_class: sourceClass,
    status: (counts.get(source) || 0) > 0 ? 'success' : 'zero',
    jobs_found: counts.get(source) || 0,
    authoritative_zero: false,
  }));
}

async function retireInvalidLegacyJobs(entityId: string, hasAuthoritative: boolean) {
  const rows = await query(
    `SELECT id, external_id, source, title, location, city, state, country, raw_data
     FROM jobs WHERE entity_id = $1 AND is_active = true`,
    [entityId],
  );
  const invalidIds = rows
    .filter((row: any) => !assessJobQuality(row).ok || (hasAuthoritative && isLegacyWeakSource(row.source)))
    .map((row: any) => row.id);
  if (!invalidIds.length) return 0;

  const closed = await query(
    `WITH closed AS (
       UPDATE jobs SET is_active = false, closed_at = COALESCE(closed_at, NOW()), updated_at = NOW()
       WHERE entity_id = $1 AND is_active = true AND id = ANY($2::uuid[])
       RETURNING id
     ) SELECT COUNT(*) AS cnt FROM closed`,
    [entityId, invalidIds],
  );
  return Number(closed[0]?.cnt || 0);
}

async function retireSupersededDiscoveryJobs(entityId: string, runStartedAt: string) {
  const rows = await query(
    `WITH closed AS (
       UPDATE jobs
       SET is_active = false, closed_at = COALESCE(closed_at, NOW()), updated_at = NOW()
       WHERE entity_id = $1 AND is_active = true AND updated_at < $2::timestamptz
         AND (source = 'adzuna' OR source = 'career_page' OR source LIKE 'web:%' OR source LIKE 'jobapi:%'
              OR source IN ('serper','linkedin','monster','talent','simplyhired','indeed','glassdoor','ziprecruiter'))
       RETURNING id
     ) SELECT COUNT(*) AS cnt FROM closed`,
    [entityId, runStartedAt],
  );
  return Number(rows[0]?.cnt || 0);
}

async function retireMissingAuthoritativeJobs(entityId: string, currentItems: any[], sources: string[]) {
  let total = 0;
  for (const source of sources) {
    const externalIds = Array.from(new Set(currentItems
      .filter(item => String(item?.source || '') === source)
      .map(item => String(item?.external_id || '').trim())
      .filter(Boolean)));
    const rows = externalIds.length
      ? await query(
          `WITH closed AS (
             UPDATE jobs SET is_active = false, closed_at = COALESCE(closed_at, NOW()), updated_at = NOW()
             WHERE entity_id = $1 AND source = $2 AND is_active = true
               AND (external_id IS NULL OR NOT (external_id = ANY($3::text[])))
             RETURNING id
           ) SELECT COUNT(*) AS cnt FROM closed`,
          [entityId, source, externalIds],
        )
      : await query(
          `WITH closed AS (
             UPDATE jobs SET is_active = false, closed_at = COALESCE(closed_at, NOW()), updated_at = NOW()
             WHERE entity_id = $1 AND source = $2 AND is_active = true
             RETURNING id
           ) SELECT COUNT(*) AS cnt FROM closed`,
          [entityId, source],
        );
    total += Number(rows[0]?.cnt || 0);
  }
  return total;
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
  const replace = detected.replace_existing === true;
  return {
    ...entity,
    aliases: Array.from(new Set([...(entity.aliases || []), ...(detected.aliases || [])])),
    career_page_url: replace ? (detected.career_page_url || null) : (detected.career_page_url || entity.career_page_url || null),
    ats_provider: replace ? (detected.ats_provider || 'unknown') : (entity.ats_provider && entity.ats_provider !== 'unknown' ? entity.ats_provider : detected.ats_provider || 'unknown'),
    ats_board_id: replace ? (detected.ats_board_id || null) : (entity.ats_board_id || detected.ats_board_id || null),
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
  const replace = detected.replace_existing === true;
  const provider = replace
    ? (detected.ats_provider || 'unknown')
    : (entity.ats_provider && entity.ats_provider !== 'unknown' ? entity.ats_provider : detected.ats_provider || 'unknown');
  const careerUrl = replace ? (detected.career_page_url || null) : (detected.career_page_url || entity.career_page_url || null);
  const boardId = replace ? (detected.ats_board_id || null) : (entity.ats_board_id || detected.ats_board_id || null);

  await query(
    `UPDATE entities SET career_page_url = $2, ats_provider = $3, ats_board_id = $4, aliases = $5, updated_at = NOW() WHERE id = $1`,
    [entity.id, careerUrl, provider, boardId, aliases]
  );
}
