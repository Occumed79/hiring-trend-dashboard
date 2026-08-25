import { createHash } from 'crypto';
import { isGenericNavigationTitle, looksLikeJobDetailUrl } from './jobQuality';

const SOURCE = 'web:tinyfish';
const BASE = String(process.env.TINYFISH_SEARCH_BASE_URL || 'https://api.search.tinyfish.ai').replace(/\/$/, '');
const TIMEOUT_MS = clampInt(process.env.TINYFISH_SEARCH_TIMEOUT_MS, 12000, 3000, 30000);
const RECENCY_MINUTES = clampInt(process.env.TINYFISH_RECENCY_MINUTES, 14400, 60, 43200); // 10 days
const ELIGIBLE_PORTALS = new Set(['current_clients', 'prospects', 'private_companies']);
const TRUSTED_ATS_HOST = /(?:greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|myworkdaysite\.com|workdayjobs\.com|smartrecruiters\.com|icims\.com|taleo\.net|jobvite\.com|bamboohr\.com|workable\.com|personio\.(?:com|de)|governmentjobs\.com|usajobs\.gov|applytojob\.com)$/i;

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
  const officialHost = careerHost(entity);
  const baseQuery = officialHost
    ? `site:${officialHost} "${employer.replace(/["“”]/g, '')}" job`
    : `"${employer.replace(/["“”]/g, '')}" direct job posting careers`;
  url.searchParams.set('query', [baseQuery, ...assist].join(' OR '));
  url.searchParams.set('recency_minutes', String(RECENCY_MINUTES));
  url.searchParams.set('language', 'en');

  try {
    const response = await fetch(url.toString(), {
      headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json().catch(() => null);
    const rows = Array.isArray(payload?.results) ? payload.results : [];
    const jobs = dedupe(rows.map((row: any) => normalizeResult(row, entity)).filter(Boolean));

    return {
      jobs,
      used: [SOURCE],
      skipped: jobs.length ? [] : ['tinyfish: 0 trusted employer/ATS job-detail results'],
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
  if (isGenericTinyFishTitle(title) || isGenericNavigationTitle(title)) return null;
  if (!looksLikeJobDetailUrl(resultUrl)) return null;
  if (!trustedEmployerOrAtsHost(resultUrl, entity)) return null;
  const evidence = employerEvidence(entity, `${title} ${snippet || ''}`, resultUrl);
  if (!evidence) return null;

  const location = extractLocation(`${title} ${snippet || ''}`);
  const parsed = parseLocation(location);
  const id = createHash('sha256').update(resultUrl).digest('hex').slice(0, 32);
  return {
    external_id: `tinyfish-${id}`,
    source: SOURCE,
    title: cleanJobTitle(title, entity.name),
    department: null,
    location,
    city: parsed.city,
    state: parsed.state,
    country: parsed.country,
    lat: null,
    lng: null,
    is_remote: /\b(remote|virtual|work from home|wfh)\b/i.test(`${title} ${snippet || ''}`),
    is_overseas: parsed.country ? parsed.country !== 'US' : false,
    posted_at: null,
    raw_data: {
      tinyfish_title: title,
      tinyfish_snippet: snippet,
      tinyfish_site_name: clean(row?.site_name),
      tinyfish_position: numberOrNull(row?.position),
      tinyfish_recency_minutes: RECENCY_MINUTES,
      tinyfish_ai_query_expansions: Array.isArray(entity?.discovery_queries) ? entity.discovery_queries.slice(0, 2) : [],
      tinyfish_quality_gate: 'official-or-ats-detail-v2',
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

function trustedEmployerOrAtsHost(resultUrl: string, entity: any) {
  try {
    const host = new URL(resultUrl).hostname.replace(/^www\./, '').toLowerCase();
    const official = careerHost(entity);
    if (official && sameSite(host, official)) return true;
    return TRUSTED_ATS_HOST.test(host);
  } catch { return false; }
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
    const official = careerHost(entity);
    if (official && sameSite(resultHost, official)) return 'career-domain';
  } catch {}
  return null;
}

function isGenericTinyFishTitle(value: string) {
  const title = value.replace(/\s+/g, ' ').trim();
  return /\b(?:job vacancies|vacancies|open positions|job openings|careers?)\b.*\b(?:updated|aug|sep|oct|nov|dec|jan|feb|mar|apr|may|jun|jul)\b/i.test(title)
    || /^(?:latest|new|current)\s+.+\s+(?:jobs?|vacancies|openings)$/i.test(title)
    || /^.+\s+(?:jobs?|vacancies)\s+(?:202[4-9]|hiring now)$/i.test(title);
}

function cleanJobTitle(value: string, entityName: string) {
  let title = String(value || '').replace(/\s+/g, ' ').trim();
  const employer = escapeRegExp(String(entityName || '').trim());
  title = title
    .replace(/\s*[|•]\s*(?:LinkedIn|Indeed(?:\.com)?|Glassdoor|ZipRecruiter).*$/i, '')
    .replace(new RegExp(`\\s*[|–—-]\\s*(?:careers?|jobs?)?(?:\\s+at)?\\s*${employer}.*$`, 'i'), '')
    .trim();
  return title || value;
}

function extractLocation(text: string) {
  if (/\b(remote|virtual|work from home|wfh)\b/i.test(text)) return 'Remote';
  const cityStateCountry = text.match(/\b([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3},\s*(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)(?:,\s*United States)?)\b/);
  if (cityStateCountry?.[1]) return cityStateCountry[1].trim();
  const international = text.match(/\b([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3},\s*(?:Australia|Canada|Germany|Kuwait|Qatar|Poland|Japan|United Kingdom|Kenya|Uganda|Mauritius|Seychelles))\b/i);
  return international?.[1]?.trim() || null;
}

function parseLocation(location: string | null) {
  if (!location || /^remote$/i.test(location)) return { city: null, state: null, country: null };
  const parts = location.split(',').map(part => part.trim()).filter(Boolean);
  const state = parts.find(part => /^(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)$/i.test(part));
  if (state) return { city: parts[0] || null, state: state.toUpperCase(), country: 'US' };
  const country = normalizeCountry(parts[parts.length - 1]);
  return { city: parts.length > 1 ? parts[0] || null : null, state: null, country };
}

function normalizeCountry(value: unknown) {
  const text = String(value || '').trim().toLowerCase();
  const map: Record<string,string> = { australia:'AU', canada:'CA', germany:'DE', kuwait:'KW', qatar:'QA', poland:'PL', japan:'JP', 'united kingdom':'GB', kenya:'KE', uganda:'UG', mauritius:'MU', seychelles:'SC', 'united states':'US' };
  return map[text] || null;
}

function careerHost(entity: any) {
  try { return entity?.career_page_url ? new URL(String(entity.career_page_url)).hostname.replace(/^www\./, '').toLowerCase() : ''; } catch { return ''; }
}
function sameSite(left: string, right: string) { return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`); }
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
function dedupe(rows: any[]) { const seen = new Set<string>(); return rows.filter(row => { const key = String(row?.raw_data?.normalized_apply_url || row?.external_id || '').toLowerCase(); if (!key || seen.has(key)) return false; seen.add(key); return true; }); }
function comparable(value: unknown) { return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function containsPhrase(haystack: string, needle: string) { return ` ${haystack} `.includes(` ${needle} `); }
function stripLegalSuffix(value: string) { return value.replace(/\b(?:incorporated|inc|corporation|corp|company|co|limited|ltd|llc|plc|holdings?|group)\b/g, ' ').replace(/\s+/g, ' ').trim(); }
function clean(value: unknown) { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text || null; }
function numberOrNull(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function clampInt(value: unknown, fallback: number, min: number, max: number) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback; }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
