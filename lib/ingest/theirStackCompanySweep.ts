import { query } from '@/db/client';
import { upsertIngestedJob } from './upsertJob';
import { persistSourceCoverage } from './sourceCoverage';
import { buildHiringSnapshot } from './buildSnapshot';
import { syncEntityToAlgolia } from '@/lib/search/algolia';
import { loadTheirStackMonitors, type TheirStackEnvKey, type TheirStackMonitor } from './theirStackMonitors';

const COMPANY_SEARCH_URL = 'https://api.theirstack.com/v1/companies/search';
const CREDIT_BALANCE_URL = 'https://api.theirstack.com/v0/billing/credit-balance';
const SOURCE = 'theirstack_company';
const COMPANY_CREDIT_COST = 3;
const PAGE_SIZE = 25;
const TIMEOUT_MS = clamp(integerEnv('THEIRSTACK_TIMEOUT_MS', 15000), 1000, 60000);
const LOOKBACK_DAYS = clamp(integerEnv('THEIRSTACK_COMPANY_SWEEP_LOOKBACK_DAYS', 30), 1, 90);
const INTERVAL_DAYS = clamp(integerEnv('THEIRSTACK_COMPANY_SWEEP_INTERVAL_DAYS', 14), 1, 31);
const CREDIT_RESERVE = clamp(integerEnv('THEIRSTACK_API_CREDIT_RESERVE', 20), 0, 199);
const LEGACY_JOB_SEARCH_ENABLED = booleanEnv('THEIRSTACK_LEGACY_JOB_SEARCH_ENABLED', false);

type EntityRow = { id: string; name: string; aliases?: string[] | null };
type CreditBalance = { api_credits: number; used_api_credits: number | null };

type WorkspaceResult = {
  env_key: TheirStackEnvKey;
  status: 'success' | 'skipped' | 'error';
  monitored_companies: number;
  returned_companies: number;
  signal_jobs: number;
  imported_jobs: number;
  duplicate_skipped: number;
  unmatched_companies: number;
  credits_before: number | null;
  credits_after: number | null;
  credits_used: number | null;
  reason?: string;
  high_volume_companies: Array<{ name: string; num_jobs_found: number; sample_jobs_returned: number }>;
};

export async function runTheirStackCompanySweep(options: { force?: boolean } = {}) {
  await ensureSweepStateTable();
  const entities = await query(`SELECT id, name, aliases FROM entities WHERE is_active = true`) as EntityRow[];
  const entityIndex = buildEntityIndex(entities);
  const runtimeMonitors = await loadTheirStackMonitors();
  const groups = groupByKey(runtimeMonitors);
  const results: WorkspaceResult[] = [];

  for (const [envKey, monitors] of groups) {
    const apiKey = String(process.env[envKey] || '').trim();
    const coverageSource = `${SOURCE}:${envKey}`;
    if (!apiKey) {
      results.push(emptyWorkspace(envKey, monitors.length, 'skipped', 'API key missing'));
      continue;
    }

    try {
      const balanceBefore = await fetchCreditBalance(apiKey);
      const state = await readSweepState(envKey);
      const due = options.force === true || isDue(state?.last_success_at);
      if (!due) {
        results.push({
          ...emptyWorkspace(envKey, monitors.length, 'skipped', `next sweep not due; interval is ${INTERVAL_DAYS} days`),
          credits_before: balanceBefore.api_credits,
        });
        continue;
      }

      const estimatedReturnedCompanies = state?.returned_companies > 0
        ? Math.min(monitors.length, Number(state.returned_companies))
        : monitors.length;
      const estimatedCost = estimatedReturnedCompanies * COMPANY_CREDIT_COST;
      if (balanceBefore.api_credits < estimatedCost + CREDIT_RESERVE) {
        const reason = `credit guard: ${balanceBefore.api_credits} remaining, estimated ${estimatedCost} + ${CREDIT_RESERVE} reserve`;
        await writeSweepState(envKey, 'skipped', 0, 0, balanceBefore.api_credits, balanceBefore.api_credits, reason);
        results.push({ ...emptyWorkspace(envKey, monitors.length, 'skipped', reason), credits_before: balanceBefore.api_credits, credits_after: balanceBefore.api_credits, credits_used: 0 });
        continue;
      }

      const companies = await searchCompanies(apiKey, monitors.map(monitor => monitor.name));
      const balanceAfter = await fetchCreditBalance(apiKey).catch(() => ({ api_credits: Math.max(0, balanceBefore.api_credits - companies.length * COMPANY_CREDIT_COST), used_api_credits: null }));
      const creditsUsed = Math.max(0, balanceBefore.api_credits - balanceAfter.api_credits) || companies.length * COMPANY_CREDIT_COST;

      let importedJobs = 0;
      let duplicateSkipped = 0;
      let unmatchedCompanies = 0;
      let signalJobs = 0;
      const affected = new Map<string, EntityRow>();
      const returnedNames = new Set<string>();
      const highVolumeCompanies: WorkspaceResult['high_volume_companies'] = [];

      for (const company of companies) {
        const companyName = clean(company?.name);
        if (!companyName) continue;
        returnedNames.add(normalizeName(companyName));
        const entity = entityIndex.get(normalizeName(companyName));
        if (!entity) {
          unmatchedCompanies++;
          continue;
        }

        const jobs = Array.isArray(company?.jobs_found) ? company.jobs_found : [];
        const numJobsFound = Math.max(0, Number(company?.num_jobs_found || 0));
        signalJobs += numJobsFound;
        if (numJobsFound > jobs.length) {
          highVolumeCompanies.push({ name: companyName, num_jobs_found: numJobsFound, sample_jobs_returned: jobs.length });
        }

        for (const row of jobs) {
          const job = normalizeCompanySearchJob(row, company, envKey);
          if (!job) continue;
          if (job.raw_data?.normalized_apply_url && await hasExistingActiveUrl(entity.id, job.raw_data.normalized_apply_url)) {
            duplicateSkipped++;
            continue;
          }
          await upsertIngestedJob(entity, job);
          importedJobs++;
          affected.set(entity.id, entity);
        }

        await persistSourceCoverage(entity.id, [{
          source: coverageSource,
          source_class: 'supplemental',
          status: jobs.length || numJobsFound ? 'success' : 'zero',
          jobs_found: Math.max(jobs.length, numJobsFound),
          authoritative_zero: false,
          details: {
            lineage_root: 'theirstack',
            source_key: coverageSource,
            key_slot: envKey,
            live_monitor_source: monitors.find(m => normalizeName(m.name) === normalizeName(companyName))?.source || 'config_fallback',
            monitor_list_id: monitors.find(m => normalizeName(m.name) === normalizeName(companyName))?.listId || null,
            monitor_list_name: monitors.find(m => normalizeName(m.name) === normalizeName(companyName))?.listName || null,
            lookback_days: LOOKBACK_DAYS,
            num_jobs_found: numJobsFound,
            sample_jobs_returned: jobs.length,
            partial_signal: numJobsFound > jobs.length,
            company_search_cost_model: '3 API credits per returned company',
          },
        }]);
      }

      for (const monitor of monitors) {
        if (returnedNames.has(normalizeName(monitor.name))) continue;
        const entity = entityIndex.get(normalizeName(monitor.name));
        if (!entity) continue;
        await persistSourceCoverage(entity.id, [{
          source: coverageSource,
          source_class: 'supplemental',
          status: 'zero',
          jobs_found: 0,
          authoritative_zero: false,
          details: {
            lineage_root: 'theirstack',
            source_key: coverageSource,
            key_slot: envKey,
            live_monitor_source: monitor.source || 'config_fallback',
            monitor_list_id: monitor.listId || null,
            monitor_list_name: monitor.listName || null,
            lookback_days: LOOKBACK_DAYS,
            note: 'No exact monitored company with >=1 matching recent job was returned by Company Search.',
          },
        }]);
      }

      for (const entity of Array.from(affected.values())) {
        await buildHiringSnapshot(entity.id);
        const algolia = await syncEntityToAlgolia(entity.id);
        if (algolia.status === 'error') console.warn(`Algolia sync failed after TheirStack company sweep for ${entity.name}: ${algolia.reason}`);
      }

      await writeSweepState(envKey, 'success', companies.length, signalJobs, balanceBefore.api_credits, balanceAfter.api_credits, null);
      results.push({
        env_key: envKey,
        status: 'success',
        monitored_companies: monitors.length,
        returned_companies: companies.length,
        signal_jobs: signalJobs,
        imported_jobs: importedJobs,
        duplicate_skipped: duplicateSkipped,
        unmatched_companies: unmatchedCompanies,
        credits_before: balanceBefore.api_credits,
        credits_after: balanceAfter.api_credits,
        credits_used: creditsUsed,
        high_volume_companies: highVolumeCompanies.sort((a, b) => b.num_jobs_found - a.num_jobs_found).slice(0, 25),
      });
    } catch (error) {
      const reason = errorMessage(error);
      await writeSweepState(envKey, 'error', 0, 0, null, null, reason).catch(() => {});
      results.push(emptyWorkspace(envKey, monitors.length, 'error', reason));
    }
  }

  return {
    strategy: 'company_search_signal',
    monitor_source: runtimeMonitors.some(row => row.source === 'live_list') ? 'live_saved_lists' : 'config_fallback',
    source: SOURCE,
    lookback_days: LOOKBACK_DAYS,
    interval_days: INTERVAL_DAYS,
    credit_reserve: CREDIT_RESERVE,
    legacy_full_job_search_enabled: LEGACY_JOB_SEARCH_ENABLED,
    note: 'TheirStack Company Search returns only the last 5 matching jobs per company. num_jobs_found is retained as a volume signal; capped company-credit Job Export remains the bulk fallback.',
    workspaces: results,
    totals: {
      returned_companies: results.reduce((sum, row) => sum + row.returned_companies, 0),
      signal_jobs: results.reduce((sum, row) => sum + row.signal_jobs, 0),
      imported_jobs: results.reduce((sum, row) => sum + row.imported_jobs, 0),
      credits_used: results.reduce((sum, row) => sum + (row.credits_used || 0), 0),
    },
  };
}

async function searchCompanies(apiKey: string, names: string[]) {
  const companies: any[] = [];
  for (let page = 0; page < 10; page++) {
    const payload = await requestJson(COMPANY_SEARCH_URL, apiKey, {
      company_name_or: names,
      company_name_case_insensitive_or: names,
      job_filters: { posted_at_max_age_days: LOOKBACK_DAYS },
      min_num_jobs_found: 1,
      limit: PAGE_SIZE,
      page,
    });
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    companies.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return dedupeCompanies(companies);
}

async function fetchCreditBalance(apiKey: string): Promise<CreditBalance> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(CREDIT_BALANCE_URL, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.description || payload?.error?.title || `credit balance HTTP ${response.status}`);
    return {
      api_credits: Math.max(0, Number(payload?.api_credits || 0)),
      used_api_credits: payload?.used_api_credits == null ? null : Math.max(0, Number(payload.used_api_credits)),
    };
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

function normalizeCompanySearchJob(row: any, company: any, envKey: TheirStackEnvKey) {
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
      theirstack_delivery: 'company_search_last_5_signal',
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

async function ensureSweepStateTable() {
  await query(`CREATE TABLE IF NOT EXISTS theirstack_company_sweep_state (
    env_key TEXT PRIMARY KEY,
    last_attempt_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'never',
    returned_companies INTEGER NOT NULL DEFAULT 0,
    signal_jobs INTEGER NOT NULL DEFAULT 0,
    api_credits_before INTEGER,
    api_credits_after INTEGER,
    last_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

async function readSweepState(envKey: TheirStackEnvKey) {
  const rows = await query(`SELECT * FROM theirstack_company_sweep_state WHERE env_key = $1 LIMIT 1`, [envKey]);
  return rows[0] || null;
}

async function writeSweepState(envKey: TheirStackEnvKey, status: string, returnedCompanies: number, signalJobs: number, creditsBefore: number | null, creditsAfter: number | null, error: string | null) {
  await query(
    `INSERT INTO theirstack_company_sweep_state
       (env_key, last_attempt_at, last_success_at, status, returned_companies, signal_jobs, api_credits_before, api_credits_after, last_error, updated_at)
     VALUES ($1,NOW(),CASE WHEN $2 = 'success' THEN NOW() ELSE NULL END,$2,$3,$4,$5,$6,$7,NOW())
     ON CONFLICT (env_key) DO UPDATE SET
       last_attempt_at = NOW(),
       last_success_at = CASE WHEN EXCLUDED.status = 'success' THEN NOW() ELSE theirstack_company_sweep_state.last_success_at END,
       status = EXCLUDED.status,
       returned_companies = CASE WHEN EXCLUDED.status = 'success' THEN EXCLUDED.returned_companies ELSE theirstack_company_sweep_state.returned_companies END,
       signal_jobs = CASE WHEN EXCLUDED.status = 'success' THEN EXCLUDED.signal_jobs ELSE theirstack_company_sweep_state.signal_jobs END,
       api_credits_before = EXCLUDED.api_credits_before,
       api_credits_after = EXCLUDED.api_credits_after,
       last_error = EXCLUDED.last_error,
       updated_at = NOW()`,
    [envKey, status, returnedCompanies, signalJobs, creditsBefore, creditsAfter, error?.slice(0, 2000) || null],
  );
}

function groupByKey(monitors: TheirStackMonitor[]) {
  const map = new Map<TheirStackEnvKey, TheirStackMonitor[]>();
  for (const monitor of monitors) {
    const rows = map.get(monitor.envKey) || [];
    rows.push(monitor);
    map.set(monitor.envKey, rows);
  }
  return Array.from(map.entries());
}

function buildEntityIndex(entities: EntityRow[]) {
  const map = new Map<string, EntityRow>();
  for (const entity of entities) {
    for (const name of [entity.name, ...(Array.isArray(entity.aliases) ? entity.aliases : [])]) {
      const normalized = normalizeName(name);
      if (normalized && !map.has(normalized)) map.set(normalized, entity);
    }
  }
  return map;
}

function dedupeCompanies(rows: any[]) {
  const seen = new Set<string>();
  return rows.filter(row => {
    const key = String(row?.id || normalizeName(row?.name)).trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function emptyWorkspace(envKey: TheirStackEnvKey, count: number, status: WorkspaceResult['status'], reason: string): WorkspaceResult {
  return { env_key: envKey, status, monitored_companies: count, returned_companies: 0, signal_jobs: 0, imported_jobs: 0, duplicate_skipped: 0, unmatched_companies: 0, credits_before: null, credits_after: null, credits_used: null, reason, high_volume_companies: [] };
}
function isDue(value: unknown) { if (!value) return true; const then = new Date(String(value)).getTime(); return !Number.isFinite(then) || Date.now() - then >= INTERVAL_DAYS * 86400000; }
function normalizeName(value: unknown) { return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function clean(value: unknown) { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text || null; }
function normalizeUrl(value: unknown) { if (!value) return null; try { const url = new URL(String(value).trim()); if (!['http:', 'https:'].includes(url.protocol)) return null; url.hash = ''; return url.toString(); } catch { return null; } }
function normalizeDate(value: unknown) { if (!value) return null; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function numberOrNull(value: unknown) { if (value == null || value === '') return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function integerEnv(name: string, fallback: number) { const parsed = Number(process.env[name]); return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback; }
function booleanEnv(name: string, fallback: boolean) { const value = String(process.env[name] || '').trim().toLowerCase(); if (['1','true','yes','on'].includes(value)) return true; if (['0','false','no','off'].includes(value)) return false; return fallback; }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
