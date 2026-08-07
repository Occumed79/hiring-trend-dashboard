import { query } from '@/db/client';
import { getVerifiedActiveJobs, hasRealMappedLocation, isNewThisWeek } from '@/lib/verifiedJobs';

const QUALITY_BASELINE_DATE = '2026-08-07';

export async function getEntityMetrics(entityId: string) {
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const d60 = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0];
  const d90 = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];

  const [jobs, snap30, snap60, snap90, history] = await Promise.all([
    getVerifiedActiveJobs(entityId),
    getSnapshotAtOrBefore(entityId, d30),
    getSnapshotAtOrBefore(entityId, d60),
    getSnapshotAtOrBefore(entityId, d90),
    query(`SELECT snapshot_date, total_active, new_this_week, closed_count
           FROM hiring_snapshots
           WHERE entity_id = $1
             AND snapshot_date >= CURRENT_DATE - INTERVAL '90 days'
             AND snapshot_date >= $2::date
           ORDER BY snapshot_date ASC`, [entityId, QUALITY_BASELINE_DATE]),
  ]);

  const totalNow = jobs.length;
  const newThisWeek = jobs.filter((job) => isNewThisWeek(job)).length;
  const total30 = Number(snap30[0]?.total_active || 0);
  const total60 = Number(snap60[0]?.total_active || 0);
  const total90 = Number(snap90[0]?.total_active || 0);
  const historyRows = history.map((row: any) => ({
    date: row.snapshot_date,
    totalActive: Number(row.total_active || 0),
    newThisWeek: Number(row.new_this_week || 0),
    closedCount: Number(row.closed_count || 0),
  }));

  if (!historyRows.length || Number(historyRows[historyRows.length - 1]?.totalActive) !== totalNow) {
    historyRows.push({ date: new Date().toISOString().slice(0, 10), totalActive: totalNow, newThisWeek, closedCount: 0 });
  }

  return {
    totalActive: totalNow,
    newThisWeek,
    mappedJobs: jobs.filter(hasRealMappedLocation).length,
    trend30: total30 ? Math.round(((totalNow - total30) / total30) * 100) : 0,
    trend60: total60 ? Math.round(((totalNow - total60) / total60) * 100) : 0,
    trend90: total90 ? Math.round(((totalNow - total90) / total90) * 100) : 0,
    history: historyRows,
  };
}

export async function getEntityRoleBreakdown(entityId: string) {
  const jobs = await getVerifiedActiveJobs(entityId);
  const result: Record<string, number> = {};
  for (const job of jobs) {
    const role = String(job.role_category || 'other');
    result[role] = (result[role] || 0) + 1;
  }
  return result;
}

export async function getEntityMapData(entityId: string) {
  const jobs = (await getVerifiedActiveJobs(entityId)).filter(hasRealMappedLocation);
  const grouped = new Map<string, any>();
  for (const job of jobs) {
    const key = [job.city || '', job.state || '', job.country || '', Number(job.lat).toFixed(5), Number(job.lng).toFixed(5)].join('|');
    const current = grouped.get(key) || { city: job.city, state: job.state, country: job.country, lat: Number(job.lat), lng: Number(job.lng), count: 0 };
    current.count += 1;
    grouped.set(key, current);
  }
  return Array.from(grouped.values());
}

async function getSnapshotAtOrBefore(entityId: string, targetDate: string) {
  return query(
    `SELECT total_active
     FROM hiring_snapshots
     WHERE entity_id = $1
       AND snapshot_date <= $2
       AND snapshot_date >= $3::date
     ORDER BY snapshot_date DESC
     LIMIT 1`,
    [entityId, targetDate, QUALITY_BASELINE_DATE]
  );
}
