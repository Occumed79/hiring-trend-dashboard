import { query } from '@/db/client';
import { classifyRole } from '@/lib/roleClassifier';

export async function upsertIngestedJob(entity: any, item: any): Promise<boolean> {
  if (!item.external_id || !item.source || !item.title) return false;

  const externalId = String(item.external_id).trim();
  const source = String(item.source).trim();
  const title = String(item.title).trim();
  if (!externalId || !source || !title) return false;

  const roleCategory = classifyRole(title, item.location);
  const existing = await query(
    `SELECT id FROM jobs WHERE entity_id = $1 AND external_id = $2 AND source = $3`,
    [entity.id, externalId, source]
  );

  await query(
    `INSERT INTO jobs (entity_id, external_id, source, title, department, role_category,
      location, city, state, country, lat, lng, is_remote, is_overseas, posted_at, raw_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (entity_id, external_id, source) DO UPDATE SET
      title = EXCLUDED.title,
      department = EXCLUDED.department,
      role_category = EXCLUDED.role_category,
      location = EXCLUDED.location,
      city = EXCLUDED.city,
      state = EXCLUDED.state,
      country = EXCLUDED.country,
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      is_remote = EXCLUDED.is_remote,
      is_overseas = EXCLUDED.is_overseas,
      posted_at = COALESCE(EXCLUDED.posted_at, jobs.posted_at),
      raw_data = EXCLUDED.raw_data,
      is_active = true,
      closed_at = NULL,
      updated_at = NOW()`,
    [
      entity.id,
      externalId,
      source,
      title,
      nullableString(item.department),
      roleCategory,
      nullableString(item.location),
      nullableString(item.city),
      nullableString(item.state),
      normalizeCountry(item.country),
      toNumber(item.lat),
      toNumber(item.lng),
      toBoolean(item.is_remote),
      toBoolean(item.is_overseas),
      normalizeDate(item.posted_at),
      JSON.stringify(item.raw_data || {}),
    ]
  );

  return existing.length === 0;
}

function nullableString(value: unknown) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeCountry(value: unknown) {
  const text = nullableString(value) || 'US';
  return text.slice(0, 2).toUpperCase();
}

function toNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolean(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return false;
}

function normalizeDate(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
