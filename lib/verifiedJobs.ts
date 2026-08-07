import { query } from '@/db/client';
import { assessJobQuality } from '@/lib/ingest/jobQuality';

export type VerifiedJobRow = {
  id: string;
  entity_id: string;
  title: string;
  department?: string | null;
  role_category?: string | null;
  location?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  lat?: any;
  lng?: any;
  source: string;
  external_id?: string | null;
  posted_at?: any;
  created_at?: any;
  updated_at?: any;
  is_remote?: boolean;
  is_overseas?: boolean;
  raw_data?: any;
  [key: string]: any;
};

export function filterVerifiedJobs<T extends Record<string, any>>(rows: T[]): T[] {
  return rows.filter((row) => assessJobQuality(row).ok);
}

export async function getVerifiedActiveJobs(entityId: string): Promise<VerifiedJobRow[]> {
  const rows = await query(
    `SELECT id, entity_id, title, department, role_category, location, city, state, country,
            lat, lng, source, external_id, posted_at, created_at, updated_at,
            is_remote, is_overseas, raw_data
     FROM jobs
     WHERE entity_id = $1 AND is_active = true`,
    [entityId],
  );
  return filterVerifiedJobs(rows as VerifiedJobRow[]);
}

export function isNewThisWeek(row: Record<string, any>, now = Date.now()) {
  // Database discovery time is not publication time. A first import of an old
  // career board must never turn the entire inventory into "new this week".
  if (!row.posted_at) return false;
  const timestamp = new Date(row.posted_at).getTime();
  return Number.isFinite(timestamp) && timestamp >= now - 7 * 86400000;
}

export function hasRealMappedLocation(row: Record<string, any>) {
  if (row.lat === null || row.lat === undefined || row.lng === null || row.lng === undefined) return false;
  const quality = String(row.raw_data?.normalized_location_quality || '').toLowerCase();
  return !quality.includes('fallback') && !quality.includes('unmapped_no_job_location');
}
