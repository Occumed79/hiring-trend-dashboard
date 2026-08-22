type EntityLike = {
  name: string;
  aliases?: string[] | null;
  career_page_url?: string | null;
  industry?: string | null;
  category?: string | null;
};

type KeenableResult = { jobs: any[]; used: string[]; skipped: string[] };

const SOURCE = 'web:keenable';
const ENDPOINT = 'https://api.keenable.ai/v1/search';
const TIMEOUT_MS = positiveIntegerEnv('KEENABLE_TIMEOUT_MS', 12000);

export async function fetchKeenableJobs(entity: EntityLike): Promise<KeenableResult> {
  const apiKey = String(process.env.KEENABLE_API_KEY || '').trim();
  if (!apiKey) return { jobs: [], used: [], skipped: ['keenable (key missing)'] };

  const query = buildQuery(entity);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Keenable-Title': 'Occu-Med Hiring Insights',
      },
      body: JSON.stringify({ query, mode: 'pro' }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const results = Array.isArray(payload?.results) ? payload.results : [];
    const jobs = dedupe(results.map((row: any) => normalizeResult(row, entity, query)).filter(Boolean));

    return jobs.length
      ? { jobs, used: [SOURCE], skipped: [] }
      : { jobs: [], used: [], skipped: ['keenable (0 job-detail results)'] };
  } catch (error) {
    const message = (error as any)?.name === 'AbortError'
      ? `timeout after ${TIMEOUT_MS}ms`
      : error instanceof Error ? error.message : String(error);
    return { jobs: [], used: [], skipped: [`keenable (${message})`] };
  } finally {
    clearTimeout(timeout);
  }
}

function buildQuery(entity: EntityLike) {
  const aliases = Array.isArray(entity.aliases) ? entity.aliases.slice(0, 2) : [];
  const names = [entity.name, ...aliases].filter(Boolean).map(name => `"${String(name)}"`).join(' OR ');
  return `${names} current open jobs careers job openings apply`;
}

function normalizeResult(row: any, entity: EntityLike, query: string) {
  const url = normalizeUrl(row?.url);
  const titleText = clean(row?.title);
  const snippet = clean(row?.snippet || row?.description);
  if (!url || !titleText || !looksLikeJobDetail(url, titleText)) return null;

  const searchable = `${titleText} ${snippet || ''}`;
  if (!hasEmployerEvidence(searchable, url, entity)) return null;

  const title = cleanJobTitle(titleText, entity.name);
  if (!title) return null;
  const location = extractLocation(searchable);

  return {
    external_id: `keenable-${hashString(url)}`,
    source: SOURCE,
    title,
    department: entity.name,
    location,
    city: splitCity(location),
    state: splitState(location),
    country: detectCountry(`${location || ''} ${searchable}`) || null,
    lat: null,
    lng: null,
    is_remote: /\b(remote|work from home|wfh|virtual)\b/i.test(searchable),
    is_overseas: false,
    posted_at: normalizeDate(row?.published_at),
    raw_data: {
      normalized_employer: entity.name,
      normalized_apply_url: url,
      employer_name: entity.name,
      company_name: entity.name,
      normalized_employer_source: 'keenable-result-evidence',
      keenable_title: titleText,
      keenable_snippet: snippet,
      keenable_published_at: row?.published_at || null,
      keenable_acquired_at: row?.acquired_at || null,
      search_query: query,
      url,
      source_graph_lineage: 'keenable',
    },
  };
}

function hasEmployerEvidence(searchable: string, resultUrl: string, entity: EntityLike) {
  const result = parseUrl(resultUrl);
  const career = parseUrl(entity.career_page_url);
  if (result && career && sameSite(result.hostname, career.hostname)) return true;

  const haystack = normalizeComparable(searchable);
  const names = [entity.name, ...(Array.isArray(entity.aliases) ? entity.aliases : [])]
    .map(value => normalizeComparable(value))
    .filter(Boolean);

  for (const name of names) {
    if (name.length >= 3 && containsPhrase(haystack, name)) return true;
    const stripped = stripLegalSuffix(name);
    if (stripped.length >= 4 && stripped !== name && containsPhrase(haystack, stripped)) return true;
  }
  return false;
}

function looksLikeJobDetail(url: string, title: string) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  const target = `${parsed.hostname}${parsed.pathname}${parsed.search}`.toLowerCase();
  if (/^\/(?:careers?|jobs?|employment|join-us|work-with-us)\/?$/i.test(parsed.pathname)) return false;
  if (/^(?:careers?|jobs?|job search|search jobs|open positions|job openings)$/i.test(title.trim())) return false;
  return [
    /\/(?:job|jobs|positions?|openings?|requisitions?)\/[^/?#]{3,}/i,
    /(?:jobid|job_id|gh_jid|requisitionid|reqid|postingid|jk)=/i,
    /boards\.greenhouse\.io\/[^/]+\/jobs\/\d+/i,
    /jobs\.lever\.co\/[^/]+\/[^/?#]+/i,
    /(?:myworkdayjobs|workdayjobs)\.com\/.+\/job\//i,
    /smartrecruiters\.com\/[^/]+\/\d+/i,
    /icims\.com\/jobs\/\d+/i,
    /taleo\.net\/.+(?:jobdetail|requisition)/i,
    /jobvite\.com\/.+(?:job|position)/i,
    /bamboohr\.com\/careers\/\d+/i,
    /usajobs\.gov\/job\/\d+/i,
    /governmentjobs\.com\/careers\/[^/]+\/jobs\/\d+/i,
    /linkedin\.com\/jobs\/view\/\d+/i,
    /indeed\.com\/viewjob/i,
  ].some(pattern => pattern.test(target));
}

function cleanJobTitle(value: string, entityName: string) {
  let title = value.replace(/\s+/g, ' ').trim();
  const company = escapeRegExp(entityName.trim());
  title = title
    .replace(/\s*[|•]\s*(?:LinkedIn|Indeed(?:\.com)?|Glassdoor|ZipRecruiter|USAJOBS).*$/i, '')
    .replace(new RegExp(`\\s*[|–—-]\\s*(?:careers?|jobs?)?(?:\\s+at)?\\s*${company}.*$`, 'i'), '')
    .trim();
  return title.length >= 3 && title.length <= 180 ? title : null;
}

function extractLocation(value: string) {
  if (/\b(remote|work from home|wfh|virtual)\b/i.test(value)) return 'Remote';
  const cityState = value.match(/\b([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3},\s*(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY))\b/);
  return cityState?.[1]?.trim() || null;
}

function detectCountry(value: string) {
  if (/\b(?:united states|u\.s\.|usa)\b/i.test(value)) return 'US';
  if (/\bcanada\b/i.test(value)) return 'CA';
  if (/\bgermany\b/i.test(value)) return 'DE';
  if (/\bkuwait\b/i.test(value)) return 'KW';
  if (/\bqatar\b/i.test(value)) return 'QA';
  if (/\bpoland\b/i.test(value)) return 'PL';
  if (/\baustralia\b/i.test(value)) return 'AU';
  if (/\bjapan\b/i.test(value)) return 'JP';
  if (/\b[A-Z][A-Za-z .'-]{1,48},\s*[A-Z]{2}\b/.test(value)) return 'US';
  return null;
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

function parseUrl(value: unknown) {
  if (!value) return null;
  try {
    const url = new URL(String(value).trim());
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}
function sameSite(leftHost: string, rightHost: string) { const left = leftHost.toLowerCase().replace(/^www\./,''); const right = rightHost.toLowerCase().replace(/^www\./,''); return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`); }
function normalizeComparable(value: unknown) { return String(value || '').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim(); }
function containsPhrase(haystack: string, needle: string) { return !!haystack && !!needle && ` ${haystack} `.includes(` ${needle} `); }
function stripLegalSuffix(value: string) { return value.replace(/\b(?:incorporated|inc|corporation|corp|company|co|limited|ltd|llc|plc|holdings?|group)\b/g,' ').replace(/\s+/g,' ').trim(); }
function splitCity(location?: string | null) { return location && !/^remote$/i.test(location) ? location.split(',')[0]?.trim() || null : null; }
function splitState(location?: string | null) { return location && !/^remote$/i.test(location) ? location.split(',')[1]?.trim() || null : null; }
function clean(value: unknown) { const text = String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); return text || null; }
function normalizeDate(value: unknown) { if (!value) return null; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function normalizeUrl(value: unknown) { const url = parseUrl(value); if (!url) return null; url.hash = ''; return url.toString(); }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function hashString(value: string) { let hash = 2166136261; for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(36); }
function positiveIntegerEnv(name: string, fallback: number) { const parsed = Number(process.env[name]); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
