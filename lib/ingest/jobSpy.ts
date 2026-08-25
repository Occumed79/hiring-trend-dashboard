import { createHash } from 'crypto';
import { query } from '@/db/client';

type JobSpySite = 'indeed' | 'linkedin';
type SiteStatus = 'success' | 'zero' | 'error' | 'skipped';

export type JobSpySiteResult = {
  site: JobSpySite;
  source: string;
  attempted: boolean;
  status: SiteStatus;
  jobs_found: number;
  employer_rejected: number;
  elapsed_ms: number;
  reason?: string;
};

export type JobSpyResult = {
  jobs: any[];
  used: string[];
  skipped: string[];
  site_results: JobSpySiteResult[];
  trigger: {
    mode: string;
    run: boolean;
    reason: string;
    active_jobs: number;
    theirstack_signal: number;
  };
};

const ELIGIBLE_PORTALS = new Set(['current_clients', 'prospects', 'private_companies']);
const US_STATE_CODES = new Set('AL AK AZ AR CA CO CT DC DE FL GA HI IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY'.split(' '));
const ENABLED = booleanEnv('JOBSPY_ENABLED', true);
const MODE = readMode(process.env.JOBSPY_MODE || 'gap');
const SITES = readSites(process.env.JOBSPY_SITES || 'indeed,linkedin');
const HOURS_OLD = clamp(integerEnv('JOBSPY_HOURS_OLD', 240), 1, 720);
const RESULTS_WANTED = clamp(integerEnv('JOBSPY_RESULTS_WANTED', 75), 5, 200);
const INTERVAL_HOURS = clamp(integerEnv('JOBSPY_INTERVAL_HOURS', 24), 1, 168);
const ERROR_RETRY_HOURS = clamp(integerEnv('JOBSPY_ERROR_RETRY_HOURS', 6), 1, 48);
const SITE_TIMEOUT_MS = clamp(integerEnv('JOBSPY_SITE_TIMEOUT_MS', 25000), 5000, 60000);
const GAP_RATIO = clamp(numberEnv('JOBSPY_GAP_RATIO', 1.25), 1.05, 10);
const MIN_ACTIVE_JOBS = clamp(integerEnv('JOBSPY_MIN_ACTIVE_JOBS', 25), 0, 5000);
const INDEED_COUNTRY = String(process.env.JOBSPY_INDEED_COUNTRY || 'USA').trim() || 'USA';
const LINKEDIN_FETCH_DESCRIPTION = booleanEnv('JOBSPY_LINKEDIN_FETCH_DESCRIPTION', false);

// A process-local backoff prevents repeated requests to a board after an explicit
// rate-limit/forbidden response. Persisted source coverage provides retry cadence
// across restarts. We do not attempt to bypass board access controls.
const backoffUntil = new Map<JobSpySite, number>();

export async function fetchJobSpyJobs(entity: any): Promise<JobSpyResult> {
  const trigger = await evaluateTrigger(entity);
  const base: JobSpyResult = { jobs: [], used: [], skipped: [], site_results: [], trigger };

  if (!ENABLED || MODE === 'off') {
    base.skipped.push('jobspy: disabled');
    return base;
  }
  if (!ELIGIBLE_PORTALS.has(String(entity?.portal || ''))) {
    base.skipped.push(`jobspy: portal ${String(entity?.portal || 'unknown')} is not targeted`);
    return base;
  }
  if (!trigger.run) {
    base.skipped.push(`jobspy: ${trigger.reason}`);
    return base;
  }

  let scrapeJobs: ((options?: Record<string, any>) => Promise<any[]>);
  try {
    const module = await import('ts-jobspy');
    scrapeJobs = module.scrapeJobs as typeof scrapeJobs;
  } catch (error) {
    base.skipped.push(`jobspy: module unavailable: ${errorMessage(error)}`);
    return base;
  }

  for (const site of SITES) {
    const source = `jobspy:${site}`;
    const cadence = await shouldRunSite(entity.id, source);
    if (!cadence.run) {
      base.skipped.push(`${source}: ${cadence.reason}`);
      base.site_results.push({ site, source, attempted: false, status: 'skipped', jobs_found: 0, employer_rejected: 0, elapsed_ms: 0, reason: cadence.reason });
      continue;
    }

    const blockedUntil = backoffUntil.get(site) || 0;
    if (blockedUntil > Date.now()) {
      const minutes = Math.max(1, Math.ceil((blockedUntil - Date.now()) / 60000));
      const reason = `respecting prior board backoff for about ${minutes} more minute${minutes === 1 ? '' : 's'}`;
      base.skipped.push(`${source}: ${reason}`);
      base.site_results.push({ site, source, attempted: false, status: 'skipped', jobs_found: 0, employer_rejected: 0, elapsed_ms: 0, reason });
      continue;
    }

    const started = Date.now();
    try {
      // Run each board independently. One board failing or rate-limiting cannot
      // discard a successful result set from the other board.
      const rows = await withTimeout(
        scrapeJobs({
          siteName: site,
          searchTerm: quotedEmployerSearch(entity.name),
          resultsWanted: RESULTS_WANTED,
          hoursOld: HOURS_OLD,
          countryIndeed: INDEED_COUNTRY,
          linkedinFetchDescription: site === 'linkedin' ? LINKEDIN_FETCH_DESCRIPTION : false,
          descriptionFormat: 'markdown',
          verbose: 0,
        }),
        SITE_TIMEOUT_MS,
        `${source} timed out after ${SITE_TIMEOUT_MS}ms`,
      );

      let employerRejected = 0;
      const accepted: any[] = [];
      for (const row of Array.isArray(rows) ? rows : []) {
        const match = employerMatch(row?.company, entity);
        if (!match) {
          employerRejected++;
          continue;
        }
        const normalized = normalizeJobSpyJob(row, site, entity, match);
        if (normalized) accepted.push(normalized);
      }

      base.jobs.push(...accepted);
      base.used.push(source);
      base.site_results.push({
        site,
        source,
        attempted: true,
        status: accepted.length ? 'success' : 'zero',
        jobs_found: accepted.length,
        employer_rejected: employerRejected,
        elapsed_ms: Date.now() - started,
        reason: accepted.length ? undefined : `JobSpy returned no verified ${entity.name} jobs after employer matching`,
      });
    } catch (error) {
      const reason = errorMessage(error);
      if (isRateLimitOrForbidden(reason)) backoffUntil.set(site, Date.now() + ERROR_RETRY_HOURS * 3600000);
      base.skipped.push(`${source}: ${reason}`);
      base.site_results.push({
        site,
        source,
        attempted: true,
        status: 'error',
        jobs_found: 0,
        employer_rejected: 0,
        elapsed_ms: Date.now() - started,
        reason,
      });
    }
  }

  return base;
}

async function evaluateTrigger(entity: any) {
  const activeRows = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM jobs WHERE entity_id=$1 AND is_active=true) AS active_jobs,
       (SELECT COALESCE(MAX(jobs_found),0)::int
          FROM entity_source_coverage
         WHERE entity_id=$1 AND source LIKE 'theirstack_company:%' AND status='success') AS theirstack_signal`,
    [entity.id],
  ).catch(() => [{ active_jobs: 0, theirstack_signal: 0 }]);

  const activeJobs = Math.max(0, Number(activeRows[0]?.active_jobs || 0));
  const theirStackSignal = Math.max(0, Number(activeRows[0]?.theirstack_signal || 0));
  if (MODE === 'always') return { mode: MODE, run: true, reason: 'always mode', active_jobs: activeJobs, theirstack_signal: theirStackSignal };
  if (MODE === 'off') return { mode: MODE, run: false, reason: 'off mode', active_jobs: activeJobs, theirstack_signal: theirStackSignal };
  if (activeJobs < MIN_ACTIVE_JOBS) {
    return { mode: MODE, run: true, reason: `only ${activeJobs} active jobs are stored`, active_jobs: activeJobs, theirstack_signal: theirStackSignal };
  }
  if (theirStackSignal > activeJobs && theirStackSignal >= Math.ceil(activeJobs * GAP_RATIO)) {
    return {
      mode: MODE,
      run: true,
      reason: `TheirStack signals ${theirStackSignal} recent jobs versus ${activeJobs} stored active jobs`,
      active_jobs: activeJobs,
      theirstack_signal: theirStackSignal,
    };
  }
  return {
    mode: MODE,
    run: false,
    reason: theirStackSignal
      ? `no material inventory gap (${theirStackSignal} TheirStack signal vs ${activeJobs} stored)`
      : `stored inventory is above the ${MIN_ACTIVE_JOBS}-job fallback threshold and no TheirStack gap signal is present`,
    active_jobs: activeJobs,
    theirstack_signal: theirStackSignal,
  };
}

async function shouldRunSite(entityId: string, source: string) {
  const rows = await query(
    `SELECT status, last_checked_at
       FROM entity_source_coverage
      WHERE entity_id=$1 AND source=$2
      LIMIT 1`,
    [entityId, source],
  ).catch(() => []);
  const row = rows[0];
  if (!row?.last_checked_at) return { run: true, reason: 'never checked' };
  const checkedAt = new Date(row.last_checked_at).getTime();
  if (!Number.isFinite(checkedAt)) return { run: true, reason: 'invalid prior check timestamp' };
  const interval = String(row.status || '') === 'error' ? ERROR_RETRY_HOURS : INTERVAL_HOURS;
  const next = checkedAt + interval * 3600000;
  if (Date.now() >= next) return { run: true, reason: `${interval}h cadence due` };
  const hours = Math.max(1, Math.ceil((next - Date.now()) / 3600000));
  return { run: false, reason: `next check in about ${hours}h` };
}

function normalizeJobSpyJob(row: any, site: JobSpySite, entity: any, employerEvidence: string) {
  const title = clean(row?.title);
  const boardUrl = normalizeUrl(row?.jobUrl);
  const directUrl = normalizeUrl(row?.jobUrlDirect);
  const applyUrl = directUrl || boardUrl;
  if (!title || !applyUrl) return null;

  const location = clean(row?.location);
  const parsedLocation = parseLocation(location);
  const stableId = clean(row?.id) || createHash('sha256')
    .update([site, applyUrl, title, clean(row?.company), location].filter(Boolean).join('|'))
    .digest('hex')
    .slice(0, 32);
  const source = `jobspy:${site}`;

  return {
    external_id: `jobspy-${site}-${stableId}`,
    source,
    title,
    department: clean(row?.company) || entity.name,
    location,
    city: parsedLocation.city,
    state: parsedLocation.state,
    country: parsedLocation.country,
    lat: null,
    lng: null,
    is_remote: Boolean(row?.isRemote),
    is_overseas: parsedLocation.country ? parsedLocation.country !== 'US' : false,
    posted_at: normalizeDate(row?.datePosted),
    raw_data: {
      jobspy_site: site,
      jobspy_id: clean(row?.id),
      jobspy_board_url: boardUrl,
      jobspy_direct_url: directUrl,
      jobspy_search_hours: HOURS_OLD,
      jobspy_search_term: entity.name,
      jobspy_employer_match: employerEvidence,
      company_name: clean(row?.company),
      employer_name: clean(row?.company),
      normalized_employer: entity.name,
      normalized_apply_url: applyUrl,
      job_type: clean(row?.jobType),
      company_industry: clean(row?.companyIndustry),
      description: truncate(clean(row?.description), 12000),
      salary: row?.minAmount || row?.maxAmount ? {
        interval: clean(row?.interval),
        min: numberOrNull(row?.minAmount),
        max: numberOrNull(row?.maxAmount),
        currency: clean(row?.currency),
        source: clean(row?.salarySource),
      } : null,
      source_graph_lineage: source,
      source_graph_class: 'supplemental',
      jobspy_native_node: true,
    },
  };
}

function employerMatch(company: unknown, entity: any): string | null {
  const candidate = normalizeCompanyIdentity(company);
  if (!candidate) return null;
  const names = [entity?.name, ...(Array.isArray(entity?.aliases) ? entity.aliases : [])]
    .map(normalizeCompanyIdentity)
    .filter(Boolean);
  for (const name of names) {
    if (candidate === name) return `exact:${name}`;
    if (name.length >= 4 && candidate.startsWith(`${name} `)) return `company-prefix:${name}`;
    if (candidate.length >= 4 && name.startsWith(`${candidate} `)) return `alias-prefix:${name}`;
  }
  return null;
}

function parseLocation(value: string | null) {
  if (!value || /^remote$/i.test(value)) return { city: null, state: null, country: null };
  const parts = value.split(',').map(part => part.trim()).filter(Boolean);
  let country = normalizeCountry(parts[parts.length - 1]);
  let state: string | null = null;
  let city: string | null = parts[0] || null;
  const stateCandidate = parts.length >= 2 ? parts[parts.length - (country ? 2 : 1)] : null;
  if (stateCandidate && /^[A-Za-z]{2}$/.test(stateCandidate) && US_STATE_CODES.has(stateCandidate.toUpperCase())) {
    state = stateCandidate.toUpperCase();
    country = 'US';
  }
  if (parts.length === 1 && state) city = null;
  return { city, state, country };
}

function normalizeCountry(value: unknown) {
  const text = String(value || '').trim().toLowerCase();
  const map: Record<string, string> = {
    us: 'US', usa: 'US', 'united states': 'US', 'united states of america': 'US',
    ca: 'CA', canada: 'CA', gb: 'GB', uk: 'GB', 'united kingdom': 'GB',
    de: 'DE', germany: 'DE', kw: 'KW', kuwait: 'KW', qa: 'QA', qatar: 'QA',
    bh: 'BH', bahrain: 'BH', iq: 'IQ', iraq: 'IQ', pl: 'PL', poland: 'PL',
    au: 'AU', australia: 'AU', jp: 'JP', japan: 'JP', kr: 'KR', 'south korea': 'KR',
    mx: 'MX', mexico: 'MX', ae: 'AE', uae: 'AE', 'united arab emirates': 'AE',
    sa: 'SA', 'saudi arabia': 'SA', es: 'ES', spain: 'ES', fr: 'FR', france: 'FR',
  };
  if (map[text]) return map[text];
  return /^[a-z]{2}$/i.test(text) ? text.toUpperCase() : null;
}

function quotedEmployerSearch(value: unknown) {
  const text = String(value || '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
  return text ? `"${text}"` : '';
}

function normalizeCompanyIdentity(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:incorporated|inc|corporation|corp|company|co|limited|ltd|llc|plc|holdings?|group)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUrl(value: unknown) {
  if (!value) return null;
  try {
    const url = new URL(String(value).trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    for (const key of Array.from(url.searchParams.keys())) {
      if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
    }
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

function isRateLimitOrForbidden(message: string) {
  return /\b429\b|rate.?limit|too many requests|\b403\b|forbidden/i.test(message);
}
function readMode(value: string) { const mode = String(value || '').trim().toLowerCase(); return ['off', 'always', 'gap'].includes(mode) ? mode : 'gap'; }
function readSites(value: string): JobSpySite[] {
  const allowed = new Set<JobSpySite>(['indeed', 'linkedin']);
  const rows = csv(value).map(site => site.toLowerCase()).filter((site): site is JobSpySite => allowed.has(site as JobSpySite));
  return rows.length ? Array.from(new Set(rows)) : ['indeed', 'linkedin'];
}
function csv(value: string) { return String(value || '').split(',').map(item => item.trim()).filter(Boolean); }
function booleanEnv(name: string, fallback: boolean) { const value = String(process.env[name] || '').trim().toLowerCase(); if (!value) return fallback; return ['1', 'true', 'yes', 'on'].includes(value); }
function integerEnv(name: string, fallback: number) { const value = Number(process.env[name]); return Number.isInteger(value) ? value : fallback; }
function numberEnv(name: string, fallback: number) { const value = Number(process.env[name]); return Number.isFinite(value) ? value : fallback; }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function clean(value: unknown) { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text || null; }
function truncate(value: string | null, max: number) { return value && value.length > max ? `${value.slice(0, max)}…` : value; }
function numberOrNull(value: unknown) { if (value === null || value === undefined || value === '') return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
