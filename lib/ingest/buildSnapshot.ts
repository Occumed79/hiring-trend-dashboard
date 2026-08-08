import { query } from '@/db/client';
import { getVerifiedActiveJobs, isNewThisWeek } from '@/lib/verifiedJobs';
import { captureEntityBenchmarkTruth } from '@/lib/benchmark/captureEntityTruth';

export async function buildHiringSnapshot(entityId: string) {
  const today = new Date().toISOString().split('T')[0];
  const jobs = await getVerifiedActiveJobs(entityId);
  const roleMap: Record<string, number> = {};
  for (const job of jobs) {
    const role = String(job.role_category || 'other');
    roleMap[role] = (roleMap[role] || 0) + 1;
  }
  const closedRows = await query(`SELECT COUNT(*) as cnt FROM jobs WHERE entity_id = $1 AND is_active = false`, [entityId]);

  await query(
    `INSERT INTO hiring_snapshots (entity_id, snapshot_date, total_active, new_this_week, closed_count,
      security_count, logistics_count, medical_count, admin_count, aviation_count,
      engineering_count, remote_count, overseas_count, other_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (entity_id, snapshot_date) DO UPDATE SET
       total_active = EXCLUDED.total_active,
       new_this_week = EXCLUDED.new_this_week,
       closed_count = EXCLUDED.closed_count,
       security_count = EXCLUDED.security_count,
       logistics_count = EXCLUDED.logistics_count,
       medical_count = EXCLUDED.medical_count,
       admin_count = EXCLUDED.admin_count,
       aviation_count = EXCLUDED.aviation_count,
       engineering_count = EXCLUDED.engineering_count,
       remote_count = EXCLUDED.remote_count,
       overseas_count = EXCLUDED.overseas_count,
       other_count = EXCLUDED.other_count`,
    [entityId, today, jobs.length, jobs.filter((job) => isNewThisWeek(job)).length, Number(closedRows[0]?.cnt || 0),
     roleMap.security || 0, roleMap.logistics || 0, roleMap.medical || 0, roleMap.admin || 0,
     roleMap.aviation || 0, roleMap.engineering || 0, roleMap.remote || 0,
     roleMap.overseas || 0, roleMap.other || 0]
  );

  // Benchmark truth is a validation sidecar, never a prerequisite for ingest.
  // Only active benchmark-cohort entities are audited, and fresh truth snapshots
  // suppress repeat reads for the configured refresh window.
  await captureEntityBenchmarkTruth(entityId).catch(error =>
    console.warn('Could not refresh benchmark truth:', error instanceof Error ? error.message : error)
  );
}
