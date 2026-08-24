import { query } from '@/db/client';
import { syncEntityToAlgolia } from '@/lib/search/algolia';
import { monitorsForEntity } from './theirStackMonitors';
import { upsertIngestedJob } from './upsertJob';
import { persistSourceCoverage } from './sourceCoverage';
import { buildHiringSnapshot } from './buildSnapshot';

const COMPANY_SEARCH_URL = 'https://api.theirstack.com/v1/companies/search';
const CREDIT_BALANCE_URL = 'https://api.theirstack.com/v0/billing/credit-balance';
const SOURCE = 'theirstack_company';
const LOOKBACK_DAYS = clamp(integerEnv('THEIRSTACK_COMPANY_SWEEP_LOOKBACK_DAYS', 30), 1, 90);
const CREDIT_RESERVE = clamp(integerEnv('THEIRSTACK_API_CREDIT_RESERVE', 20), 0, 199);
const TIMEOUT_MS = clamp(integerEnv('THEIRSTACK_TIMEOUT_MS', 15000), 1000, 60000);
const COMPANY_CREDIT_COST = 3;

type EntityRow = { id: string; name: string; aliases?: string[] | null };

export async function refreshTheirStackForEntity(entityId: string) {
  const rows = await query(`SELECT id, name, aliases FROM entities WHERE id = $1 AND is_active = true LIMIT 1`, [entityId]) as EntityRow[];
  const entity = rows[0];
  if (!entity) return { status: 'skipped', imported_jobs: 0, signal_jobs: 0, reason: 'Entity not found or inactive' };

  const monitors = monitorsForEntity(entity);
  if (!monitors.length) return { status: 'skipped', imported_jobs: 0, signal_jobs: 0, reason: 'Entity is not assigned to a TheirStack monitor workspace' };

  const workspaceResults: any[] = [];
  let importedJobs = 0;
  let signalJobs = 0;
  let duplicateSkipped = 0;
  let anySuccess = false;

  for (const monitor of monitors) {
    const apiKey = String(process.env[monitor.envKey] || '').trim();
    if (!apiKey) {
      workspaceResults.push({ env_key: monitor.envKey, status: 'skipped', reason: 'API key missing' });
      continue;
    }

    try {
      const credits = await fetchCreditBalance(apiKey);
      if (credits < COMPANY_CREDIT_COST + CREDIT_RESERVE) {
        const reason = `credit guard: ${credits} remaining, requires ${COMPANY_CREDIT_COST} + ${CREDIT_RESERVE} reserve`;
        workspaceResults.push({ env_key: monitor.envKey, status: 'skipped', reason, credits });
        continue;
      }

      const payload = await requestJson(COMPANY_SEARCH_URL, apiKey, {
        company_name_or: [monitor.name],
        company_name_case_insensitive_or: [monitor.name],
        job_filters: { posted_at_max_age_days: LOOKBACK_DAYS },
        min_num_jobs_found: 1,
        limit: 5,
        page: 0,
      });
      const companies = Array.isArray(payload?.data) ? payload.data : [];
      const company = findCompany(companies, monitor.name);
      const sample = Array.isArray(company?.jobs_found) ? company.jobs_found : [];
      const volume = Math.max(0, Number(company?.num_jobs_found || 0));
      signalJobs += volume;

      let workspaceImported = 0;
      let workspaceDuplicates = 0;
      for (const row of sample) {
        const job = normalizeCompanyJob(row, company, monitor.envKey);
        if (!job) continue;
        if (job.raw_data.normalized_apply_url && await hasExistingActiveUrl(entity.id, job.raw_data.normalized_apply_url)) {
          workspaceDuplicates++;
          duplicateSkipped++;
          continue;
        }
        if (await upsertIngestedJob(entity, job)) workspaceImported++;
      }
      importedJobs += workspaceImported;
      anySuccess = true;

      await persistSourceCoverage(entity.id, [{
        source: SOURCE,
        source_class: 'supplemental',
        status: sample.length ? 'success' : 'zero',
        jobs_found: sample.length,
        authoritative_zero: false,
        details: {
          lineage_root: 'theirstack',
          source_key: `${SOURCE}:${monitor.envKey}`,
          key_slot: monitor.envKey,
          monitored_name: monitor.name,
          lookback_days: LOOKBACK_DAYS,
          num_jobs_found: volume,
          sample_jobs_returned: sample.length,
          partial_signal: volume > sample.length,
          refresh_mode: 'entity_profile_company_search',
          company_search_cost_model: '3 API credits per returned company',
        },
      }]);

      workspaceResults.push({
        env_key: monitor.envKey,
        status: 'success',
        signal_jobs: volume,
        sample_jobs: sample.length,
        imported_jobs: workspaceImported,
        duplicate_skipped: workspaceDuplicates,
      });
    } catch (error) {
      const reason = errorMessage(error);
      workspaceResults.push({ env_key: monitor.envKey, status: 'error', reason });
      await persistSourceCoverage(entity.id, [{
        source: SOURCE,
        source_class: 'supplemental',
        status: 'error',
        jobs_found: 0,
        authoritative_zero: false,
        details: { lineage_root: 'theirstack', key_slot: monitor.envKey, monitored_name: monitor.name, reason, refresh_mode: 'entity_profile_company_search' },
      }]).catch(() => {});
    }
  }

  if (anySuccess) {
    await buildHiringSnapshot(entity.id);
    const algolia = await syncEntityToAlgolia(entity.id);
    return { status: 'success', imported_jobs: importedJobs, signal_jobs: signalJobs, duplicate_skipped: duplicateSkipped, workspaces: workspaceResults, algolia };
  }

  return {
    status: workspaceResults.some(row => row.status === 'error') ? 'error' : 'skipped',
    imported_jobs: importedJobs,
    signal_jobs: signalJobs,
    duplicate_skipped: duplicateSkipped,
    workspaces: workspaceResults,
    reason: workspaceResults.map(row => row.reason).filter(Boolean).join(' | ') || 'No TheirStack workspace could run',
  };
}

async function fetchCreditBalance(apiKey: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(CREDIT_BALANCE_URL, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.description || payload?.error?.title || `credit balance HTTP ${response.status}`);
    return Math.max(0, Number(payload?.api_credits || 0));
  } catch (error) {
    if ((error as any)?.name === 'AbortError') throw new Error(`TheirStack credit balance timeout after ${TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestJson(url: string, apiKey: string, body: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.description || payload?.error?.title || `HTTP ${response.status}`);
    return payload;
  } catch (error) {
    if ((error as any)?.name === 'AbortError') throw new Error(`TheirStack company search timeout after ${TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function findCompany(companies: any[], name: string) {
  const target = normalizeName(name);
  return companies.find(company => normalizeName(company?.name) === target) || companies[0] || null;
}

function normalizeCompanyJob(row: any, company: any, envKey: string) {
  const id = row?.id ?? row?.job_id;
  const title = clean(row?.job_title || row?.title || row?.normalized_title);
  const applyUrl = normalizeUrl(row?.final_url || row?.url || row?.source_url || row?.apply_url);
  if (id == null || !title || !applyUrl) return null;
  const locationObject = Array.isArray(row?.locations) && row.locations.length ? row.locations[0] : null;
  const country = clean(row?.country_code || locationObject?.country_code || company?.country_code);
  const state = clean(row?.state_code || locationObject?.state_code || locationObject?.state);
  const city = clean(locationObject?.name || (Array.isArray(row?.cities) ? row.cities[0] : null));
  const employer = clean(company?.name) || 'Unknown';

  return {
    external_id: `theirstack-company-${String(id)}`,
    source: SOURCE,
    title,
    department: employer,
    location: clean(row?.long_location || row?.short_location || row?.location || locationObject?.display_name),
    city,
    state,
    country,
    lat: numberOrNull(row?.latitude ?? locationObject?.latitude),
    lng: numberOrNull(row?.longitude ?? locationObject?.longitude),
    is_remote: Boolean(row?.remote),
    is_overseas: country ? country.toUpperCase() !== 'US' : false,
    posted_at: normalizeDate(row?.date_reposted || row?.date_posted || row?.discovered_at || row?.posted_at),
    raw_data: {
      ...row,
      normalized_employer: employer,
      normalized_apply_url: applyUrl,
      employer_name: employer,
      company_name: employer,
      theirstack_company_id: company?.id || row?.company_object?.id || null,
      theirstack_job_id: id,
      theirstack_key_slot: envKey,
      theirstack_delivery: 'entity_profile_company_search_last_5_signal',
      theirstack_num_jobs_found: Math.max(0, Number(company?.num_jobs_found || 0)),
      source_graph_lineage: 'theirstack',
      source_graph_class: 'supplemental',
    },
  };
}

async function hasExistingActiveUrl(entityId: string, normalizedUrl: string) {
  const rows = await query(
    `SELECT 1 FROM jobs
     WHERE entity_id = $1 AND is_active = true AND source <> $2
       AND NULLIF(raw_data->>'normalized_apply_url', '') = $3
     LIMIT 1`,
    [entityId, SOURCE, normalizedUrl],
  );
  return rows.length > 0;
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

function normalizeName(value: unknown) {
  return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
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
