import { detectATS, type AtsProvider, type CompanyResolution } from './companyResolver';
import { resolveUSAJobsOrganizationCode } from './usajobs';

type GovernmentPortal = 'federal_agencies' | 'state_agencies' | 'counties_and_cities';

type SearchPage = {
  name?: string;
  url?: string;
  displayUrl?: string;
  snippet?: string;
  summary?: string;
};

const LANGSEARCH_ENDPOINT = 'https://api.langsearch.com/v1/web-search';

export function isGovernmentPortal(portal: unknown): portal is GovernmentPortal {
  return ['federal_agencies', 'state_agencies', 'counties_and_cities'].includes(String(portal || ''));
}

export async function resolveGovernmentEntity(
  name: string,
  portal: GovernmentPortal,
  suppliedCareerUrl?: string | null,
): Promise<CompanyResolution> {
  const cleanName = String(name || '').trim();
  const aliases = buildGovernmentAliases(cleanName, portal);
  const notes: string[] = [];

  if (portal === 'federal_agencies') {
    const agency = await resolveUSAJobsOrganizationCode(cleanName, aliases);
    if (agency) {
      notes.push(`Resolved USAJOBS organization ${agency.code}: ${agency.value}.`);
      return {
        name: cleanName,
        aliases,
        career_page_url: normalizeUrl(suppliedCareerUrl),
        ats_provider: 'usajobs',
        ats_board_id: agency.code,
        confidence: agency.score >= 95 ? 'high' : 'medium',
        notes,
      };
    }

    if (suppliedCareerUrl) {
      const supplied = await resolutionFromCareerUrl(cleanName, aliases, suppliedCareerUrl, notes);
      if (supplied) return supplied;
    }

    notes.push('USAJOBS organization code was not resolved; federal ingest will use verified keyword matching only.');
    return {
      name: cleanName,
      aliases,
      career_page_url: null,
      ats_provider: 'usajobs',
      ats_board_id: null,
      confidence: 'low',
      notes,
    };
  }

  if (suppliedCareerUrl) {
    const supplied = await resolutionFromCareerUrl(cleanName, aliases, suppliedCareerUrl, notes);
    if (supplied) return supplied;
  }

  const discovered = await discoverGovernmentCareerSurface(cleanName, portal);
  const discoveredUrl = discovered?.url || null;
  if (discovered && discoveredUrl) {
    const detection = await detectATS(discoveredUrl, cleanName);
    const provider = normalizeGovernmentProvider(detection.ats_provider, discoveredUrl);
    notes.push(`Discovered ${discovered.reason}.`);
    if (provider !== 'unknown') notes.push(`Detected hiring platform: ${provider}.`);
    return {
      name: cleanName,
      aliases,
      career_page_url: detection.matched_url || discoveredUrl,
      ats_provider: provider,
      ats_board_id: detection.ats_board_id || governmentJobsBoardId(discoveredUrl),
      confidence: discovered.score >= 95 ? 'high' : 'medium',
      notes,
    };
  }

  notes.push('No authoritative state/local career surface was auto-discovered. Add the official hiring URL to enable authoritative tracking.');
  return {
    name: cleanName,
    aliases,
    career_page_url: null,
    ats_provider: 'unknown',
    ats_board_id: null,
    confidence: 'low',
    notes,
  };
}

async function resolutionFromCareerUrl(name: string, aliases: string[], supplied: string, notes: string[]) {
  const url = canonicalizeGovernmentJobsUrl(normalizeUrl(supplied));
  if (!url) return null;
  const detection = await detectATS(url, name);
  const provider = normalizeGovernmentProvider(detection.ats_provider, url);
  notes.push('Using supplied government hiring URL.');
  return {
    name,
    aliases,
    career_page_url: detection.matched_url || url,
    ats_provider: provider,
    ats_board_id: detection.ats_board_id || governmentJobsBoardId(url),
    confidence: provider === 'unknown' ? 'medium' : 'high',
    notes,
  } satisfies CompanyResolution;
}

async function discoverGovernmentCareerSurface(name: string, portal: GovernmentPortal) {
  const searchHit = await searchGovernmentCareerSurface(name, portal);
  if (searchHit) return searchHit;
  return tryGovernmentJobsCandidates(name, portal);
}

async function searchGovernmentCareerSurface(name: string, portal: GovernmentPortal) {
  const keys = readLangSearchKeys();
  if (!keys.length) return null;

  const context = portal === 'state_agencies'
    ? 'state government agency'
    : 'county or city local government';
  const query = [
    `Find the official public employment or careers page for "${name}" (${context}).`,
    'Prefer the employer-owned .gov careers page or its official GovernmentJobs/NEOGOV, Workday, or other ATS career board.',
    'Do not return job aggregators, staffing firms, LinkedIn, Indeed, Glassdoor, or generic search pages.',
  ].join(' ');

  for (const key of keys) {
    try {
      const response = await fetch(readLangSearchEndpoint(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ query, freshness: 'noLimit', summary: true, count: 10 }),
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) {
        if ([401, 402, 403, 429].includes(response.status)) continue;
        return null;
      }
      const payload = await response.json().catch(() => null);
      const pages: SearchPage[] = Array.isArray(payload?.data?.webPages?.value) ? payload.data.webPages.value : [];
      const ranked = pages
        .map(page => rankGovernmentSearchPage(page, name))
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
        .sort((a, b) => b.score - a.score);
      if (ranked[0]?.score >= 75) return ranked[0];
      return null;
    } catch {
      continue;
    }
  }
  return null;
}

function rankGovernmentSearchPage(page: SearchPage, entityName: string) {
  const rawUrl = page.url || page.displayUrl;
  const url = canonicalizeGovernmentJobsUrl(normalizeUrl(rawUrl));
  if (!url) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  const text = normalizeComparable(`${page.name || ''} ${page.snippet || ''} ${page.summary || ''} ${url}`);
  const nameScore = entityNameEvidence(entityName, text);
  if (nameScore < 40) return null;

  const isGovernmentJobs = /(^|\.)governmentjobs\.com$/.test(host) && /^\/careers\/[^/]+/.test(path);
  const isGovDomain = host.endsWith('.gov') || host === 'gov';
  const isKnownAts = /(?:workday|icims|taleo|oraclecloud|jobvite|governmentjobs|neogov|dayforce|ultipro|ukg|adp|paylocity|applicantpro)/i.test(host);
  const hasCareerPath = /career|jobs?|employment|opportunit|recruit/i.test(`${path} ${page.name || ''}`);
  if (!isGovernmentJobs && !isGovDomain && !isKnownAts) return null;
  if (!isGovernmentJobs && !hasCareerPath) return null;

  let score = nameScore;
  if (isGovernmentJobs) score += 30;
  else if (isGovDomain) score += 24;
  else if (isKnownAts) score += 20;
  if (/job opportunities|careers|employment|open positions/i.test(`${page.name || ''} ${page.snippet || ''}`)) score += 8;

  return {
    url,
    score: Math.min(score, 100),
    reason: isGovernmentJobs
      ? 'official GovernmentJobs/NEOGOV career board'
      : isGovDomain
        ? 'official government careers page'
        : 'official ATS career board',
  };
}

async function tryGovernmentJobsCandidates(name: string, portal: GovernmentPortal) {
  const slugs = governmentJobsSlugCandidates(name, portal);
  for (const slug of slugs) {
    const url = `https://www.governmentjobs.com/careers/${slug}`;
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': 'OccuMedHiringTrendDashboard/1.0', accept: 'text/html' },
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) continue;
      const finalUrl = canonicalizeGovernmentJobsUrl(response.url || url);
      if (!finalUrl) continue;
      const html = await response.text();
      const searchable = normalizeComparable(`${html.slice(0, 160000)} ${finalUrl}`);
      const score = entityNameEvidence(name, searchable);
      if (score < 55 || !/governmentjobs|job opportunities|career pages/i.test(html)) continue;
      return { url: finalUrl, score: Math.min(85 + Math.floor(score / 10), 94), reason: 'verified GovernmentJobs/NEOGOV career board' };
    } catch {
      continue;
    }
  }
  return null;
}

function governmentJobsSlugCandidates(name: string, portal: GovernmentPortal) {
  const raw = normalizeComparable(name);
  const stripped = raw
    .replace(/^state of /, '')
    .replace(/^city of /, '')
    .replace(/^county of /, '')
    .replace(/ county$/, '')
    .replace(/ city$/, '')
    .replace(/ department$/, '')
    .trim();
  const compact = (value: string) => value.replace(/[^a-z0-9]+/g, '');
  const candidates = new Set<string>();
  if (stripped) candidates.add(compact(stripped));
  if (raw) candidates.add(compact(raw));
  if (portal === 'counties_and_cities' && stripped) {
    candidates.add(`${compact(stripped)}county`);
    candidates.add(`${compact(stripped)}city`);
  }
  return Array.from(candidates).filter(value => value.length >= 3 && value.length <= 60).slice(0, 6);
}

function canonicalizeGovernmentJobsUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (/(^|\.)governmentjobs\.com$/i.test(url.hostname)) {
      const match = url.pathname.match(/^\/careers\/([^/?#]+)/i);
      if (match?.[1]) {
        url.pathname = `/careers/${match[1]}`;
        url.search = '';
        url.hash = '';
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

function governmentJobsBoardId(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.pathname.match(/^\/careers\/([^/?#]+)/i)?.[1] || null;
  } catch {
    return null;
  }
}

function normalizeGovernmentProvider(provider: AtsProvider, url: string) {
  if (provider !== 'unknown') return provider;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (/(^|\.)governmentjobs\.com$/.test(host)) return 'governmentjobs' as AtsProvider;
    if (/(^|\.)neogov\.com$/.test(host)) return 'neogov' as AtsProvider;
  } catch {}
  return provider;
}

function buildGovernmentAliases(name: string, portal: GovernmentPortal) {
  const aliases = new Set<string>();
  const normalized = name.replace(/\s+/g, ' ').trim();
  const withoutPrefix = normalized.replace(/^(?:the\s+)?(?:state|city|county)\s+of\s+/i, '').trim();
  if (withoutPrefix && withoutPrefix.toLowerCase() !== normalized.toLowerCase()) aliases.add(withoutPrefix);
  if (portal === 'counties_and_cities') {
    const withoutSuffix = withoutPrefix.replace(/\s+(?:county|city)$/i, '').trim();
    if (withoutSuffix && withoutSuffix.toLowerCase() !== normalized.toLowerCase()) aliases.add(withoutSuffix);
  }
  return Array.from(aliases);
}

function entityNameEvidence(name: string, searchable: string) {
  const normalizedName = normalizeComparable(name);
  if (!normalizedName || !searchable) return 0;
  if (containsPhrase(searchable, normalizedName)) return 70;
  const canonical = normalizedName
    .replace(/^(?:the )?(?:state|city|county) of /, '')
    .replace(/\b(?:department|dept|agency|office|commission)\b/g, ' ')
    .replace(/\b(?:of|the|for|and)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (canonical.length >= 4 && containsPhrase(searchable, canonical)) return 60;
  const tokens = canonical.split(' ').filter(token => token.length >= 4);
  if (!tokens.length) return 0;
  const matches = tokens.filter(token => containsPhrase(searchable, token)).length;
  return Math.round((matches / tokens.length) * 55);
}

function containsPhrase(haystack: string, needle: string) {
  return ` ${haystack} `.includes(` ${needle} `);
}

function normalizeComparable(value: unknown) {
  return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
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

function readLangSearchKeys() {
  const values = [
    firstEnv(['LANGSEARCH_API_KEY', 'LANGSEARCH-API-KEY', 'LANG_SEARCH_API_KEY']),
    firstEnv(['LANGSEARCH_API_KEY_2', 'LANGSEARCH-API-KEY-2', 'LANG_SEARCH_API_KEY_2']),
  ].filter(Boolean) as string[];
  return Array.from(new Set(values));
}

function readLangSearchEndpoint() {
  const configured = firstEnv(['LANGSEARCH_API_URL', 'LANGSEARCH_ENDPOINT']);
  if (!configured) return LANGSEARCH_ENDPOINT;
  try {
    const url = new URL(configured);
    return url.protocol === 'https:' ? url.toString() : LANGSEARCH_ENDPOINT;
  } catch {
    return LANGSEARCH_ENDPOINT;
  }
}

function firstEnv(names: string[]) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}
