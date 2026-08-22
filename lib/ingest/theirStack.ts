import { monitorsForEntity } from './theirStackMonitors';

const SOURCE = 'jobapi:theirstack';
const ENDPOINT = 'https://api.theirstack.com/v1/jobs/search';
const PAGE_SIZE = clamp(integerEnv('THEIRSTACK_PAGE_SIZE', 100), 1, 100);
const MAX_PAGES = clamp(integerEnv('THEIRSTACK_MAX_PAGES', 20), 1, 100);
const TIMEOUT_MS = clamp(integerEnv('THEIRSTACK_TIMEOUT_MS', 15000), 1000, 60000);

type EntityLike = {
  name: string;
  aliases?: string[] | null;
};

type TheirStackResult = {
  jobs: any[];
  used: string[];
  skipped: string[];
};

export async function fetchTheirStackJobs(entity: EntityLike): Promise<TheirStackResult> {
  const monitors = monitorsForEntity(entity);
  if (!monitors.length) return { jobs: [], used: [], skipped: [] };

  const jobs: any[] = [];
  const used: string[] = [];
  const skipped: string[] = [];

  for (const monitor of monitors) {
    const apiKey = String(process.env[monitor.envKey] || '').trim();
    if (!apiKey) {
      skipped.push(`theirstack:${monitor.envKey} (key missing for ${monitor.name})`);
      continue;
    }

    try {
      const rows = await fetchEmployerJobs(apiKey, monitor.name, monitor.envKey);
      jobs.push(...rows);
      used.push(SOURCE);
      if (!rows.length) skipped.push(`theirstack:${monitor.envKey} (${monitor.name}: 0 open jobs)`);
    } catch (error) {
      skipped.push(`theirstack:${monitor.envKey} (${monitor.name}: ${errorMessage(error)})`);
    }
  }

  return {
    jobs: dedupe(jobs),
    used: Array.from(new Set(used)),
    skipped: Array.from(new Set(skipped)),
  };
}

async function fetchEmployerJobs(apiKey: string, employerName: string, envKey: string) {
  const jobs: any[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const payload = await request(apiKey, {
      // company_name_or satisfies TheirStack's required company filter while the
      // case-insensitive form protects against harmless casing differences.
      company_name_or: [employerName],
      company_name_case_insensitive_or: [employerName],
      is_closed: false,
      limit: PAGE_SIZE,
      page,
    });

    const rows = Array.isArray(payload?.data) ? payload.data : [];
    for (const row of rows) {
      const normalized = normalizeJob(row, employerName, envKey);
      if (normalized) jobs.push(normalized);
    }

    if (rows.length < PAGE_SIZE) break;
  }

  return jobs;
}

async function request(apiKey: string, body: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const description = payload?.error?.description || payload?.error?.title || `HTTP ${response.status}`;
      throw new Error(String(description));
    }
    return payload;
  } catch (error) {
    if ((error as any)?.name === 'AbortError') throw new Error(`timeout after ${TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeJob(row: any, monitoredEmployer: string, envKey: string) {
  const id = row?.id ?? row?.job_id;
  const title = clean(row?.job_title || row?.title || row?.normalized_title);
  const applyUrl = normalizeUrl(row?.final_url || row?.url || row?.source_url);
  if (id === undefined || id === null || !title || !applyUrl) return null;

  const locationObject = Array.isArray(row?.locations) && row.locations.length ? row.locations[0] : null;
  const location = clean(row?.long_location || row?.short_location || row?.location || locationObject?.display_name);
  const country = clean(row?.country_code || locationObject?.country_code || row?.company_object?.country_code);
  const state = clean(row?.state_code || locationObject?.state_code || locationObject?.state);
  const city = clean(locationObject?.name || (Array.isArray(row?.cities) ? row.cities[0] : null));
  const employer = clean(row?.company || row?.company_object?.name || monitoredEmployer) || monitoredEmployer;

  return {
    external_id: `theirstack-${String(id)}`,
    source: SOURCE,
    title,
    department: employer,
    location,
    city,
    state,
    country,
    lat: numberOrNull(row?.latitude ?? locationObject?.latitude),
    lng: numberOrNull(row?.longitude ?? locationObject?.longitude),
    is_remote: Boolean(row?.remote),
    is_overseas: country ? country.toUpperCase() !== 'US' : false,
    posted_at: normalizeDate(row?.date_reposted || row?.date_posted || row?.discovered_at),
    raw_data: {
      normalized_employer: monitoredEmployer,
      normalized_apply_url: applyUrl,
      employer_name: employer,
      company_name: employer,
      company: employer,
      company_domain: row?.company_domain || row?.company_object?.domain || null,
      theirstack_company_id: row?.company_object?.id || null,
      theirstack_job_id: id,
      theirstack_key_slot: envKey,
      final_url: row?.final_url || null,
      url: row?.url || null,
      source_url: row?.source_url || null,
      discovered_at: row?.discovered_at || null,
      closed_at: row?.closed_at || null,
      employment_statuses: row?.employment_statuses || [],
      workplace_types: row?.workplace_types || null,
      remote: row?.remote ?? null,
      hybrid: row?.hybrid ?? null,
      salary_string: row?.salary_string || null,
      min_annual_salary_usd: row?.min_annual_salary_usd ?? null,
      max_annual_salary_usd: row?.max_annual_salary_usd ?? null,
      source_graph_lineage: 'theirstack',
    },
  };
}

function dedupe(rows: any[]) {
  const seen = new Set<string>();
  return rows.filter(row => {
    const key = String(row?.raw_data?.normalized_apply_url || row?.external_id || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clean(value: unknown) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function normalizeUrl(value: unknown) {
  if (!value) return null;
  try {
    const url = new URL(String(value).trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function numberOrNull(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
