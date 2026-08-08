import { fetchJson, getIngestTimeout } from './http';

const SEARCH_BASE = 'https://data.usajobs.gov/api/search';
const AGENCY_CODELIST_URL = 'https://data.usajobs.gov/api/codelist/agencysubelements';

type AgencyResolution = {
  code: string;
  value: string;
  score: number;
};

type SearchOptions = {
  keyword?: string | null;
  organization?: string | null;
  page?: number;
  resultsPerPage?: number;
};

function getUsaJobsCredentials() {
  const apiKey = (process.env.USAJOBS_API_KEY || '').trim();
  const userAgent = (
    process.env.USAJOBS_USER_AGENT
    || process.env.USAJOBS_EMAIL
    || ''
  ).trim();
  return { apiKey, userAgent };
}

export async function resolveUSAJobsOrganizationCode(name: string, aliases: string[] = []): Promise<AgencyResolution | null> {
  const names = [name, ...aliases].map(clean).filter(Boolean) as string[];
  if (!names.length) return null;

  try {
    const payload = await fetchJson(AGENCY_CODELIST_URL, { headers: { Accept: 'application/json' } }, getIngestTimeout(10000));
    const values = Array.isArray(payload?.CodeList)
      ? payload.CodeList.flatMap((list: any) => Array.isArray(list?.ValidValue) ? list.ValidValue : [])
      : [];

    let best: AgencyResolution | null = null;
    for (const row of values) {
      const code = clean(row?.Code);
      const value = clean(row?.Value);
      if (!code || !value || String(row?.IsDisabled || '').toLowerCase() === 'yes') continue;
      const score = Math.max(...names.map(candidate => agencyNameScore(candidate, value)));
      if (!best || score > best.score || (score === best.score && value.length < best.value.length)) {
        best = { code, value, score };
      }
    }

    return best && best.score >= 82 ? best : null;
  } catch (error) {
    console.warn('USAJOBS agency code-list lookup failed:', error);
    return null;
  }
}

/** Backward-compatible single-page keyword search. */
export async function fetchUSAJobsPostings(keywords: string, page: number = 1) {
  const result = await searchUSAJobs({ keyword: keywords, page, resultsPerPage: 500 });
  return { jobs: result.jobs, total: result.total };
}

/**
 * Authoritative federal-agency ingest.
 * Resolves the USAJOBS Agency Subelement code and follows every results page.
 * Keyword fallback is permitted only when returned rows can be verified against
 * the agency/department fields in the USAJOBS payload.
 */
export async function fetchUSAJobsForAgency(entityName: string, organizationCode?: string | null, aliases: string[] = []) {
  const configuredCode = clean(organizationCode);
  const resolved = configuredCode
    ? { code: configuredCode, value: entityName, score: 100 }
    : await resolveUSAJobsOrganizationCode(entityName, aliases);

  const maxPages = clamp(positiveIntegerEnv('USAJOBS_MAX_PAGES', 20), 1, 100);
  const resultsPerPage = clamp(positiveIntegerEnv('USAJOBS_RESULTS_PER_PAGE', 500), 25, 500);
  const collected: any[] = [];
  let total = 0;
  let pages = 0;
  let mode: 'organization' | 'keyword-verified' = resolved ? 'organization' : 'keyword-verified';

  for (let page = 1; page <= maxPages; page++) {
    const response = await searchUSAJobs({
      organization: resolved?.code || null,
      keyword: resolved ? null : entityName,
      page,
      resultsPerPage,
    });
    pages = page;
    total = response.total;

    const accepted = resolved
      ? response.jobs
      : response.jobs.filter(job => matchesAgencyPayload(job, entityName, aliases));
    collected.push(...accepted);

    if (!response.jobs.length || page >= response.numberOfPages) break;
  }

  const jobs = dedupeJobs(collected).map(job => ({
    ...job,
    raw_data: {
      ...(job.raw_data || {}),
      normalized_employer_source: 'usajobs-authoritative',
      normalized_agency_match_mode: mode,
      normalized_agency_code: resolved?.code || null,
      normalized_agency_name: resolved?.value || entityName,
      normalized_pages_scanned: pages,
    },
  }));

  return {
    jobs,
    total,
    organizationCode: resolved?.code || null,
    organizationName: resolved?.value || null,
    mode,
    pages,
  };
}

async function searchUSAJobs(options: SearchOptions) {
  const { apiKey, userAgent } = getUsaJobsCredentials();
  if (!apiKey || !userAgent) return { jobs: [], total: 0, numberOfPages: 0 };

  try {
    const page = Math.max(1, Math.floor(Number(options.page) || 1));
    const resultsPerPage = clamp(Math.floor(Number(options.resultsPerPage) || 500), 1, 500);
    const params = new URLSearchParams({
      ResultsPerPage: String(resultsPerPage),
      Page: String(page),
      Fields: 'Full',
    });
    if (clean(options.organization)) params.set('Organization', clean(options.organization)!);
    if (clean(options.keyword)) params.set('Keyword', clean(options.keyword)!);

    const data = await fetchJson(`${SEARCH_BASE}?${params}`, {
      headers: {
        'Authorization-Key': apiKey,
        'User-Agent': userAgent,
        Host: 'data.usajobs.gov',
      },
    }, getIngestTimeout(15000));

    const items = data?.SearchResult?.SearchResultItems || [];
    const total = Number(data?.SearchResult?.SearchResultCountAll ?? data?.SearchResult?.SearchResultCount ?? 0) || 0;
    const numberOfPages = Number(data?.SearchResult?.UserArea?.NumberOfPages) || Math.max(1, Math.ceil(total / resultsPerPage));

    return {
      total,
      numberOfPages,
      jobs: (Array.isArray(items) ? items : []).map(normalizeUSAJobsItem).filter(Boolean),
    };
  } catch (error) {
    console.error('USAJobs fetch error:', error);
    return { jobs: [], total: 0, numberOfPages: 0 };
  }
}

function normalizeUSAJobsItem(item: any) {
  const pos = item?.MatchedObjectDescriptor;
  if (!pos?.PositionTitle) return null;
  const locations = Array.isArray(pos?.PositionLocation) ? pos.PositionLocation : [];
  const loc = locations[0] || {};
  const country = normalizeCountry(loc?.CountryCode || loc?.CountryName || loc?.Country) || 'US';
  const applyUrl = firstString(pos?.ApplyURI) || clean(pos?.PositionURI);

  return {
    external_id: String(pos?.PositionID || pos?.PositionURI || pos?.PositionTitle),
    source: 'usajobs',
    title: pos?.PositionTitle,
    department: pos?.OrganizationName || pos?.DepartmentName || pos?.UserArea?.Details?.SubAgencyName || null,
    location: loc?.LocationName || null,
    city: loc?.CityName || null,
    state: loc?.CountrySubDivisionCode || null,
    country,
    lat: toNumber(loc?.Latitude),
    lng: toNumber(loc?.Longitude),
    is_remote: Boolean(pos?.UserArea?.Details?.RemoteIndicator) || /remote/i.test(`${pos?.PositionTitle || ''} ${loc?.LocationName || ''}`),
    is_overseas: country !== 'US',
    posted_at: pos?.PublicationStartDate || null,
    raw_data: {
      ...pos,
      normalized_apply_url: applyUrl,
      normalized_location_candidates: locations.map((entry: any) => entry?.LocationName).filter(Boolean),
      normalized_employer_source: 'usajobs',
    },
  };
}

function matchesAgencyPayload(job: any, name: string, aliases: string[]) {
  const raw = job?.raw_data || {};
  const searchable = [
    raw.OrganizationName,
    raw.DepartmentName,
    raw?.UserArea?.Details?.SubAgencyName,
    raw?.UserArea?.Details?.OrganizationCodes,
    job?.department,
  ].filter(Boolean).join(' | ');
  return [name, ...aliases].some(candidate => agencyNameScore(candidate, searchable) >= 82);
}

function agencyNameScore(left: string, right: string) {
  const rawLeft = normalizeComparable(left);
  const rawRight = normalizeComparable(right);
  if (!rawLeft || !rawRight) return 0;
  if (rawLeft === rawRight) return 100;

  const canonicalLeft = canonicalGovernmentName(rawLeft);
  const canonicalRight = canonicalGovernmentName(rawRight);
  if (canonicalLeft && canonicalRight && canonicalLeft === canonicalRight) return 97;

  if (canonicalLeft.length >= 5 && containsPhrase(rawRight, canonicalLeft)) return 90;
  if (canonicalRight.length >= 5 && containsPhrase(rawLeft, canonicalRight)) return 88;

  const leftTokens = meaningfulTokens(canonicalLeft || rawLeft);
  const rightTokens = meaningfulTokens(canonicalRight || rawRight);
  if (!leftTokens.length || !rightTokens.length) return 0;
  const overlap = leftTokens.filter(token => rightTokens.includes(token)).length;
  const recall = overlap / leftTokens.length;
  const precision = overlap / rightTokens.length;
  if (recall === 1 && precision >= 0.6) return 86;
  if (recall >= 0.8 && precision >= 0.6) return 82;
  return Math.round(((recall + precision) / 2) * 80);
}

function canonicalGovernmentName(value: string) {
  return value
    .replace(/\b(?:united states|u s|us)\b/g, ' ')
    .replace(/\b(?:department|dept|agency|administration|office|bureau|service|services|commission)\b/g, ' ')
    .replace(/\b(?:of|the|for|and)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function meaningfulTokens(value: string) {
  return value.split(' ').filter(token => token.length >= 3 && !['the','and','for','with','from'].includes(token));
}

function normalizeComparable(value: unknown) {
  return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function containsPhrase(haystack: string, needle: string) {
  return ` ${haystack} `.includes(` ${needle} `);
}

function normalizeCountry(value: unknown) {
  const raw = clean(value);
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper === 'UK' ? 'GB' : upper;
  const map: Record<string, string> = {
    'UNITED STATES': 'US',
    'UNITED STATES OF AMERICA': 'US',
    'GERMANY': 'DE',
    'UNITED KINGDOM': 'GB',
    'JAPAN': 'JP',
    'SOUTH KOREA': 'KR',
    'KOREA': 'KR',
    'ITALY': 'IT',
    'SPAIN': 'ES',
    'POLAND': 'PL',
    'KUWAIT': 'KW',
    'QATAR': 'QA',
    'BAHRAIN': 'BH',
    'IRAQ': 'IQ',
    'AUSTRALIA': 'AU',
  };
  return map[upper] || null;
}

function firstString(value: unknown) {
  if (Array.isArray(value)) return clean(value[0]);
  return clean(value);
}

function dedupeJobs(jobs: any[]) {
  const seen = new Set<string>();
  return jobs.filter(job => {
    const key = String(job?.external_id || job?.raw_data?.normalized_apply_url || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clean(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

function toNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveIntegerEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
