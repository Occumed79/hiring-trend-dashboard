/**
 * Portal-specific hiring source ingestion.
 *
 * Each portal can have its own optional API sources.
 * If the required env key is missing, that source is gracefully skipped
 * and reported in the `skipped` array — the ingest never throws.
 *
 * Environment variable placeholders (all optional):
 *
 *   Private Companies:
 *     PRIVATE_SECTOR_HIRING_API_KEY
 *     PRIVATE_SECTOR_HIRING_API_BASE_URL
 *
 *   Federal Agencies:
 *     FEDERAL_HIRING_API_KEY
 *     FEDERAL_HIRING_API_BASE_URL
 *     USAJOBS_API_KEY          (also used by the main ingest route)
 *     USAJOBS_USER_AGENT
 *
 *   State Agencies:
 *     STATE_HIRING_API_KEY
 *     STATE_HIRING_API_BASE_URL
 *
 *   Counties & Cities:
 *     COUNTY_HIRING_API_KEY
 *     COUNTY_HIRING_API_BASE_URL
 *     CITY_HIRING_API_KEY
 *     CITY_HIRING_API_BASE_URL
 *     MUNICIPAL_HIRING_API_KEY
 *     MUNICIPAL_HIRING_API_BASE_URL
 */

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

// ── Private Companies ─────────────────────────────────────────────────────────
async function fetchPrivateSectorJobs(entity: any): Promise<IngestResult> {
  const apiKey = process.env.PRIVATE_SECTOR_HIRING_API_KEY;
  const baseUrl = process.env.PRIVATE_SECTOR_HIRING_API_BASE_URL;

  if (!apiKey || !baseUrl) {
    return { jobs: [], used: [], skipped: ['private_sector_api (key/url missing)'] };
  }

  try {
    const res = await fetch(`${baseUrl}/jobs?company=${encodeURIComponent(entity.name)}&limit=200`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const jobs = normalizeGenericJobs(data, 'private_sector_api');
    return { jobs, used: ['private_sector_api'], skipped: [] };
  } catch (e) {
    console.warn(`[private_sector_api] fetch failed for "${entity.name}":`, e);
    return { jobs: [], used: [], skipped: [`private_sector_api (error: ${String(e)})`] };
  }
}

// ── Federal Agencies ──────────────────────────────────────────────────────────
async function fetchFederalJobs(entity: any): Promise<IngestResult> {
  const apiKey = process.env.FEDERAL_HIRING_API_KEY;
  const baseUrl = process.env.FEDERAL_HIRING_API_BASE_URL;
  const used: string[] = [];
  const skipped: string[] = [];
  const jobs: any[] = [];

  if (apiKey && baseUrl) {
    try {
      const res = await fetch(
        `${baseUrl}/jobs?agency=${encodeURIComponent(entity.name)}&limit=200`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        }
      );
      if (res.ok) {
        const data = await res.json();
        jobs.push(...normalizeGenericJobs(data, 'federal_hiring_api'));
        used.push('federal_hiring_api');
      } else {
        skipped.push(`federal_hiring_api (HTTP ${res.status})`);
      }
    } catch (e) {
      console.warn(`[federal_hiring_api] failed for "${entity.name}":`, e);
      skipped.push(`federal_hiring_api (error)`);
    }
  } else {
    skipped.push('federal_hiring_api (key/url missing)');
  }

  // USAJOBS is also handled in the main ingest route for gov portals,
  // but if a board_id is set on the entity treat it as an agency code filter.
  return { jobs, used, skipped };
}

// ── State Agencies ────────────────────────────────────────────────────────────
async function fetchStateJobs(entity: any): Promise<IngestResult> {
  const apiKey = process.env.STATE_HIRING_API_KEY;
  const baseUrl = process.env.STATE_HIRING_API_BASE_URL;

  if (!apiKey || !baseUrl) {
    return { jobs: [], used: [], skipped: ['state_hiring_api (key/url missing)'] };
  }

  try {
    const res = await fetch(
      `${baseUrl}/jobs?agency=${encodeURIComponent(entity.name)}&limit=200`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const jobs = normalizeGenericJobs(data, 'state_hiring_api');
    return { jobs, used: ['state_hiring_api'], skipped: [] };
  } catch (e) {
    console.warn(`[state_hiring_api] failed for "${entity.name}":`, e);
    return { jobs: [], used: [], skipped: [`state_hiring_api (error)`] };
  }
}

// ── Counties & Cities ─────────────────────────────────────────────────────────
async function fetchCountyCityJobs(entity: any): Promise<IngestResult> {
  const jobs: any[] = [];
  const used: string[] = [];
  const skipped: string[] = [];

  const sources = [
    {
      id: 'county_hiring_api',
      key: process.env.COUNTY_HIRING_API_KEY,
      url: process.env.COUNTY_HIRING_API_BASE_URL,
    },
    {
      id: 'city_hiring_api',
      key: process.env.CITY_HIRING_API_KEY,
      url: process.env.CITY_HIRING_API_BASE_URL,
    },
    {
      id: 'municipal_hiring_api',
      key: process.env.MUNICIPAL_HIRING_API_KEY,
      url: process.env.MUNICIPAL_HIRING_API_BASE_URL,
    },
  ];

  for (const src of sources) {
    if (!src.key || !src.url) {
      skipped.push(`${src.id} (key/url missing)`);
      continue;
    }
    try {
      const res = await fetch(
        `${src.url}/jobs?entity=${encodeURIComponent(entity.name)}&limit=200`,
        {
          headers: { Authorization: `Bearer ${src.key}` },
          signal: AbortSignal.timeout(10000),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const fetched = normalizeGenericJobs(data, src.id);
      jobs.push(...fetched);
      if (fetched.length) used.push(src.id);
    } catch (e) {
      console.warn(`[${src.id}] failed for "${entity.name}":`, e);
      skipped.push(`${src.id} (error)`);
    }
  }

  return { jobs, used, skipped };
}

// ── Generic normalizer ────────────────────────────────────────────────────────
// Handles arbitrary JSON shapes from placeholder APIs.
// Keys are tried in priority order so the normalizer is resilient to
// different response schemas without crashing.
function normalizeGenericJobs(data: any, source: string): any[] {
  const items: any[] = Array.isArray(data)
    ? data
    : data?.jobs || data?.results || data?.items || data?.data || [];

  return items
    .map((item: any, idx: number) => ({
      external_id: String(item.id || item.job_id || item.posting_id || `${source}-${idx}`),
      source,
      title: item.title || item.job_title || item.position_title || 'Untitled',
      department: item.department || item.agency || item.organization || null,
      location: item.location || item.location_name || item.city || null,
      city: item.city || item.location?.city || null,
      state: item.state || item.location?.state || null,
      country: item.country || 'US',
      lat: item.lat || item.latitude || null,
      lng: item.lng || item.longitude || null,
      is_remote: Boolean(item.remote || item.is_remote || String(item.title || '').toLowerCase().includes('remote')),
      is_overseas: false,
      posted_at: item.posted_at || item.date_posted || item.created_at || null,
      raw_data: item,
    }))
    .filter((j: any) => j.external_id && j.title);
}
