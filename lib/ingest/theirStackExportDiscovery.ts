const REQUESTS_ENDPOINT = 'https://api.theirstack.com/v0/requests/';
const CREDIT_ENDPOINT = 'https://api.theirstack.com/v0/billing/credit-balance';
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
      const [creditBalance, requests] = await Promise.all([
        fetchJson(apiKey, CREDIT_ENDPOINT),
        fetchAppRequests(apiKey, start, end),
      ]);
      const candidates = requests.filter(isExportLikeRequest).map(summarizeRequest);
      const materialized = requests
        .filter(request => hasJobExportKey(request?.body))
        .map(summarizeRequest);

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

  return {
    status: 'success',
    mode: 'read_only_discovery',
    lookback_days: days,
    checked_at: new Date().toISOString(),
    configured_workspaces: workspaces.filter(row => row.configured).length,
    export_candidates: exportCandidates,
    materialized_job_batches: materializedJobBatches,
    conclusion: exportCandidates || materializedJobBatches
      ? 'Candidate app export requests found. Inspect request URL/body and credit fields before enabling any replay.'
      : 'No app export request was found in the lookback window. One sample export in any workspace will create a request record that this probe can inspect; recurring manual exports are not required for discovery.',
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
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
