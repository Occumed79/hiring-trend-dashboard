import { createHash } from 'crypto';

const SOURCE = 'web:tinyfish';
const BASE = String(process.env.TINYFISH_SEARCH_BASE_URL || 'https://api.search.tinyfish.ai').replace(/\/$/, '');
const TIMEOUT_MS = clampInt(process.env.TINYFISH_SEARCH_TIMEOUT_MS, 12000, 3000, 30000);
const RECENCY_MINUTES = clampInt(process.env.TINYFISH_RECENCY_MINUTES, 14400, 60, 43200); // 10 days
const ELIGIBLE_PORTALS = new Set(['current_clients', 'prospects', 'private_companies']);

export async function fetchTinyFishJobs(entity: any): Promise<{ jobs: any[]; used: string[]; skipped: string[] }> {
  const apiKey = String(process.env.TINYFISH_API_KEY || process.env['TINYFISH-API-KEY'] || '').trim();
  if (!apiKey) return { jobs: [], used: [], skipped: ['tinyfish: API key missing'] };
  if (!ELIGIBLE_PORTALS.has(String(entity?.portal || ''))) {
    return { jobs: [], used: [], skipped: [`tinyfish: portal ${String(entity?.portal || 'unknown')} is not targeted`] };
  }

  const employer = String(entity?.name || '').trim();
  if (!employer) return { jobs: [], used: [], skipped: ['tinyfish: employer name missing'] };

  const url = new URL(BASE);
  const assist = Array.isArray(entity?.discovery_queries)
    ? entity.discovery_queries.map((value: unknown) => String(value || '').trim()).filter(Boolean).slice(0, 2)
    : [];
  const baseQuery = `"${employer.replace(/["“”]/g, '')}" jobs careers hiring`;
  url.searchParams.set('query', [baseQuery, ...assist].join(' OR '));
  url.searchParams.set('recency_minutes', String(RECENCY_MINUTES));
  url.searchParams.set('location', 'US');
  url.searchParams.set('language', 'en');

  try {
    const response = await fetch(url.toString(), {
      headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json().catch(() => null);
    const rows = Array.isArray(payload?.results) ? payload.results : [];
    const jobs = rows
      .map((row: any) => normalizeResult(row, entity))
      .filter(Boolean);

    return {
      jobs: dedupe(jobs),
      used: [SOURCE],
      skipped: jobs.length ? [] : ['tinyfish: 0 employer-verified job-detail results'],
    };
  } catch (error) {
    return { jobs: [], used: [], skipped: [`tinyfish: ${message(error)}`] };
  }
}

function normalizeResult(row: any, entity: any) {
  const resultUrl = normalizeUrl(row?.url);
  const title = clean(row?.title);
  const snippet = clean(row?.snippet);
  if (!resultUrl || !title) return null;
  if (!looksLikeJobDetail(resultUrl, `${title} ${snippet || ''}`)) return null;
  const evidence = employerEvidence(entity, `${title} ${snippet || ''}`, resultUrl);
  if (!evidence) return null;

  const id = createHash('sha256').update(resultUrl).digest('hex').slice(0, 32);
  return {
    external_id: `tinyfish-${id}`,
    source: SOURCE,
    title,
    department: null,
    location: null,
    city: null,
    state: null,
    country: null,
    lat: null,
    lng: null,
    is_remote: /\b(remote|virtual|work from home)\b/i.test(`${title} ${snippet || ''}`),
    is_overseas: false,
    posted_at: null,
    raw_data: {
      tinyfish_title: title,
      tinyfish_snippet: snippet,
      tinyfish_site_name: clean(row?.site_name),
      tinyfish_position: numberOrNull(row?.position),
      tinyfish_recency_minutes: RECENCY_MINUTES,
      tinyfish_ai_query_expansions: Array.isArray(entity?.discovery_queries) ? entity.discovery_queries.slice(0, 2) : [],
      normalized_apply_url: resultUrl,
      normalized_employer: String(entity?.name || '').trim(),
      normalized_employer_source: `tinyfish:${evidence}`,
      employer_name: String(entity?.name || '').trim(),
      source_graph_lineage: 'tinyfish-search',
      source_graph_class: 'supplemental',
      inventory_complete: false,
    },
  };
}

function employerEvidence(entity: any, text: string, resultUrl: string): string | null {
  const searchable = comparable(`${text} ${resultUrl}`);
  const names = [entity?.name, ...(Array.isArray(entity?.aliases) ? entity.aliases : [])]
    .map(comparable)
    .filter(Boolean);
  for (const name of names) {
    if (name.length >= 3 && containsPhrase(searchable, name)) return `name:${name}`;
    const short = stripLegalSuffix(name);
    if (short.length >= 4 && short !== name && containsPhrase(searchable, short)) return `name:${short}`;
  }
  try {
    const resultHost = new URL(resultUrl).hostname.replace(/^www\./, '').toLowerCase();
    const careerUrl = entity?.career_page_url ? new URL(String(entity.career_page_url)) : null;
    const careerHost = careerUrl?.hostname.replace(/^www\./, '').toLowerCase();
    if (careerHost && (resultHost === careerHost || resultHost.endsWith(`.${careerHost}`) || careerHost.endsWith(`.${resultHost}`))) return 'career-domain';
  } catch {}
  return null;
}

function looksLikeJobDetail(url: string, text: string) {
  const value = `${url} ${text}`.toLowerCase();
  if (/\b(job|jobs|career|careers|position|positions|vacancy|vacancies|requisition|opening|employment)\b/.test(value) === false) return false;
  if (/\/jobs?\/[^/?#]{2,}|\/careers?\/[^/?#]{2,}|\/job-details?\/|\/position\/|\/requisition\//i.test(url)) return true;
  if (/\b(apply|requisition|req\s*#?|job id|position)\b/i.test(text)) return true;
  return false;
}

function normalizeUrl(value: unknown) {
  if (!value) return null;
  try {
    const url = new URL(String(value).trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    for (const key of Array.from(url.searchParams.keys())) {
      const normalized = key.toLowerCase();
      if (normalized.startsWith('utm_') || ['ref','source','src','trk','trackingid'].includes(normalized)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch { return null; }
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
function comparable(value: unknown) { return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function containsPhrase(haystack: string, needle: string) { return ` ${haystack} `.includes(` ${needle} `); }
function stripLegalSuffix(value: string) { return value.replace(/\b(?:incorporated|inc|corporation|corp|company|co|limited|ltd|llc|plc|holdings?|group)\b/g, ' ').replace(/\s+/g, ' ').trim(); }
function clean(value: unknown) { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text || null; }
function numberOrNull(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function clampInt(value: unknown, fallback: number, min: number, max: number) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback; }
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
