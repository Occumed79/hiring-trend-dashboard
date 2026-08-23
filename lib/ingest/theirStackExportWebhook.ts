import { query } from '@/db/client';
import { upsertIngestedJob } from './upsertJob';
import { buildHiringSnapshot } from './buildSnapshot';
import { syncEntityToAlgolia } from '@/lib/search/algolia';

// Keep app-export rows outside the generic jobapi:/web: lifecycle. They are a
// bounded company-credit snapshot, not a complete API inventory, so a later
// authoritative ingest must not automatically retire gap-filling export rows.
const SOURCE = 'theirstack_export';
const MAX_ROWS = 10000;

export type TheirStackExportImportResult = {
  detected: number;
  imported: number;
  unmatched: number;
  rejected: number;
  duplicate_skipped: number;
  affected_entities: string[];
  top_level_keys: string[];
  sample: any[];
};

export async function importTheirStackJobExport(payload: any): Promise<TheirStackExportImportResult> {
  const rows = extractJobRows(payload).slice(0, MAX_ROWS);
  const entities = await query(`SELECT id, name, aliases FROM entities WHERE is_active = true`);
  const entityIndex = buildEntityIndex(entities);

  let imported = 0;
  let unmatched = 0;
  let rejected = 0;
  let duplicateSkipped = 0;
  const affected = new Map<string, any>();

  for (const row of rows) {
    const employerName = extractEmployerName(row);
    const entity = employerName ? entityIndex.get(normalizeName(employerName)) : null;
    if (!entity) {
      unmatched++;
      continue;
    }

    const job = normalizeExportJob(row, employerName || entity.name);
    if (!job) {
      rejected++;
      continue;
    }

    // Direct/ATS/official rows already in Hiring Insights should remain the
    // canonical copy for an apply URL. The export fills gaps instead of racing
    // a newer supplemental row against a stronger source during deduplication.
    if (job.raw_data?.normalized_apply_url && await hasExistingActiveUrl(entity.id, job.raw_data.normalized_apply_url)) {
      duplicateSkipped++;
      continue;
    }

    await upsertIngestedJob(entity, job);
    imported++;
    affected.set(entity.id, entity);
  }

  for (const entity of affected.values()) {
    await buildHiringSnapshot(entity.id);
    const algolia = await syncEntityToAlgolia(entity.id);
    if (algolia.status === 'error') console.warn(`Algolia sync failed after TheirStack export for ${entity.name}: ${algolia.reason}`);
  }

  return {
    detected: rows.length,
    imported,
    unmatched,
    rejected,
    duplicate_skipped: duplicateSkipped,
    affected_entities: Array.from(affected.values()).map(entity => entity.name).sort(),
    top_level_keys: payload && typeof payload === 'object' && !Array.isArray(payload) ? Object.keys(payload).slice(0, 50) : [],
    sample: rows.slice(0, 3).map(sanitizeSampleRow),
  };
}

export async function saveTheirStackExportReceipt(input: {
  contentType: string | null;
  payload: any;
  result: TheirStackExportImportResult;
}) {
  await ensureReceiptTable();
  const rows = await query(
    `INSERT INTO theirstack_export_receipts
       (content_type, detected_jobs, imported_jobs, unmatched_jobs, rejected_jobs, duplicate_skipped, affected_entities, top_level_keys, payload_sample)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb)
     RETURNING id, received_at`,
    [
      input.contentType,
      input.result.detected,
      input.result.imported,
      input.result.unmatched,
      input.result.rejected,
      input.result.duplicate_skipped,
      JSON.stringify(input.result.affected_entities),
      JSON.stringify(input.result.top_level_keys),
      JSON.stringify(input.result.sample),
    ],
  );
  return rows[0] || null;
}

export async function listTheirStackExportReceipts(limit = 20) {
  await ensureReceiptTable();
  return query(
    `SELECT id, received_at, content_type, detected_jobs, imported_jobs, unmatched_jobs, rejected_jobs, duplicate_skipped,
            affected_entities, top_level_keys, payload_sample
     FROM theirstack_export_receipts
     ORDER BY received_at DESC
     LIMIT $1`,
    [Math.min(100, Math.max(1, limit))],
  );
}

async function ensureReceiptTable() {
  await query(`CREATE TABLE IF NOT EXISTS theirstack_export_receipts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    content_type TEXT,
    detected_jobs INTEGER NOT NULL DEFAULT 0,
    imported_jobs INTEGER NOT NULL DEFAULT 0,
    unmatched_jobs INTEGER NOT NULL DEFAULT 0,
    rejected_jobs INTEGER NOT NULL DEFAULT 0,
    duplicate_skipped INTEGER NOT NULL DEFAULT 0,
    affected_entities JSONB NOT NULL DEFAULT '[]'::jsonb,
    top_level_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
    payload_sample JSONB NOT NULL DEFAULT '[]'::jsonb
  )`);
  await query(`ALTER TABLE theirstack_export_receipts ADD COLUMN IF NOT EXISTS duplicate_skipped INTEGER NOT NULL DEFAULT 0`);
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

function extractJobRows(payload: any): any[] {
  if (Array.isArray(payload)) return payload.filter(looksLikeJob);
  if (!payload || typeof payload !== 'object') return [];

  const preferredKeys = ['jobs', 'data', 'results', 'records', 'items', 'payload'];
  for (const key of preferredKeys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      const rows = value.filter(looksLikeJob);
      if (rows.length) return rows;
    }
    if (value && typeof value === 'object') {
      const nested = extractJobRows(value);
      if (nested.length) return nested;
    }
  }

  const collected: any[] = [];
  walk(payload, collected, new Set(), 0);
  return dedupeRows(collected);
}

function walk(value: any, out: any[], seen: Set<any>, depth: number) {
  if (depth > 5 || out.length >= MAX_ROWS || value === null || value === undefined) return;
  if (typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      if (looksLikeJob(item)) out.push(item);
      else walk(item, out, seen, depth + 1);
      if (out.length >= MAX_ROWS) break;
    }
    return;
  }

  if (looksLikeJob(value)) {
    out.push(value);
    return;
  }

  for (const nested of Object.values(value)) walk(nested, out, seen, depth + 1);
}

function looksLikeJob(row: any) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const title = row.job_title || row.title || row.normalized_title;
  const id = row.id ?? row.job_id ?? row.external_id;
  const url = row.final_url || row.url || row.source_url || row.apply_url;
  return Boolean(title && (id !== undefined || url));
}

function extractEmployerName(row: any) {
  const directCompany = typeof row?.company === 'string' ? row.company : null;
  return clean(
    directCompany ||
    row?.company_name ||
    row?.employer_name ||
    row?.company_object?.name ||
    row?.company?.name ||
    row?.organization?.name
  );
}

function normalizeExportJob(row: any, monitoredEmployer: string) {
  const id = row?.id ?? row?.job_id ?? row?.external_id;
  const title = clean(row?.job_title || row?.title || row?.normalized_title);
  const applyUrl = normalizeUrl(row?.final_url || row?.url || row?.source_url || row?.apply_url);
  if ((id === undefined || id === null) && !applyUrl) return null;
  if (!title || !applyUrl) return null;

  const locationObject = Array.isArray(row?.locations) && row.locations.length ? row.locations[0] : null;
  const country = clean(row?.country_code || locationObject?.country_code || row?.company_object?.country_code);
  const state = clean(row?.state_code || locationObject?.state_code || locationObject?.state);
  const city = clean(locationObject?.name || (Array.isArray(row?.cities) ? row.cities[0] : null));
  const employer = extractEmployerName(row) || monitoredEmployer;
  const stableId = id !== undefined && id !== null ? String(id) : applyUrl;

  return {
    external_id: `theirstack-export-${stableId}`,
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
      normalized_employer: monitoredEmployer,
      normalized_apply_url: applyUrl,
      employer_name: employer,
      company_name: employer,
      theirstack_job_id: id ?? null,
      theirstack_delivery: 'app_job_export_webhook',
      source_graph_lineage: 'theirstack',
      source_graph_class: 'supplemental',
    },
  };
}

function buildEntityIndex(entities: any[]) {
  const map = new Map<string, any>();
  for (const entity of entities) {
    for (const name of [entity.name, ...(Array.isArray(entity.aliases) ? entity.aliases : [])]) {
      const normalized = normalizeName(name);
      if (normalized && !map.has(normalized)) map.set(normalized, entity);
    }
  }
  return map;
}

function dedupeRows(rows: any[]) {
  const seen = new Set<string>();
  return rows.filter(row => {
    const key = String(row?.id ?? row?.job_id ?? row?.external_id ?? row?.final_url ?? row?.url ?? row?.source_url ?? '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sanitizeSampleRow(row: any) {
  if (!row || typeof row !== 'object') return row;
  const copy = JSON.parse(JSON.stringify(row));
  scrub(copy, 0);
  return copy;
}

function scrub(value: any, depth: number) {
  if (!value || typeof value !== 'object' || depth > 6) return;
  for (const key of Object.keys(value)) {
    if (/token|secret|password|authorization|api[_-]?key/i.test(key)) value[key] = '[redacted]';
    else scrub(value[key], depth + 1);
  }
}

function normalizeName(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function clean(value: unknown) { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text || null; }
function normalizeUrl(value: unknown) { if (!value) return null; try { const url = new URL(String(value).trim()); if (!['http:', 'https:'].includes(url.protocol)) return null; url.hash = ''; return url.toString(); } catch { return null; } }
function normalizeDate(value: unknown) { if (!value) return null; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function numberOrNull(value: unknown) { if (value === undefined || value === null || value === '') return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
