type JobApiAdapter = {
  id: string;
  label: string;
  host: string;
  path: string;
  method?: 'GET' | 'POST';
  source: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: Record<string, unknown>;
  resultsPath?: string;
};

type JobApiIngestResult = {
  jobs: any[];
  used: string[];
  skipped: string[];
};

type EntityLike = {
  name: string;
  aliases?: string[] | null;
  portal?: string | null;
  category?: string | null;
  industry?: string | null;
};

const DEFAULT_COUNTRY = readEnv('JOB_API_COUNTRY') || 'us';
const DEFAULT_LIMIT = readEnv('JOB_API_LIMIT') || '25';
const DEFAULT_LOCATION = readEnv('JOB_API_LOCATION') || '';
const REQUEST_TIMEOUT_MS = Number(readEnv('JOB_API_TIMEOUT_MS') || 12000);

const DEFAULT_ADAPTERS: JobApiAdapter[] = [
  {
    id: 'jsearch',
    label: 'JSearch jobs adapter',
    host: readEnv('JOB_API_JSEARCH_HOST') || ['jsearch', 'p', 'rapid', 'api', 'com'].join('.'),
    path: readEnv('JOB_API_JSEARCH_PATH') || '/search',
    source: 'jobapi:jsearch',
    queryParams: {
      query: '{entity} jobs',
      page: '1',
      num_pages: '1',
      country: '{country}',
      date_posted: readEnv('JOB_API_DATE_POSTED') || 'month',
    },
    resultsPath: 'data',
  },
];

const OPTIONAL_ENV_ADAPTERS: Array<{
  id: string;
  label: string;
  hostEnv: string;
  pathEnv: string;
  defaultPath: string;
  source: string;
}> = [
  { id: 'indeed', label: 'Indeed jobs adapter', hostEnv: 'JOB_API_INDEED_HOST', pathEnv: 'JOB_API_INDEED_PATH', defaultPath: '/search', source: 'jobapi:indeed' },
  { id: 'linkedin', label: 'LinkedIn jobs adapter', hostEnv: 'JOB_API_LINKEDIN_HOST', pathEnv: 'JOB_API_LINKEDIN_PATH', defaultPath: '/search', source: 'jobapi:linkedin' },
  { id: 'google_jobs', label: 'Google Jobs adapter', hostEnv: 'JOB_API_GOOGLE_JOBS_HOST', pathEnv: 'JOB_API_GOOGLE_JOBS_PATH', defaultPath: '/search', source: 'jobapi:google_jobs' },
  { id: 'ziprecruiter', label: 'ZipRecruiter jobs adapter', hostEnv: 'JOB_API_ZIPRECRUITER_HOST', pathEnv: 'JOB_API_ZIPRECRUITER_PATH', defaultPath: '/search', source: 'jobapi:ziprecruiter' },
  { id: 'glassdoor', label: 'Glassdoor jobs adapter', hostEnv: 'JOB_API_GLASSDOOR_HOST', pathEnv: 'JOB_API_GLASSDOOR_PATH', defaultPath: '/search', source: 'jobapi:glassdoor' },
  { id: 'jobbank', label: 'JobBank jobs adapter', hostEnv: 'JOB_API_JOBBANK_HOST', pathEnv: 'JOB_API_JOBBANK_PATH', defaultPath: '/search', source: 'jobapi:jobbank' },
  { id: 'jobfinder', label: 'JobFinder jobs adapter', hostEnv: 'JOB_API_JOBFINDER_HOST', pathEnv: 'JOB_API_JOBFINDER_PATH', defaultPath: '/search', source: 'jobapi:jobfinder' },
  { id: 'latest_jobs', label: 'Latest Jobs adapter', hostEnv: 'JOB_API_LATEST_JOBS_HOST', pathEnv: 'JOB_API_LATEST_JOBS_PATH', defaultPath: '/search', source: 'jobapi:latest_jobs' },
];

export async function fetchJobApiJobs(entity: EntityLike): Promise<JobApiIngestResult> {
  const token = getProviderToken();
  if (!token) return { jobs: [], used: [], skipped: ['jobs api (token missing)'] };

  const adapters = getEnabledAdapters();
  if (!adapters.length) return { jobs: [], used: [], skipped: ['jobs api (no adapters enabled)'] };

  const used: string[] = [];
  const skipped: string[] = [];
  const jobs: any[] = [];

  for (const adapter of adapters) {
    try {
      const adapterJobs = await runAdapter(adapter, entity, token);
      if (adapterJobs.length) {
        jobs.push(...adapterJobs);
        used.push(adapter.source);
      } else {
        skipped.push(`${adapter.source} (0 jobs returned)`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      skipped.push(`${adapter.source} (${message})`);
    }
  }

  return {
    jobs: dedupeJobs(jobs),
    used: Array.from(new Set(used)),
    skipped: Array.from(new Set(skipped)),
  };
}

function getProviderToken() {
  return readEnv('JOB_API_TOKEN')
    || readEnv(['RAPID', 'API_TOKEN'])
    || readEnv(['RAPID', 'API_', 'KEY'])
    || readEnv(['RAPID_API_', 'KEY']);
}

function getEnabledAdapters(): JobApiAdapter[] {
  const configured = parseConfiguredAdapters();
  const adapters = [...DEFAULT_ADAPTERS, ...getOptionalEnvAdapters(), ...configured];
  const requested = (readEnv('JOB_API_ADAPTERS') || 'jsearch')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (!requested.length) return adapters;
  const allowed = new Set(requested);
  return adapters.filter((adapter) => allowed.has(adapter.id) || allowed.has(adapter.source));
}

function getOptionalEnvAdapters(): JobApiAdapter[] {
  return OPTIONAL_ENV_ADAPTERS.flatMap((adapter) => {
    const host = readEnv(adapter.hostEnv);
    if (!host) return [];

    const envPrefix = adapter.id.toUpperCase();
    const queryParamName = readEnv(`JOB_API_${envPrefix}_QUERY_PARAM`) || 'query';
    const locationParamName = readEnv(`JOB_API_${envPrefix}_LOCATION_PARAM`) || 'location';
    const limitParamName = readEnv(`JOB_API_${envPrefix}_LIMIT_PARAM`) || 'limit';

    return [{
      id: adapter.id,
      label: adapter.label,
      host,
      path: readEnv(adapter.pathEnv) || adapter.defaultPath,
      source: adapter.source,
      queryParams: {
        [queryParamName]: '{entity} jobs',
        [locationParamName]: '{location}',
        [limitParamName]: '{limit}',
      },
    }];
  });
}

function parseConfiguredAdapters(): JobApiAdapter[] {
  const raw = readEnv('JOB_API_PROVIDER_CONFIG');
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === 'object' && item.host && item.path)
      .map((item) => ({
        id: String(item.id || item.source || item.host),
        label: String(item.label || item.id || item.host),
        host: String(item.host),
        path: String(item.path),
        method: item.method === 'POST' ? 'POST' : 'GET',
        source: String(item.source || `jobapi:${item.id || item.host}`),
        headers: item.headers && typeof item.headers === 'object' ? item.headers : undefined,
        queryParams: item.queryParams && typeof item.queryParams === 'object' ? item.queryParams : undefined,
        body: item.body && typeof item.body === 'object' ? item.body : undefined,
        resultsPath: typeof item.resultsPath === 'string' ? item.resultsPath : undefined,
      }));
  } catch (error) {
    console.warn('Invalid JOB_API_PROVIDER_CONFIG JSON:', error);
    return [];
  }
}

async function runAdapter(adapter: JobApiAdapter, entity: EntityLike, token: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const method = adapter.method || 'GET';
    const url = buildUrl(adapter, entity);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(adapter.headers || {}),
    };
    headers[['x', 'rapidapi', 'key'].join('-')] = token;
    headers[['x', 'rapidapi', 'host'].join('-')] = adapter.host;

    const init: RequestInit = { method, headers, signal: controller.signal };
    if (method === 'POST') {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      init.body = JSON.stringify(resolveTemplateObject(adapter.body || {}, entity));
    }

    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const payload = await res.json();
    const rows = extractRows(payload, adapter.resultsPath);
    return rows.map((row, index) => normalizeJob(row, adapter, entity, index)).filter(Boolean);
  } finally {
    clearTimeout(timeout);
  }
}

function buildUrl(adapter: JobApiAdapter, entity: EntityLike) {
  const path = adapter.path.startsWith('/') ? adapter.path : `/${adapter.path}`;
  const url = new URL(`https://${adapter.host}${path}`);
  const params = resolveTemplateObject(adapter.queryParams || {}, entity);

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });

  return url.toString();
}

function resolveTemplateObject(template: Record<string, unknown>, entity: EntityLike): Record<string, unknown> {
  return Object.entries(template).reduce<Record<string, unknown>>((acc, [key, value]) => {
    acc[key] = typeof value === 'string' ? resolveTemplate(value, entity) : value;
    return acc;
  }, {});
}

function resolveTemplate(template: string, entity: EntityLike) {
  const primaryAlias = Array.isArray(entity.aliases) && entity.aliases.length ? entity.aliases[0] : entity.name;
  return template
    .replaceAll('{entity}', entity.name)
    .replaceAll('{alias}', primaryAlias || entity.name)
    .replaceAll('{country}', DEFAULT_COUNTRY)
    .replaceAll('{location}', DEFAULT_LOCATION)
    .replaceAll('{limit}', DEFAULT_LIMIT)
    .replaceAll('{portal}', entity.portal || '')
    .replaceAll('{category}', entity.category || '')
    .replaceAll('{industry}', entity.industry || '');
}

function extractRows(payload: any, preferredPath?: string): any[] {
  if (preferredPath) {
    const preferred = getByPath(payload, preferredPath);
    if (Array.isArray(preferred)) return preferred;
  }

  const commonPaths = [
    'data',
    'results',
    'jobs',
    'job_results',
    'items',
    'postings',
    'response.jobs',
    'data.jobs',
    'data.results',
    'data.items',
    'data.job_results',
  ];

  for (const path of commonPaths) {
    const value = getByPath(payload, path);
    if (Array.isArray(value)) return value;
  }

  if (Array.isArray(payload)) return payload;
  return [];
}

function getByPath(value: any, path: string) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), value);
}

function normalizeJob(row: any, adapter: JobApiAdapter, entity: EntityLike, index: number) {
  const title = pick(row, ['job_title', 'title', 'name', 'position', 'jobName', 'position_title']);
  if (!title) return null;

  const city = pick(row, ['job_city', 'city', 'location_city', 'formattedWorkLocationCity']);
  const state = pick(row, ['job_state', 'state', 'region', 'province', 'location_state', 'formattedWorkLocationState']);
  const country = pick(row, ['job_country', 'country', 'location_country', 'formattedWorkLocationCountry']) || DEFAULT_COUNTRY.toUpperCase();
  const location = pick(row, ['job_location', 'location', 'formattedLocation', 'formatted_work_location']) || joinLocation(city, state, country);
  const url = pick(row, ['job_apply_link', 'job_google_link', 'apply_link', 'url', 'link', 'job_url', 'posting_url']);
  const employer = pick(row, ['employer_name', 'company_name', 'company', 'hiring_company', 'organization']);
  const externalId = pick(row, ['job_id', 'id', 'jobkey', 'jobKey', 'posting_id', 'position_id', 'slug']) || hashFallback(`${adapter.source}:${entity.name}:${title}:${location}:${url || index}`);

  return {
    external_id: externalId,
    source: adapter.source,
    title,
    department: pick(row, ['department', 'category', 'job_category']) || employer || null,
    location,
    city: city || null,
    state: state || null,
    country: String(country || 'US').toUpperCase(),
    lat: toNumber(pick(row, ['job_latitude', 'latitude', 'lat'])),
    lng: toNumber(pick(row, ['job_longitude', 'longitude', 'lng', 'lon'])),
    is_remote: Boolean(pick(row, ['job_is_remote', 'is_remote', 'remote'])) || /\bremote\b/i.test(`${title} ${location || ''}`),
    is_overseas: String(country || 'US').toUpperCase() !== 'US',
    posted_at: pick(row, ['job_posted_at_datetime_utc', 'job_posted_at_timestamp', 'posted_at', 'datePosted', 'date_posted', 'pubDate', 'created_at']) || null,
    raw_data: {
      ...row,
      normalized_employer: employer || entity.name,
      normalized_apply_url: url || null,
      job_api_adapter: adapter.id,
    },
  };
}

function pick(row: any, keys: string[]) {
  for (const key of keys) {
    const value = getByPath(row, key);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function joinLocation(city?: string | null, state?: string | null, country?: string | null) {
  return [city, state, country].filter(Boolean).join(', ') || null;
}

function toNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hashFallback(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return `generated-${Math.abs(hash)}`;
}

function dedupeJobs(jobs: any[]) {
  const seen = new Set<string>();
  return jobs.filter((job) => {
    const key = `${job.source}:${job.external_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readEnv(name: string | string[]) {
  return process.env[Array.isArray(name) ? name.join('') : name];
}
