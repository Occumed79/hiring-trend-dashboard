import { query } from '@/db/client';
import type { TheirStackEnvKey } from './theirStackMonitors';

const DATASETS_URL = 'https://api.theirstack.com/v1/datasets';
const CACHE_HOURS = 6;
const TIMEOUT_MS = Math.min(60000, Math.max(3000, Number(process.env.THEIRSTACK_TIMEOUT_MS || 15000)));
const KEY_SLOTS: TheirStackEnvKey[] = ['THEIRSTACK_API_KEY','THEIRSTACK_API_KEY_2','THEIRSTACK_API_KEY_3','THEIRSTACK_API_KEY_4','THEIRSTACK_API_KEY_5'];

type WorkspaceDatasetStatus = {
  env_key: TheirStackEnvKey;
  configured: boolean;
  status: 'accessible' | 'not_entitled' | 'not_listed' | 'missing_key' | 'error';
  accessible: boolean;
  dataset_name: string | null;
  options: Array<{ id?: string | number; format?: string; frequency?: string; last_updated?: string; size?: number; dataset_prefix?: string }>;
  checked_at: string | null;
  error?: string | null;
  cached?: boolean;
};

export async function probeTheirStackJobDatasets(options: { force?: boolean } = {}) {
  await ensureTable();
  const workspaces: WorkspaceDatasetStatus[] = [];

  for (const envKey of KEY_SLOTS) {
    const apiKey = String(process.env[envKey] || '').trim();
    if (!apiKey) {
      workspaces.push({ env_key: envKey, configured: false, status: 'missing_key', accessible: false, dataset_name: null, options: [], checked_at: null });
      continue;
    }

    if (!options.force) {
      const cached = await readFreshCache(envKey);
      if (cached) {
        workspaces.push({ ...cached, configured: true, cached: true });
        continue;
      }
    }

    try {
      const payload = await fetchDatasets(apiKey);
      const datasets = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
      const jobs = datasets.find((row: any) => String(row?.type || row?.name || '').toLowerCase().includes('job')) || null;
      const accessible = Boolean(jobs?.is_accessible === true);
      const status: WorkspaceDatasetStatus['status'] = jobs ? (accessible ? 'accessible' : 'not_entitled') : 'not_listed';
      const row: WorkspaceDatasetStatus = {
        env_key: envKey,
        configured: true,
        status,
        accessible,
        dataset_name: jobs ? String(jobs?.name || jobs?.type || 'jobs') : null,
        options: sanitizeOptions(jobs?.options),
        checked_at: new Date().toISOString(),
        error: null,
      };
      await persist(row);
      workspaces.push(row);
    } catch (error) {
      const row: WorkspaceDatasetStatus = {
        env_key: envKey,
        configured: true,
        status: 'error',
        accessible: false,
        dataset_name: null,
        options: [],
        checked_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
      await persist(row).catch(() => {});
      workspaces.push(row);
    }
  }

  const accessible = workspaces.filter(row => row.accessible);
  return {
    checked: workspaces.filter(row => row.configured).length,
    accessible_workspaces: accessible.length,
    any_accessible: accessible.length > 0,
    workspaces,
    note: accessible.length
      ? 'At least one TheirStack workspace is entitled to the Jobs Dataset. Bulk dataset ingestion can be enabled without per-job Job Search polling.'
      : 'The API keys can still use normal TheirStack APIs; Jobs Dataset entitlement is separate and must report is_accessible=true.',
  };
}

async function fetchDatasets(apiKey: string) {
  const response = await fetch(DATASETS_URL, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.description || payload?.error?.title || payload?.message || `TheirStack datasets HTTP ${response.status}`);
  return payload;
}

function sanitizeOptions(value: unknown): WorkspaceDatasetStatus['options'] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((row: any) => ({
    id: row?.id,
    format: text(row?.format),
    frequency: text(row?.frequency),
    last_updated: text(row?.last_updated),
    size: Number.isFinite(Number(row?.size)) ? Number(row.size) : undefined,
    dataset_prefix: text(row?.dataset_prefix),
  }));
}

async function ensureTable() {
  await query(`CREATE TABLE IF NOT EXISTS theirstack_dataset_access (
    env_key TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    accessible BOOLEAN NOT NULL DEFAULT false,
    dataset_name TEXT,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    last_error TEXT,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`).catch(() => {});
}

async function readFreshCache(envKey: TheirStackEnvKey): Promise<WorkspaceDatasetStatus | null> {
  const rows = await query(
    `SELECT env_key,status,accessible,dataset_name,options,last_error,checked_at
     FROM theirstack_dataset_access
     WHERE env_key=$1 AND checked_at >= NOW() - ($2::int * INTERVAL '1 hour')
     LIMIT 1`,
    [envKey, CACHE_HOURS],
  ).catch(() => []);
  const row = rows[0];
  if (!row) return null;
  return {
    env_key: envKey,
    configured: true,
    status: normalizeStatus(row.status),
    accessible: Boolean(row.accessible),
    dataset_name: row.dataset_name || null,
    options: Array.isArray(row.options) ? row.options : [],
    checked_at: row.checked_at ? new Date(row.checked_at).toISOString() : null,
    error: row.last_error || null,
  };
}

async function persist(row: WorkspaceDatasetStatus) {
  await query(
    `INSERT INTO theirstack_dataset_access (env_key,status,accessible,dataset_name,options,last_error,checked_at,updated_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,NOW(),NOW())
     ON CONFLICT (env_key) DO UPDATE SET status=EXCLUDED.status,accessible=EXCLUDED.accessible,
       dataset_name=EXCLUDED.dataset_name,options=EXCLUDED.options,last_error=EXCLUDED.last_error,
       checked_at=NOW(),updated_at=NOW()`,
    [row.env_key,row.status,row.accessible,row.dataset_name,JSON.stringify(row.options || []),row.error?.slice(0,2000) || null],
  );
}

function normalizeStatus(value: unknown): WorkspaceDatasetStatus['status'] {
  const v = String(value || 'error');
  return ['accessible','not_entitled','not_listed','missing_key','error'].includes(v) ? v as WorkspaceDatasetStatus['status'] : 'error';
}
function text(value: unknown) { const result=String(value ?? '').trim(); return result || undefined; }
