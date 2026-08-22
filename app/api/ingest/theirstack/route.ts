import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/client';
import { fetchTheirStackJobs } from '@/lib/ingest/theirStack';
import { fetchKeenableJobs } from '@/lib/ingest/keenable';
import { dedupeJobsAcrossSources, filterAllJobsForEntityEvidence } from '@/lib/ingest/jobIdentity';
import { assessJobQuality } from '@/lib/ingest/jobQuality';
import { upsertIngestedJob } from '@/lib/ingest/upsertJob';
import { buildHiringSnapshot } from '@/lib/ingest/buildSnapshot';

const THEIRSTACK_SOURCE = 'jobapi:theirstack';
const KEENABLE_SOURCE = 'web:keenable';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const entityId = String(body?.entity_id || '').trim();
    if (!entityId) return NextResponse.json({ error: 'entity_id required' }, { status: 400 });

    const rows = await query(`SELECT * FROM entities WHERE id = $1 AND is_active = true LIMIT 1`, [entityId]);
    const entity = rows[0];
    if (!entity) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });

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

    // The canonical ATS/official row should win whenever the same apply URL is
    // also returned by a supplemental API. Between the two supplemental sources,
    // TheirStack wins over Keenable. This keeps snapshots from double-counting jobs.
    const duplicateClosures = await retireSupplementalUrlDuplicates(entity.id);
    const closedCount = inventoryClosures + duplicateClosures;

    await buildHiringSnapshot(entity.id);

    const sourcesUsed = Array.from(new Set([...theirStack.used, ...keenable.used]));
    const sourcesSkipped = Array.from(new Set([...theirStack.skipped, ...keenable.skipped]));
    const status = sourcesUsed.length ? 'success' : 'partial';

    await query(
      `INSERT INTO ingest_log (entity_id, source, status, jobs_found, jobs_new, jobs_closed)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entity.id, sourcesUsed.join(',') || 'supplemental:none', status, deduped.jobs.length, newCount, closedCount],
    );

    return NextResponse.json({
      entity: entity.name,
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected supplemental ingest error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
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
