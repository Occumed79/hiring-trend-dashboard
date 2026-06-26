import { fetchJson, getIngestTimeout } from './http';

const BASE = 'https://api.adzuna.com/v1/api/jobs';

export async function fetchAdzunaJobs(entityName: string, country: string = 'us', page: number = 1) {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) return { jobs: [], total: 0 };

  try {
    const safeCountry = String(country || 'us').toLowerCase();
    const safePage = Number.isFinite(Number(page)) && Number(page) > 0 ? Math.floor(Number(page)) : 1;
    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      results_per_page: '50',
      what_or: entityName,
      content_type: 'application/json',
    });
    const data = await fetchJson(`${BASE}/${safeCountry}/search/${safePage}?${params}`, {}, getIngestTimeout(10000));
    return {
      total: data.count || 0,
      jobs: (Array.isArray(data.results) ? data.results : []).map((job: any) => ({
        external_id: String(job.id || job.redirect_url || job.title),
        source: 'adzuna',
        title: job.title,
        department: null,
        location: job.location?.display_name || null,
        city: job.location?.area?.[3] || job.location?.area?.[2] || null,
        state: job.location?.area?.[1] || null,
        country: safeCountry.toUpperCase(),
        lat: toNumber(job.latitude),
        lng: toNumber(job.longitude),
        is_remote: /remote/i.test(String(job.title || '')),
        is_overseas: safeCountry !== 'us',
        posted_at: job.created || null,
        raw_data: job,
      })).filter((job: any) => job.external_id && job.title),
    };
  } catch (e) {
    console.error('Adzuna fetch error:', e);
    return { jobs: [], total: 0 };
  }
}

export async function getAdzunaCountryCounts(entityName: string) {
  const countries = ['us', 'gb', 'au', 'ca', 'de', 'fr', 'in', 'sg'];
  const results: Record<string, number> = {};
  for (const country of countries) {
    const { total } = await fetchAdzunaJobs(entityName, country, 1);
    results[country] = total;
  }
  return results;
}

function toNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
