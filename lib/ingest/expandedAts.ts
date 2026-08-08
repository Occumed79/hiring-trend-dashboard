import { fetchCareerPageJobs } from './careerPage';
import { fetchJson, getIngestTimeout } from './http';
export { fetchWorkableJobs } from './workable';
export { fetchPersonioJobs } from './personio';

export const STRUCTURED_ATS_PROVIDERS = new Set(['ashby', 'recruitee', 'workday', 'workable', 'personio']);

export const HOSTED_ATS_PROVIDERS = new Set([
  'icims',
  'taleo',
  'oracle',
  'jobvite',
  'successfactors',
  'teamtailor',
  'comeet',
  'breezyhr',
  'jazzhr',
  'rippling',
  'dayforce',
  'ukg',
  'adp',
  'paylocity',
  'paycom',
  'neogov',
  'governmentjobs',
  'applicantpro',
  'pinpoint',
  'zoho_recruit',
  'bullhorn',
  'ceipal',
  'clearcompany',
  'cornerstone',
  'ultipro',
]);

export async function fetchAshbyJobs(jobBoardName: string) {
  if (!jobBoardName) return [];
  try {
    const payload = await fetchJson(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(jobBoardName)}?includeCompensation=true`,
      { headers: { Accept: 'application/json' } },
      getIngestTimeout(12000),
    );
    const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
    return jobs
      .filter((job: any) => job?.isListed !== false && job?.title)
      .map((job: any) => {
        const primaryAddress = job.address || job.locationAddress || firstSecondaryAddress(job.secondaryLocations);
        const location = clean(job.location) || addressToLocation(primaryAddress) || clean(job.locationName);
        const country = normalizeCountry(primaryAddress?.addressCountry || job.country || countryFromLocation(location));
        const applyUrl = clean(job.applyUrl) || clean(job.jobUrl) || clean(job.url);
        return {
          external_id: String(job.id || job.jobPostingId || job.jobUrl || `${job.title}|${location || ''}`),
          source: 'ashby',
          title: job.title,
          department: clean(job.department) || clean(job.team),
          location,
          city: clean(primaryAddress?.addressLocality) || splitCity(location),
          state: clean(primaryAddress?.addressRegion) || splitState(location),
          country,
          lat: toNumber(primaryAddress?.latitude || job.latitude),
          lng: toNumber(primaryAddress?.longitude || job.longitude),
          is_remote: Boolean(job.isRemote) || /\b(remote|virtual)\b/i.test(`${job.title} ${location || ''}`),
          is_overseas: country ? country !== 'US' : false,
          posted_at: normalizeDate(job.publishedAt || job.datePosted || job.createdAt),
          raw_data: {
            ...job,
            normalized_apply_url: applyUrl,
            normalized_employer_source: 'ashby-public-job-board',
          },
        };
      });
  } catch (error) {
    console.error('Ashby fetch error:', error);
    return [];
  }
}

export async function fetchRecruiteeJobs(companySubdomain: string) {
  if (!companySubdomain) return [];
  const subdomain = sanitizeSubdomain(companySubdomain, '.recruitee.com');
  if (!subdomain) return [];
  try {
    const payload = await fetchJson(
      `https://${subdomain}.recruitee.com/api/offers/`,
      { headers: { Accept: 'application/json' } },
      getIngestTimeout(12000),
    );
    const offers = Array.isArray(payload?.offers) ? payload.offers : Array.isArray(payload) ? payload : [];
    return offers
      .filter((offer: any) => offer?.status ? String(offer.status).toLowerCase() === 'published' : true)
      .filter((offer: any) => offer?.title)
      .map((offer: any) => {
        const location = recruiteeLocation(offer);
        const country = normalizeCountry(
          offer?.location?.country_code || offer?.location?.country || offer?.country || countryFromLocation(location),
        );
        const applyUrl = clean(offer.careers_apply_url) || clean(offer.careers_url) || clean(offer.url);
        return {
          external_id: String(offer.id || offer.slug || applyUrl || `${offer.title}|${location || ''}`),
          source: 'recruitee',
          title: offer.title,
          department: clean(offer.department) || clean(offer.department_name),
          location,
          city: clean(offer?.location?.city) || splitCity(location),
          state: clean(offer?.location?.state) || clean(offer?.location?.region) || splitState(location),
          country,
          lat: toNumber(offer?.location?.latitude),
          lng: toNumber(offer?.location?.longitude),
          is_remote: Boolean(offer.remote) || /\b(remote|virtual)\b/i.test(`${offer.title} ${location || ''}`),
          is_overseas: country ? country !== 'US' : false,
          posted_at: normalizeDate(offer.published_at || offer.created_at || offer.updated_at),
          raw_data: {
            ...offer,
            normalized_apply_url: applyUrl,
            normalized_employer_source: 'recruitee-careers-site-api',
          },
        };
      });
  } catch (error) {
    console.error('Recruitee fetch error:', error);
    return [];
  }
}

export async function fetchWorkdayJobs(boardUrl: string) {
  const config = parseWorkdayBoard(boardUrl);
  if (!config) return [];

  const results: any[] = [];
  const limit = 20;
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  try {
    while (offset < total && offset < 1000) {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'OccuMedHiringTrendDashboard/1.0',
        },
        body: JSON.stringify({ appliedFacets: {}, limit, offset, searchText: '' }),
        signal: AbortSignal.timeout(getIngestTimeout(12000)),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json().catch(() => null);
      const rows = Array.isArray(payload?.jobPostings) ? payload.jobPostings : [];
      total = Number(payload?.total || rows.length || 0);
      if (!rows.length) break;
      results.push(...rows.map((job: any) => normalizeWorkdayJob(job, config)));
      offset += rows.length;
      if (rows.length < limit) break;
    }
    return results.filter(job => job.external_id && job.title);
  } catch (error) {
    console.error('Workday fetch error:', error);
    return [];
  }
}

export async function fetchHostedAtsJobs(provider: string, careerPageUrl: string, entityName: string) {
  if (!provider || !careerPageUrl) return [];
  const jobs = await fetchCareerPageJobs(careerPageUrl, entityName);
  return jobs.map(job => ({
    ...job,
    source: `ats:${provider}`,
    raw_data: {
      ...(job.raw_data || {}),
      ats_provider: provider,
      connector_mode: 'first_class_hosted_page',
    },
  }));
}

function normalizeWorkdayJob(job: any, config: WorkdayConfig) {
  const location = clean(job.locationsText) || clean(job.location) || clean(job.primaryLocation);
  const applyUrl = workdayJobUrl(job.externalPath, config);
  const country = normalizeCountry(job.country || countryFromLocation(location));
  const externalId = clean(job.bulletFields?.[0]) || clean(job.jobReqId) || clean(job.id) || clean(job.externalPath) || `${job.title}|${location || ''}`;
  return {
    external_id: String(externalId),
    source: 'workday',
    title: job.title || 'Untitled role',
    department: clean(job.jobFamily) || clean(job.category),
    location,
    city: splitCity(location),
    state: splitState(location),
    country,
    lat: null,
    lng: null,
    is_remote: /\b(remote|virtual|home based|home-based)\b/i.test(`${job.title || ''} ${location || ''}`),
    is_overseas: country ? country !== 'US' : false,
    posted_at: normalizeWorkdayDate(job.postedOn || job.startDate || job.datePosted),
    raw_data: {
      ...job,
      normalized_apply_url: applyUrl,
      workday_tenant: config.tenant,
      workday_site: config.site,
      normalized_employer_source: 'workday-public-career-site',
    },
  };
}

type WorkdayConfig = {
  origin: string;
  tenant: string;
  site: string;
  languagePrefix: string;
  endpoint: string;
};

function parseWorkdayBoard(value: string): WorkdayConfig | null {
  try {
    const url = new URL(value);
    if (!/(?:myworkdayjobs|myworkdaysite|workdayjobs)\.com$/i.test(url.hostname)) return null;
    const tenant = url.hostname.split('.')[0];
    const parts = url.pathname.split('/').filter(Boolean);
    const languagePrefix = parts[0]?.match(/^[a-z]{2}-[A-Z]{2}$/) ? `/${parts.shift()}` : '';
    const site = parts[0];
    if (!tenant || !site) return null;
    const origin = url.origin;
    return {
      origin,
      tenant,
      site,
      languagePrefix,
      endpoint: `${origin}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/jobs`,
    };
  } catch {
    return null;
  }
}

function workdayJobUrl(externalPath: unknown, config: WorkdayConfig) {
  const path = clean(externalPath);
  if (!path) return null;
  try {
    return new URL(`${config.languagePrefix}/${config.site}${path.startsWith('/') ? path : `/${path}`}`, config.origin).toString();
  } catch {
    return null;
  }
}

function recruiteeLocation(offer: any) {
  if (typeof offer?.location === 'string') return clean(offer.location);
  const location = offer?.location || {};
  const parts = [location.city, location.state || location.region, location.country || location.country_code].filter(Boolean).map(String);
  if (parts.length) return parts.join(', ');
  const locations = Array.isArray(offer?.locations) ? offer.locations : [];
  if (locations.length) {
    return locations.map((entry: any) => typeof entry === 'string' ? entry : [entry.city, entry.state || entry.region, entry.country].filter(Boolean).join(', ')).filter(Boolean).join(' / ');
  }
  return null;
}

function firstSecondaryAddress(value: unknown) {
  const entries = Array.isArray(value) ? value : [];
  return entries.find((entry: any) => entry?.address)?.address || null;
}

function addressToLocation(address: any) {
  if (!address) return null;
  const parts = [address.addressLocality, address.addressRegion, address.addressCountry].filter(Boolean).map(String);
  return parts.length ? parts.join(', ') : null;
}

function splitCity(location?: string | null) {
  if (!location || /^remote$/i.test(location)) return null;
  return location.split(',')[0]?.trim() || null;
}

function splitState(location?: string | null) {
  if (!location || /^remote$/i.test(location)) return null;
  return location.split(',')[1]?.trim() || null;
}

function normalizeCountry(value: unknown): string | null {
  const raw = clean(value);
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  const countries: Record<string, string> = {
    us: 'US', usa: 'US', 'united states': 'US', 'united states of america': 'US',
    ca: 'CA', canada: 'CA',
    gb: 'GB', uk: 'GB', 'united kingdom': 'GB', 'great britain': 'GB', england: 'GB',
    de: 'DE', germany: 'DE', kw: 'KW', kuwait: 'KW', qa: 'QA', qatar: 'QA',
    bh: 'BH', bahrain: 'BH', iq: 'IQ', iraq: 'IQ', pl: 'PL', poland: 'PL',
    au: 'AU', australia: 'AU', jp: 'JP', japan: 'JP', kr: 'KR', 'south korea': 'KR', korea: 'KR',
    mx: 'MX', mexico: 'MX', es: 'ES', spain: 'ES', it: 'IT', italy: 'IT', gr: 'GR', greece: 'GR',
    fr: 'FR', france: 'FR', nl: 'NL', netherlands: 'NL', be: 'BE', belgium: 'BE',
    ae: 'AE', 'united arab emirates': 'AE', uae: 'AE', sa: 'SA', 'saudi arabia': 'SA',
  };
  if (countries[normalized]) return countries[normalized];
  if (/^[a-z]{2}$/i.test(raw)) return raw.toUpperCase();
  return null;
}

function countryFromLocation(value?: string | null) {
  if (!value) return null;
  const entries: Array<[RegExp, string]> = [
    [/\b(?:united states|usa|u\.s\.)\b/i, 'US'], [/\bcanada\b/i, 'CA'],
    [/\b(?:united kingdom|great britain|uk)\b/i, 'GB'], [/\bgermany\b/i, 'DE'],
    [/\bkuwait\b/i, 'KW'], [/\bqatar\b/i, 'QA'], [/\bbahrain\b/i, 'BH'], [/\biraq\b/i, 'IQ'],
    [/\bpoland\b/i, 'PL'], [/\baustralia\b/i, 'AU'], [/\bjapan\b/i, 'JP'], [/\b(?:south korea|korea)\b/i, 'KR'],
    [/\bmexico\b/i, 'MX'], [/\bspain\b/i, 'ES'], [/\bitaly\b/i, 'IT'], [/\bgreece\b/i, 'GR'],
    [/\bfrance\b/i, 'FR'], [/\bnetherlands\b/i, 'NL'], [/\bbelgium\b/i, 'BE'],
    [/\b(?:united arab emirates|uae)\b/i, 'AE'], [/\bsaudi arabia\b/i, 'SA'],
  ];
  for (const [pattern, code] of entries) if (pattern.test(value)) return code;
  if (/\b[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}\b/.test(value)) return 'US';
  return null;
}

function sanitizeSubdomain(value: string, suffix: string) {
  return String(value || '').trim().replace(/^https?:\/\//i, '').replace(new RegExp(`${escapeRegExp(suffix)}.*$`, 'i'), '').replace(/[^a-z0-9-]/gi, '');
}

function normalizeDate(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeWorkdayDate(value: unknown) {
  const raw = clean(value);
  if (!raw) return null;
  const relative = raw.match(/posted\s+(today|yesterday|\d+\+?\s+days?\s+ago)/i);
  if (relative) {
    const now = new Date();
    const token = relative[1].toLowerCase();
    if (token === 'today') return now.toISOString();
    if (token === 'yesterday') return new Date(now.getTime() - 86400000).toISOString();
    const days = Number(token.match(/\d+/)?.[0] || 0);
    if (days > 0) return new Date(now.getTime() - Math.min(days, 3650) * 86400000).toISOString();
  }
  return normalizeDate(raw);
}

function toNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clean(value: unknown) {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}