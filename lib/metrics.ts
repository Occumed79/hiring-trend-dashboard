import { query } from '@/db/client';
import { getVerifiedActiveJobs, hasRealMappedLocation, isNewThisWeek } from '@/lib/verifiedJobs';

const QUALITY_BASELINE_DATE = '2026-08-07';
const US_STATE_CODES = new Set('AL AK AZ AR CA CO CT DC DE FL GA HI IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY'.split(' '));

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

export async function getEntityCountryBreakdown(entityId: string) {
  const jobs = await getVerifiedActiveJobs(entityId);
  const result: Record<string, number> = {};
  for (const job of jobs) {
    const country = normalizedJobCountry(job);
    if (!country) continue;
    result[country] = (result[country] || 0) + 1;
  }
  return result;
}

// Compatibility export for any code still importing the former location function.
export const getEntityLocationBreakdown = getEntityCountryBreakdown;

export async function getEntityMapData(entityId: string) {
  const jobs = (await getVerifiedActiveJobs(entityId)).filter(hasRealMappedLocation);
  return jobs.map((job: any) => ({
    job_id: String(job.id),
    title: job.title,
    city: job.city,
    state: job.state,
    country: normalizedJobCountry(job) || job.country,
    lat: Number(job.lat),
    lng: Number(job.lng),
  }));
}

function normalizedJobCountry(job: any) {
  const state = String(job?.state || '').trim().toUpperCase();
  if (US_STATE_CODES.has(state)) return 'US';
  const country = normalizeCountry(job?.country);
  if (country) return country;
  const location = String(job?.location || '').trim();
  if (/\b(?:united states|u\.s\.|usa)\b/i.test(location)) return 'US';
  if (/\baustralia\b/i.test(location)) return 'AU';
  if (/\bcanada\b/i.test(location)) return 'CA';
  if (/\bgermany\b/i.test(location)) return 'DE';
  if (/\bkuwait\b/i.test(location)) return 'KW';
  if (/\bqatar\b/i.test(location)) return 'QA';
  if (/\bpoland\b/i.test(location)) return 'PL';
  if (/\bjapan\b/i.test(location)) return 'JP';
  if (/\b(?:united kingdom|great britain)\b/i.test(location)) return 'GB';
  return null;
}

function normalizeCountry(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  const map: Record<string,string> = {
    us:'US', usa:'US', 'united states':'US', 'united states of america':'US',
    au:'AU', australia:'AU', ca:'CA', canada:'CA', gb:'GB', uk:'GB', 'united kingdom':'GB',
    de:'DE', germany:'DE', kw:'KW', kuwait:'KW', qa:'QA', qatar:'QA', pl:'PL', poland:'PL',
    jp:'JP', japan:'JP', kr:'KR', 'south korea':'KR', ae:'AE', uae:'AE', 'united arab emirates':'AE',
    sa:'SA', 'saudi arabia':'SA', mx:'MX', mexico:'MX', fr:'FR', france:'FR', es:'ES', spain:'ES',
    it:'IT', italy:'IT', be:'BE', belgium:'BE', nl:'NL', netherlands:'NL', ke:'KE', kenya:'KE',
    ug:'UG', uganda:'UG', mu:'MU', mauritius:'MU', sc:'SC', seychelles:'SC', io:'IO', 'british indian ocean territory':'IO',
  };
  if (map[lower]) return map[lower];
  return /^[A-Za-z]{2}$/.test(text) ? text.toUpperCase() : null;
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
