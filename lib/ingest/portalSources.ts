/**
 * Portal-specific hiring source ingestion.
 *
 * Each portal can have its own optional API sources.
 * If the required env key is missing, that source is gracefully skipped
 * and reported in the `skipped` array — the ingest never throws.
 */

import { fetchJson, getIngestTimeout } from './http';

interface IngestResult {
  jobs: any[];
  used: string[];
  skipped: string[];
}

export async function fetchPortalSpecificJobs(entity: any): Promise<IngestResult> {
  switch (entity.portal) {
    case 'private_companies':
      return fetchPrivateSectorJobs(entity);
    case 'federal_agencies':
      return fetchFederalJobs(entity);
    case 'state_agencies':
      return fetchStateJobs(entity);
    case 'counties_and_cities':
      return fetchCountyCityJobs(entity);
    default:
      return { jobs: [], used: [], skipped: [] };
  }
}

async function fetchPrivateSectorJobs(entity: any): Promise<IngestResult> {
  const apiKey = process.env.PRIVATE_SECTOR_HIRING_API_KEY;
  const baseUrl = normalizeBaseUrl(process.env.PRIVATE_SECTOR_HIRING_API_BASE_URL);

  if (!apiKey || !baseUrl) {
    return { jobs: [], used: [], skipped: ['private_sector_api (key/url missing)'] };
  }

  try {
    const data = await fetchJson(`${baseUrl}/jobs?company=${encodeURIComponent(entity.name)}&limit=200`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    }, getIngestTimeout(10000));
    const jobs = normalizeGenericJobs(data, 'private_sector_api');
    return { jobs, used: jobs.length ? ['private_sector_api'] : [], skipped: jobs.length ? [] : ['private_sector_api (0 jobs returned)'] };
  } catch (e) {
    console.warn(`[private_sector_api] fetch failed for "${entity.name}":`, e);
    return { jobs: [], used: [], skipped: [`private_sector_api (error)`] };
  }
}

async function fetchFederalJobs(entity: any): Promise<IngestResult> {
  const apiKey = process.env.FEDERAL_HIRING_API_KEY;
  const baseUrl = normalizeBaseUrl(process.env.FEDERAL_HIRING_API_BASE_URL);
  const used: string[] = [];
  const skipped: string[] = [];
  const jobs: any[] = [];

  if (apiKey && baseUrl) {
    try {
      const data = await fetchJson(`${baseUrl}/jobs?agency=${encodeURIComponent(entity.name)}&limit=200`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      }, getIngestTimeout(10000));
      const fetched = normalizeGenericJobs(data, 'federal_hiring_api');
      jobs.push(...fetched);
      if (fetched.length) used.push('federal_hiring_api');
      else skipped.push('federal_hiring_api (0 jobs returned)');
    } catch (e) {
      console.warn(`[federal_hiring_api] failed for "${entity.name}":`, e);
      skipped.push(`federal_hiring_api (error)`);
    }
  } else {
    skipped.push('federal_hiring_api (key/url missing)');
  }

  return { jobs, used, skipped };
}

async function fetchStateJobs(entity: any): Promise<IngestResult> {
  const apiKey = process.env.STATE_HIRING_API_KEY;
  const baseUrl = normalizeBaseUrl(process.env.STATE_HIRING_API_BASE_URL);

  if (!apiKey || !baseUrl) {
    return { jobs: [], used: [], skipped: ['state_hiring_api (key/url missing)'] };
  }

  try {
    const data = await fetchJson(`${baseUrl}/jobs?agency=${encodeURIComponent(entity.name)}&limit=200`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    }, getIngestTimeout(10000));
    const jobs = normalizeGenericJobs(data, 'state_hiring_api');
    return { jobs, used: jobs.length ? ['state_hiring_api'] : [], skipped: jobs.length ? [] : ['state_hiring_api (0 jobs returned)'] };
  } catch (e) {
    console.warn(`[state_hiring_api] failed for "${entity.name}":`, e);
    return { jobs: [], used: [], skipped: [`state_hiring_api (error)`] };
  }
}

async function fetchCountyCityJobs(entity: any): Promise<IngestResult> {
  const jobs: any[] = [];
  const used: string[] = [];
  const skipped: string[] = [];

  const sources = [
    {
      id: 'county_hiring_api',
      key: process.env.COUNTY_HIRING_API_KEY,
      url: normalizeBaseUrl(process.env.COUNTY_HIRING_API_BASE_URL),
    },
    {
      id: 'city_hiring_api',
      key: process.env.CITY_HIRING_API_KEY,
      url: normalizeBaseUrl(process.env.CITY_HIRING_API_BASE_URL),
    },
    {
      id: 'municipal_hiring_api',
      key: process.env.MUNICIPAL_HIRING_API_KEY,
      url: normalizeBaseUrl(process.env.MUNICIPAL_HIRING_API_BASE_URL),
    },
  ];

  for (const src of sources) {
    if (!src.key || !src.url) {
      skipped.push(`${src.id} (key/url missing)`);
      continue;
    }
    try {
      const data = await fetchJson(`${src.url}/jobs?entity=${encodeURIComponent(entity.name)}&limit=200`, {
        headers: { Authorization: `Bearer ${src.key}` },
      }, getIngestTimeout(10000));
      const fetched = normalizeGenericJobs(data, src.id);
      jobs.push(...fetched);
      if (fetched.length) used.push(src.id);
      else skipped.push(`${src.id} (0 jobs returned)`);
    } catch (e) {
      console.warn(`[${src.id}] failed for "${entity.name}":`, e);
      skipped.push(`${src.id} (error)`);
    }
  }

  return { jobs, used, skipped };
}

function normalizeGenericJobs(data: any, source: string): any[] {
  const items: any[] = Array.isArray(data)
    ? data
    : data?.jobs || data?.results || data?.items || data?.data || [];

  if (!Array.isArray(items)) return [];

  return items
    .map((item: any, idx: number) => {
      if (!item || typeof item !== 'object') return null;
      const title = pickString(item, ['title', 'job_title', 'position_title', 'name']);
      if (!title) return null;
      const country = pickString(item, ['country', 'location.country']) || 'US';
      return {
        external_id: pickString(item, ['id', 'job_id', 'posting_id', 'external_id']) || `${source}-${idx}`,
        source,
        title,
        department: pickString(item, ['department', 'agency', 'organization']) || null,
        location: pickString(item, ['location', 'location_name', 'city']) || null,
        city: pickString(item, ['city', 'location.city']) || null,
        state: pickString(item, ['state', 'location.state']) || null,
        country: String(country).toUpperCase(),
        lat: toNumber(pick(item, ['lat', 'latitude', 'location.lat', 'location.latitude'])),
        lng: toNumber(pick(item, ['lng', 'longitude', 'location.lng', 'location.longitude'])),
        is_remote: parseBoolean(pick(item, ['remote', 'is_remote'])) || /remote/i.test(title),
        is_overseas: String(country).toUpperCase() !== 'US',
        posted_at: normalizeDate(pick(item, ['posted_at', 'date_posted', 'created_at', 'publication_date'])) || null,
        raw_data: item,
      };
    })
    .filter(Boolean);
}

function normalizeBaseUrl(value?: string | null) {
  if (!value) return null;
  return String(value).trim().replace(/\/+$/, '');
}

function pick(row: any, keys: string[]) {
  for (const key of keys) {
    const value = key.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), row);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function pickString(row: any, keys: string[]) {
  const value = pick(row, keys);
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function toNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return false;
}

function normalizeDate(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
