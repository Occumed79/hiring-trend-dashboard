import { query } from '@/db/client';
import { getVerifiedActiveJobs, hasRealMappedLocation, isNewThisWeek } from '@/lib/verifiedJobs';

const QUALITY_BASELINE_DATE = '2026-08-07';

export async function getEntityMetrics(entityId: string) {
  const [jobs, history] = await Promise.all([
    getVerifiedActiveJobs(entityId),
    query(`SELECT snapshot_date, total_active, new_this_week, closed_count
           FROM hiring_snapshots
           WHERE entity_id = $1
             AND snapshot_date >= CURRENT_DATE - INTERVAL '90 days'
             AND snapshot_date >= $2::date
           ORDER BY snapshot_date ASC`, [entityId, QUALITY_BASELINE_DATE]),
  ]);

  const totalNow = jobs.length;
  const newThisWeek = jobs.filter((job) => isNewThisWeek(job)).length;
  const historyRows = history.map((row: any) => ({
    date: row.snapshot_date,
    totalActive: Number(row.total_active || 0),
    newThisWeek: Number(row.new_this_week || 0),
    closedCount: Number(row.closed_count || 0),
  }));

  if (!historyRows.length || Number(historyRows[historyRows.length - 1]?.totalActive) !== totalNow) {
    historyRows.push({ date: new Date().toISOString().slice(0, 10), totalActive: totalNow, newThisWeek, closedCount: 0 });
  }

  const trend30 = computeTrend(historyRows, totalNow, 30, true);
  const trend60 = computeTrend(historyRows, totalNow, 60, false);
  const trend90 = computeTrend(historyRows, totalNow, 90, false);

  return {
    totalActive: totalNow,
    newThisWeek,
    mappedJobs: jobs.filter(hasRealMappedLocation).length,
    trend30: trend30.value,
    trend30Label: trend30.label,
    trend30HistoryDays: trend30.historyDays,
    trend60: trend60.value,
    trend60Label: trend60.label,
    trend60HistoryDays: trend60.historyDays,
    trend90: trend90.value,
    trend90Label: trend90.label,
    trend90HistoryDays: trend90.historyDays,
    history: historyRows,
  };
}

export async function getEntityRoleBreakdown(entityId: string) {
  const jobs = await getVerifiedActiveJobs(entityId);
  const result: Record<string, number> = {};
  for (const job of jobs) {
    const stored = String(job.role_category || 'other').toLowerCase();
    const role = stored === 'remote' || stored === 'overseas' ? 'other' : stored;
    result[role] = (result[role] || 0) + 1;
  }
  return result;
}

export async function getEntityLocationBreakdown(entityId: string) {
  const jobs = await getVerifiedActiveJobs(entityId);
  const result: Record<string, number> = { domestic: 0, overseas: 0, remote: 0, unresolved: 0 };
  for (const job of jobs) {
    const stored = String(job.raw_data?.job_location_category || '').trim().toLowerCase();
    if (stored === 'remote') { result.remote++; continue; }
    if (stored === 'domestic') { result.domestic++; continue; }
    if (stored === 'overseas') { result.overseas++; continue; }

    if (Boolean(job.is_remote) || /\b(remote|virtual|work from home|wfh)\b/i.test(String(job.location || ''))) {
      result.remote++;
      continue;
    }
    const country = String(job.country || '').trim().toUpperCase();
    if (country === 'US') result.domestic++;
    else if (country) result.overseas++;
    else result.unresolved++;
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

function computeTrend(historyRows: Array<{ date: any; totalActive: number }>, totalNow: number, requestedDays: number, allowPartial: boolean) {
  const now = startOfDay(Date.now());
  const target = now - requestedDays * 86400000;
  const usable = historyRows
    .map(row => ({ ...row, time: startOfDay(new Date(row.date).getTime()) }))
    .filter(row => Number.isFinite(row.time) && row.time < now && row.totalActive > 0)
    .sort((a,b) => a.time - b.time);
  if (!usable.length) return { value: null as number | null, label: `${requestedDays}-Day`, historyDays: 0 };

  const targetBaseline = [...usable].reverse().find(row => row.time <= target);
  if (targetBaseline) {
    return {
      value: Math.round(((totalNow - targetBaseline.totalActive) / targetBaseline.totalActive) * 100),
      label: `${requestedDays}-Day`,
      historyDays: requestedDays,
    };
  }

  const oldest = usable[0];
  const availableDays = Math.max(1, Math.floor((now - oldest.time) / 86400000));
  if (!allowPartial) return { value: null as number | null, label: `${requestedDays}-Day`, historyDays: availableDays };
  return {
    value: Math.round(((totalNow - oldest.totalActive) / oldest.totalActive) * 100),
    label: `${availableDays}-Day`,
    historyDays: availableDays,
  };
}

function startOfDay(value: number) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
