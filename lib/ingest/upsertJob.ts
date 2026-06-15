import { query } from '@/db/client';
import { classifyRole } from '@/lib/roleClassifier';

export async function upsertIngestedJob(entity: any, item: any): Promise<boolean> {
  if (!item.external_id || !item.source || !item.title) return false;

  const externalId = String(item.external_id);
  const roleCategory = classifyRole(item.title, item.location);
  const existing = await query(
    `SELECT id FROM jobs WHERE entity_id = $1 AND external_id = $2 AND source = $3`,
    [entity.id, externalId, item.source]
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
    [entity.id, externalId, item.source, item.title, item.department,
     roleCategory, item.location, item.city, item.state, item.country || 'US',
     item.lat, item.lng, item.is_remote || false, item.is_overseas || false,
     item.posted_at, JSON.stringify(item.raw_data || {})]
  );

  return existing.length === 0;
}
