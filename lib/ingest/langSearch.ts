type EntityLike = {
  name: string;
  aliases?: string[] | null;
  portal?: string | null;
  category?: string | null;
  industry?: string | null;
};

type LangSearchWebPage = {
  id?: string;
  name?: string;
  url?: string;
  displayUrl?: string;
  snippet?: string;
  summary?: string;
  datePublished?: string;
  dateLastCrawled?: string;
};

type LangSearchIngestResult = {
  jobs: any[];
  used: string[];
  skipped: string[];
};

const SOURCE = 'web:langsearch';
const DEFAULT_ENDPOINT = 'https://api.langsearch.com/v1/web-search';
const REQUEST_TIMEOUT_MS = positiveIntegerEnv('LANGSEARCH_TIMEOUT_MS', 12000);
const RESULT_LIMIT = clamp(positiveIntegerEnv('LANGSEARCH_RESULT_LIMIT', 10), 1, 10);
const FRESHNESS = readFreshness();
const INCLUDE_SUMMARIES = booleanEnv('LANGSEARCH_SUMMARY', false);

export async function fetchLangSearchJobs(entity: EntityLike): Promise<LangSearchIngestResult> {
  const apiKey = firstNonEmptyEnv([
    'LANGSEARCH_API_KEY',
    'LANGSEARCH-API-KEY',
    'LANG_SEARCH_API_KEY',
  ]);

  if (!apiKey) return { jobs: [], used: [], skipped: ['langsearch (key missing)'] };

  const query = buildQuery(entity);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(readEndpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query,
        freshness: FRESHNESS,
        summary: INCLUDE_SUMMARIES,
        count: RESULT_LIMIT,
      }),
      signal: controller.signal,
    }).catch((error) => {
      if ((error as any)?.name === 'AbortError') {
        throw new Error(`timeout after ${REQUEST_TIMEOUT_MS}ms`);
      }
      throw error;
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (payload?.code !== undefined && Number(payload.code) !== 200) {
      throw new Error(`API code ${payload.code}`);
    }

    const pages: LangSearchWebPage[] = Array.isArray(payload?.data?.webPages?.value)
      ? payload.data.webPages.value
      : [];
    const jobs = dedupeJobs(
      pages
        .map((page) => normalizeResult(page, entity, query))
        .filter((job): job is NonNullable<typeof job> => Boolean(job))
    );

    return jobs.length
      ? { jobs, used: [SOURCE], skipped: [] }
      : { jobs: [], used: [], skipped: ['langsearch (0 job-detail results)'] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { jobs: [], used: [], skipped: [`langsearch (${message})`] };
  } finally {
    clearTimeout(timeout);
  }
}

function buildQuery(entity: EntityLike) {
  const aliases = Array.isArray(entity.aliases)
    ? entity.aliases.map((alias) => String(alias).trim()).filter(Boolean).slice(0, 3)
    : [];
  const names = [entity.name, ...aliases].map((name) => `"${name}"`).join(' OR ');
  const context = [entity.industry, entity.category].filter(Boolean).join(' ');

  return [
    `Find current open job postings for ${names}.`,
    'Return direct employer or applicant-tracking-system job detail pages, not generic career landing pages.',
    context ? `Relevant context: ${context}.` : '',
  ].filter(Boolean).join(' ');
}

function normalizeResult(page: LangSearchWebPage, entity: EntityLike, query: string) {
  const url = normalizeUrl(page.url || page.displayUrl);
  const originalTitle = cleanText(page.name);
  const snippet = cleanText(page.snippet);
  const summary = cleanText(page.summary);
  if (!url || !originalTitle) return null;

  const searchableText = `${originalTitle} ${snippet || ''} ${summary || ''}`;
  if (!looksLikeJobDetail(url, originalTitle)) return null;

  const title = cleanJobTitle(originalTitle, entity.name);
  if (!title || isGenericJobTitle(title)) return null;

  const location = extractLocation(searchableText);
  const country = detectCountry(`${location || ''} ${searchableText}`) || 'US';

  return {
    external_id: `langsearch-${hashString(`${entity.name}|${url}|${title}`)}`,
    source: SOURCE,
    title,
    department: entity.name,
    location,
    city: splitCity(location),
    state: splitState(location),
    country,
    lat: null,
    lng: null,
    is_remote: /\b(remote|work from home|wfh|virtual)\b/i.test(searchableText),
    is_overseas: country !== 'US',
    posted_at: normalizeDate(page.datePublished),
    raw_data: {
      normalized_employer: entity.name,
      normalized_apply_url: url,
      url,
      search_query: query,
      langsearch_result_id: page.id || null,
      langsearch_title: originalTitle,
      langsearch_snippet: snippet,
      langsearch_summary: summary,
      date_published: page.datePublished || null,
      date_last_crawled: page.dateLastCrawled || null,
    },
  };
}

function looksLikeJobDetail(url: string, title: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const target = `${parsed.hostname}${parsed.pathname}${parsed.search}`.toLowerCase();
  const genericPath = /^\/(?:careers?|jobs?|employment|join-us|work-with-us)\/?$/i.test(parsed.pathname);
  if (genericPath || isGenericJobTitle(title)) return false;

  const detailSignals = [
    /\/(?:job|jobs|positions?|openings?|requisitions?)\/[^/?#]{3,}/i.test(parsed.pathname),
    /(?:jobid|job_id|gh_jid|requisitionid|reqid|postingid|jk)=/i.test(parsed.search),
    /\/[^/]*\d{4,}[^/]*\/?$/i.test(parsed.pathname),
    /boards\.greenhouse\.io\/[^/]+\/jobs\/\d+/i.test(target),
    /jobs\.lever\.co\/[^/]+\/[^/?#]+/i.test(target),
    /(?:myworkdayjobs|workdayjobs)\.com\/.+\/job\//i.test(target),
    /smartrecruiters\.com\/[^/]+\/\d+/i.test(target),
    /icims\.com\/jobs\/\d+/i.test(target),
    /taleo\.net\/.+(?:jobdetail|requisition)/i.test(target),
    /jobvite\.com\/.+(?:job|position)/i.test(target),
    /bamboohr\.com\/careers\/\d+/i.test(target),
    /usajobs\.gov\/job\/\d+/i.test(target),
    /indeed\.com\/viewjob/i.test(target),
    /linkedin\.com\/jobs\/view\//i.test(target),
  ];

  return detailSignals.some(Boolean);
}

function cleanJobTitle(value: string, entityName: string) {
  let title = cleanText(value) || '';
  const company = escapeRegExp(entityName.trim());

  title = title
    .replace(/\s*[|•]\s*(?:LinkedIn|Indeed(?:\.com)?|Glassdoor|ZipRecruiter|USAJOBS).*$/i, '')
    .replace(new RegExp(`\\s*[|–—-]\\s*(?:careers?|jobs?)?(?:\\s+at)?\\s*${company}.*$`, 'i'), '')
    .replace(/\s+/g, ' ')
    .trim();

  return title.length >= 3 && title.length <= 180 ? title : null;
}

function isGenericJobTitle(value: string) {
  const normalized = (cleanText(value) || '')
    .toLowerCase()
    .replace(/[|:–—-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(?:careers?|jobs?|job search|search jobs|job openings|open positions|employment opportunities|join our team|work with us)(?:\s+(?:at|with|for)\s+.+)?$/.test(normalized);
}

function extractLocation(value: string) {
  if (/\b(remote|work from home|wfh|virtual)\b/i.test(value)) return 'Remote';

  const cityState = value.match(/\b([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3},\s*(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY))\b/);
  if (cityState?.[1]) return cityState[1].trim();

  const labeled = value.match(/\b(?:location|job location|work location)\s*[:\-–—]\s*([^|•.;]{2,80})/i);
  return labeled?.[1]?.trim() || null;
}

function detectCountry(value: string) {
  const mappings: Array<[RegExp, string]> = [
    [/\b(?:united states|u\.s\.|usa)\b/i, 'US'],
    [/\bcanada\b/i, 'CA'],
    [/\b(?:united kingdom|great britain|uk)\b/i, 'GB'],
    [/\bgermany\b/i, 'DE'],
    [/\bkuwait\b/i, 'KW'],
    [/\bqatar\b/i, 'QA'],
    [/\bbahrain\b/i, 'BH'],
    [/\biraq\b/i, 'IQ'],
    [/\bpoland\b/i, 'PL'],
    [/\baustralia\b/i, 'AU'],
    [/\bjapan\b/i, 'JP'],
    [/\b(?:south korea|korea)\b/i, 'KR'],
  ];

  for (const [pattern, code] of mappings) {
    if (pattern.test(value)) return code;
  }
  if (/\b[A-Z][A-Za-z .'-]{1,48},\s*[A-Z]{2}\b/.test(value)) return 'US';
  return null;
}

function splitCity(location?: string | null) {
  if (!location || /^remote$/i.test(location)) return null;
  return location.split(',')[0]?.trim() || null;
}

function splitState(location?: string | null) {
  if (!location || /^remote$/i.test(location)) return null;
  return location.split(',')[1]?.trim() || null;
}

function normalizeUrl(value?: string | null) {
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

function normalizeDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanText(value?: string | null) {
  if (!value) return null;
  return String(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

function dedupeJobs(jobs: any[]) {
  const seen = new Set<string>();
  return jobs.filter((job) => {
    const key = `${job.source}:${job.raw_data?.normalized_apply_url || job.external_id}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function readEndpoint() {
  const configured = firstNonEmptyEnv(['LANGSEARCH_API_URL', 'LANGSEARCH_ENDPOINT']);
  if (!configured) return DEFAULT_ENDPOINT;
  try {
    const url = new URL(configured);
    return url.protocol === 'https:' ? url.toString() : DEFAULT_ENDPOINT;
  } catch {
    return DEFAULT_ENDPOINT;
  }
}

function readFreshness() {
  const configured = (process.env.LANGSEARCH_FRESHNESS || 'oneMonth').trim();
  const allowed = new Set(['oneDay', 'oneWeek', 'oneMonth', 'oneYear', 'noLimit']);
  return allowed.has(configured) ? configured : 'oneMonth';
}

function firstNonEmptyEnv(names: string[]) {
  for (const name of names) {
    const value = (process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function positiveIntegerEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function booleanEnv(name: string, fallback: boolean) {
  const value = (process.env[name] || '').trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
  return fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
