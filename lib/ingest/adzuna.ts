import { fetchJson, getIngestTimeout } from './http';

const BASE = 'https://api.adzuna.com/v1/api/jobs';

type AdzunaCredential = { slot: number; appId: string; appKey: string };

function getAdzunaCredentials(): AdzunaCredential[] {
  const pairs = [
    { slot: 1, appId: process.env.ADZUNA_APP_ID || process.env.ADZUNA_APPID, appKey: process.env.ADZUNA_APP_KEY || process.env.ADZUNA_API_KEY },
    { slot: 2, appId: process.env.ADZUNA_APP_ID_2 || process.env.ADZUNA_APPID_2, appKey: process.env.ADZUNA_APP_KEY_2 || process.env.ADZUNA_API_KEY_2 },
    { slot: 3, appId: process.env.ADZUNA_APP_ID_3 || process.env.ADZUNA_APPID_3, appKey: process.env.ADZUNA_APP_KEY_3 || process.env.ADZUNA_API_KEY_3 },
  ];
  return pairs
    .map(pair => ({ slot: pair.slot, appId: String(pair.appId || '').trim(), appKey: String(pair.appKey || '').trim() }))
    .filter(pair => pair.appId && pair.appKey);
}

export async function fetchAdzunaJobs(entityName: string, country: string = 'us', page: number = 1) {
  const credentials = getAdzunaCredentials();
  if (!credentials.length) return { jobs: [], total: 0, credential_slot: null };

  const safeCountry = String(country || 'us').toLowerCase();
  const safePage = Number.isFinite(Number(page)) && Number(page) > 0 ? Math.floor(Number(page)) : 1;
  let lastError: unknown = null;

  // These are quota-resilience credentials, not fan-out credentials. A successful
  // response (including a legitimate zero-result response) stops the chain so one
  // employer refresh does not burn all three accounts.
  for (const credential of credentials) {
    try {
      const params = new URLSearchParams({
        app_id: credential.appId,
        app_key: credential.appKey,
        results_per_page: '50',
        what_or: entityName,
        content_type: 'application/json',
      });
      const data = await fetchJson(`${BASE}/${safeCountry}/search/${safePage}?${params}`, {}, getIngestTimeout(10000));
      return {
        total: Number(data?.count || 0),
        credential_slot: credential.slot,
        jobs: (Array.isArray(data?.results) ? data.results : []).map((job: any) => ({
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
          raw_data: { ...job, adzuna_credential_slot: credential.slot },
        })).filter((job: any) => job.external_id && job.title),
      };
    } catch (error) {
      lastError = error;
      console.warn(`Adzuna credential slot ${credential.slot} failed; trying next configured pair:`, error);
    }
  }

  console.error('Adzuna fetch failed across all configured credential pairs:', lastError);
  return { jobs: [], total: 0, credential_slot: null };
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
