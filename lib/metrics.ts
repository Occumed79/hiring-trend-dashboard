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

export async function getEntityOccupationalHealthSignals(entityId: string) {
  const jobs = await getVerifiedActiveJobs(entityId);
  const enriched = jobs.filter(job => job.raw_data?.clarifai_oh);
  const signals: Record<string, number> = {
    preplacement_exam: 0,
    drug_testing: 0,
    hearing_conservation: 0,
    respirator_use: 0,
    medical_surveillance: 0,
    deployment_oconus: 0,
    dot_cdl: 0,
    hazardous_exposure: 0,
    safety_sensitive: 0,
    clearance_security: 0,
    high_physical_demand: 0,
    high_opportunity: 0,
  };

  let scoreTotal = 0;
  for (const job of enriched) {
    const oh = job.raw_data.clarifai_oh || {};
    if (oh.likely_preplacement_exam) signals.preplacement_exam++;
    if (oh.likely_drug_testing) signals.drug_testing++;
    if (oh.likely_hearing_conservation) signals.hearing_conservation++;
    if (oh.likely_respirator_use) signals.respirator_use++;
    if (oh.likely_medical_surveillance) signals.medical_surveillance++;
    if (oh.deployment_oconus) signals.deployment_oconus++;
    if (oh.dot_cdl) signals.dot_cdl++;
    if (oh.hazardous_exposure) signals.hazardous_exposure++;
    if (oh.safety_sensitive) signals.safety_sensitive++;
    if (oh.clearance_security) signals.clearance_security++;
    if (String(oh.physical_demand).toLowerCase() === 'high') signals.high_physical_demand++;
    const score = Number(oh.opportunity_score || 0);
    if (score >= 70) signals.high_opportunity++;
    scoreTotal += Number.isFinite(score) ? score : 0;
  }

  return {
    enrichedJobs: enriched.length,
    totalJobs: jobs.length,
    coveragePct: jobs.length ? Math.round((enriched.length / jobs.length) * 100) : 0,
    averageOpportunityScore: enriched.length ? Math.round(scoreTotal / enriched.length) : 0,
    signals,
  };
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
