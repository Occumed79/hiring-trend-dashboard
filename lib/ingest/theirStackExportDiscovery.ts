const REQUESTS_ENDPOINT = 'https://api.theirstack.com/v0/requests/';
const CREDIT_ENDPOINT = 'https://api.theirstack.com/v0/billing/credit-balance';
const DATASETS_ENDPOINT = 'https://api.theirstack.com/v1/datasets';
const COMPANY_LISTS_ENDPOINT = 'https://api.theirstack.com/v0/company_lists';
const KEY_SLOTS = [
  'THEIRSTACK_API_KEY',
  'THEIRSTACK_API_KEY_2',
  'THEIRSTACK_API_KEY_3',
  'THEIRSTACK_API_KEY_4',
  'THEIRSTACK_API_KEY_5',
] as const;
const TIMEOUT_MS = clamp(integerEnv('THEIRSTACK_EXPORT_DISCOVERY_TIMEOUT_MS', 12000), 2000, 60000);
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

export type TheirStackExportCandidate = {
  request_id: string | number | null;
  started_at: string | null;
  method: string | null;
  url: string | null;
  type: string | null;
  status_code: number | null;
  completed: boolean | null;
  returned_jobs: number;
  returned_companies: number;
  api_credits: number;
  ui_credits: number;
  body: Record<string, unknown> | null;
  signals: string[];
};

type DatasetSummary = {
  type: string | null;
  name: string | null;
  is_accessible: boolean;
  options: Array<{
    id: string | null;
    item_type: string | null;
    format: string | null;
    frequency: string | null;
    version: string | null;
    is_deprecated: boolean;
    dataset_url_present: boolean;
    dataset_prefix_present: boolean;
    last_updated: string | null;
    size: number | null;
  }>;
};

type CompanyListSummary = {
  id: number | null;
  name: string | null;
  type: string | null;
  companies_count: number;
  created_at: string | null;
};

export type TheirStackWorkspaceDiscovery = {
  key_slot: string;
  configured: boolean;
  status: 'success' | 'missing_key' | 'error';
  credit_balance?: {
    api_credits: number | null;
    used_api_credits: number | null;
    ui_credits: number | null;
    used_ui_credits: number | null;
  };
  app_requests_scanned?: number;
  export_candidates?: TheirStackExportCandidate[];
  materialized_job_batches?: TheirStackExportCandidate[];
  datasets?: DatasetSummary[];
  accessible_bulk_datasets?: string[];
  dataset_probe_error?: string | null;
  company_lists?: CompanyListSummary[];
  export_snapshot_lists?: CompanyListSummary[];
  company_list_probe_error?: string | null;
  error?: string;
};

export async function discoverTheirStackAppExports(lookbackDays?: number) {
  const days = clamp(Number(lookbackDays) || integerEnv('THEIRSTACK_EXPORT_DISCOVERY_LOOKBACK_DAYS', 90), 1, 365);
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const workspaces: TheirStackWorkspaceDiscovery[] = [];

  for (const keySlot of KEY_SLOTS) {
    const apiKey = String(process.env[keySlot] || '').trim();
    if (!apiKey) {
      workspaces.push({ key_slot: keySlot, configured: false, status: 'missing_key' });
      continue;
    }

    try {
      const [creditBalance, requests, datasetsResult, companyListsResult] = await Promise.all([
        fetchJson(apiKey, CREDIT_ENDPOINT),
        fetchAppRequests(apiKey, start, end),
        fetchOptionalJson(apiKey, DATASETS_ENDPOINT),
        fetchOptionalJson(apiKey, COMPANY_LISTS_ENDPOINT),
      ]);
      const candidates = requests.filter(isExportLikeRequest).map(summarizeRequest);
      const materialized = requests
        .filter(request => hasJobExportKey(request?.body))
        .map(summarizeRequest);
      const datasets = datasetsResult.ok ? summarizeDatasets(datasetsResult.payload) : [];
      const companyLists = companyListsResult.ok ? summarizeCompanyLists(companyListsResult.payload) : [];
      const accessibleBulkDatasets = datasets
        .filter(dataset => dataset.is_accessible)
        .map(dataset => dataset.type || dataset.name)
        .filter((value): value is string => Boolean(value));
      const exportSnapshotLists = companyLists.filter(list => list.type === 'EXPORT_SNAPSHOT');

      workspaces.push({
        key_slot: keySlot,
        configured: true,
        status: 'success',
        credit_balance: {
          api_credits: numberOrNull(creditBalance?.api_credits),
          used_api_credits: numberOrNull(creditBalance?.used_api_credits),
          ui_credits: numberOrNull(creditBalance?.ui_credits),
          used_ui_credits: numberOrNull(creditBalance?.used_ui_credits),
        },
        app_requests_scanned: requests.length,
        export_candidates: candidates.slice(0, 25),
        materialized_job_batches: materialized.slice(0, 25),
        datasets,
        accessible_bulk_datasets: Array.from(new Set(accessibleBulkDatasets)),
        dataset_probe_error: datasetsResult.ok ? null : datasetsResult.error,
        company_lists: companyLists.slice(0, 100),
        export_snapshot_lists: exportSnapshotLists.slice(0, 25),
        company_list_probe_error: companyListsResult.ok ? null : companyListsResult.error,
      });
    } catch (error) {
      workspaces.push({
        key_slot: keySlot,
        configured: true,
        status: 'error',
        error: errorMessage(error),
      });
    }
  }

  const exportCandidates = workspaces.reduce((sum, row) => sum + (row.export_candidates?.length || 0), 0);
  const materializedJobBatches = workspaces.reduce((sum, row) => sum + (row.materialized_job_batches?.length || 0), 0);
  const exportSnapshotLists = workspaces.reduce((sum, row) => sum + (row.export_snapshot_lists?.length || 0), 0);
  const accessibleJobsDatasetWorkspaces = workspaces
    .filter(row => row.accessible_bulk_datasets?.includes('jobs'))
    .map(row => row.key_slot);

  return {
    status: 'success',
    mode: 'read_only_discovery',
    lookback_days: days,
    checked_at: new Date().toISOString(),
    configured_workspaces: workspaces.filter(row => row.configured).length,
    export_candidates: exportCandidates,
    materialized_job_batches: materializedJobBatches,
    export_snapshot_lists: exportSnapshotLists,
    accessible_jobs_dataset_workspaces: accessibleJobsDatasetWorkspaces,
    documented_constraints: {
      company_search_jobs_found_per_company: 5,
      company_list_export_scope: 'companies_only',
      job_search_credit_rule: '1 API credit per returned job',
      bulk_jobs_path: '/v1/datasets when jobs dataset is_accessible=true',
    },
    conclusion: accessibleJobsDatasetWorkspaces.length
      ? `Supported bulk Jobs dataset access is enabled for: ${accessibleJobsDatasetWorkspaces.join(', ')}. Prefer dataset ingestion over per-job API retrieval.`
      : exportCandidates || materializedJobBatches || exportSnapshotLists
        ? 'No accessible Jobs dataset was detected, but app/export artifacts exist. Inspect their request URL/body and credit fields before enabling any replay.'
        : 'No supported bulk Jobs dataset or app export artifact was found in the lookback window. Continue watching request history; a single sample export in any workspace is enough for discovery.',
    workspaces,
  };
}

async function fetchAppRequests(apiKey: string, start: Date, end: Date) {
  const all: any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(REQUESTS_ENDPOINT);
    url.searchParams.set('start_datetime', start.toISOString());
    url.searchParams.set('end_datetime', end.toISOString());
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('origin', 'app');

    const payload = await fetchJson(apiKey, url.toString());
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

async function fetchOptionalJson(apiKey: string, url: string) {
  try {
    return { ok: true as const, payload: await fetchJson(apiKey, url), error: null };
  } catch (error) {
    return { ok: false as const, payload: null, error: errorMessage(error) };
  }
}

async function fetchJson(apiKey: string, url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const description = payload?.error?.description || payload?.error?.title || `HTTP ${response.status}`;
      throw new Error(String(description));
    }
    return payload;
  } catch (error) {
    if ((error as any)?.name === 'AbortError') throw new Error(`timeout after ${TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeDatasets(payload: any): DatasetSummary[] {
  const groups = Array.isArray(payload) ? payload : [];
  return groups.map(group => ({
    type: clean(group?.type),
    name: clean(group?.name),
    is_accessible: group?.is_accessible === true,
    options: (Array.isArray(group?.options) ? group.options : []).map((option: any) => ({
      id: clean(option?.id),
      item_type: clean(option?.item_type),
      format: clean(option?.format),
      frequency: clean(option?.frequency),
      version: clean(option?.version),
      is_deprecated: option?.is_deprecated === true,
      // Deliberately do not return signed URLs or storage prefixes from the probe.
      dataset_url_present: Boolean(option?.dataset_url),
      dataset_prefix_present: Boolean(option?.dataset_prefix),
      last_updated: clean(option?.last_updated),
      size: numberOrNull(option?.size),
    })),
  }));
}

function summarizeCompanyLists(payload: any): CompanyListSummary[] {
  const lists = Array.isArray(payload) ? payload : [];
  return lists.map(list => ({
    id: numberOrNull(list?.id),
    name: clean(list?.name),
    type: clean(list?.type),
    companies_count: Number(list?.companies_count || 0),
    created_at: clean(list?.created_at),
  }));
}

function isExportLikeRequest(request: any) {
  const url = String(request?.url || '').toLowerCase();
  const name = String(request?.name || '').toLowerCase();
  const type = String(request?.type || '').toLowerCase();
  const body = request?.body || {};
  const bodyText = JSON.stringify(body).toLowerCase();
  return /export|download/.test(url)
    || /export|download/.test(name)
    || /export|download/.test(type)
    || /job_export_key|file_format|delivery_method|export_type/.test(bodyText);
}

function hasJobExportKey(body: any) {
  if (!body || typeof body !== 'object') return false;
  if (Array.isArray(body?.job_export_key_or) && body.job_export_key_or.length) return true;
  return JSON.stringify(body).includes('job_export_key_or');
}

function summarizeRequest(request: any): TheirStackExportCandidate {
  const signals: string[] = [];
  const url = String(request?.url || '');
  if (/export/i.test(url)) signals.push('export_url');
  if (/download/i.test(url)) signals.push('download_url');
  if (hasJobExportKey(request?.body)) signals.push('job_export_key_or');
  if (Number(request?.api_credits || 0) === 0) signals.push('zero_api_credits');
  if (Number(request?.ui_credits || 0) > 0) signals.push('ui_company_credit_charge');
  if (request?.is_origin_app || request?.origin === 'app') signals.push('app_origin');

  return {
    request_id: request?.id ?? null,
    started_at: request?.start_datetime || null,
    method: clean(request?.method),
    url: redactUrl(request?.url),
    type: clean(request?.type),
    status_code: numberOrNull(request?.status_code),
    completed: typeof request?.completed === 'boolean' ? request.completed : null,
    returned_jobs: Number(request?.num_returned_jobs || 0),
    returned_companies: Number(request?.num_returned_companies || 0),
    api_credits: Number(request?.api_credits || 0),
    ui_credits: Number(request?.ui_credits || 0),
    body: sanitizeBody(request?.body),
    signals,
  };
}

function sanitizeBody(value: any): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const copy: Record<string, unknown> = { ...value };
  for (const key of Object.keys(copy)) {
    if (/token|secret|password|authorization|api[_-]?key/i.test(key)) copy[key] = '[redacted]';
  }
  return copy;
}

function redactUrl(value: unknown) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    for (const key of Array.from(url.searchParams.keys())) {
      if (/token|secret|password|authorization|api[_-]?key/i.test(key)) url.searchParams.set(key, '[redacted]');
    }
    return url.toString();
  } catch {
    return clean(value);
  }
}

function clean(value: unknown) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function integerEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function numberOrNull(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
