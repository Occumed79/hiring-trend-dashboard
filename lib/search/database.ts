import { query } from '@/db/client';
import { assessJobQuality } from '@/lib/ingest/jobQuality';

const MAX_FALLBACK_ROWS = 400;

export async function searchDatabaseJobs(searchText: string, limit = 40) {
  const safeLimit = Math.min(Math.max(Math.floor(limit || 40), 1), 100);
  const terms = searchTerms(searchText);

  if (!terms.length) return { hits: [], nbHits: 0, query: searchText, engine: 'database' };

  const haystack = `LOWER(CONCAT_WS(' ',
    COALESCE(e.name, ''), COALESCE(j.title, ''), COALESCE(j.department, ''),
    COALESCE(j.role_category, ''), COALESCE(j.location, ''), COALESCE(j.city, ''),
    COALESCE(j.state, ''), COALESCE(j.country, ''), COALESCE(j.source, ''),
    COALESCE(j.raw_data->>'job_location_category', '')
  ))`;

  const params: any[] = terms.map(term => `%${term}%`);
  const filters = terms.map((_, index) => `${haystack} LIKE $${index + 1}`).join(' AND ');
  params.push(Math.min(Math.max(safeLimit * 4, 120), MAX_FALLBACK_ROWS));

  const rows = await query(
    `SELECT j.id, j.entity_id, j.title, j.department, j.role_category, j.location,
            j.city, j.state, j.country, j.source, j.external_id, j.is_remote,
            j.is_overseas, j.posted_at, j.created_at, j.raw_data,
            e.name AS entity_name, e.portal, e.industry
     FROM jobs j
     JOIN entities e ON e.id = j.entity_id
     WHERE j.is_active = true AND e.is_active = true
       AND ${filters}
     ORDER BY COALESCE(j.posted_at, j.created_at) DESC NULLS LAST, e.name ASC, j.title ASC
     LIMIT $${params.length}`,
    params,
  );

  const hits = rows
    .filter((row: any) => assessJobQuality(row).ok)
    .slice(0, safeLimit)
    .map(toSearchHit);

  return {
    hits,
    nbHits: hits.length,
    query: searchText,
    engine: 'database',
  };
}

export async function searchDatabaseEntities(searchText: string, limit = 12) {
  const terms = searchTerms(searchText);
  const safeLimit = Math.min(Math.max(Math.floor(limit || 12), 1), 30);
  if (!terms.length) return [];

  const haystack = `LOWER(CONCAT_WS(' ',
    COALESCE(e.name, ''), COALESCE(array_to_string(e.aliases, ' '), ''),
    COALESCE(e.industry, ''), COALESCE(e.category, ''), COALESCE(e.portal::text, '')
  ))`;
  const params: any[] = terms.map(term => `%${term}%`);
  const filters = terms.map((_, index) => `${haystack} LIKE $${index + 1}`).join(' AND ');
  params.push(String(searchText || '').trim());
  const exactQueryParam = params.length;
  params.push(safeLimit);
  const limitParam = params.length;

  const rows = await query(
    `SELECT e.id, e.name, e.aliases, e.portal, e.industry, e.category, e.career_page_url,
            COUNT(j.id) FILTER (WHERE j.is_active = true) AS open_jobs
     FROM entities e
     LEFT JOIN jobs j ON j.entity_id = e.id
     WHERE e.is_active = true AND ${filters}
     GROUP BY e.id, e.name, e.aliases, e.portal, e.industry, e.category, e.career_page_url
     ORDER BY CASE WHEN LOWER(e.name) = LOWER($${exactQueryParam}) THEN 0 ELSE 1 END,
              COUNT(j.id) FILTER (WHERE j.is_active = true) DESC,
              e.name ASC
     LIMIT $${limitParam}`,
    params,
  );

  return rows.map((row: any) => ({
    id: String(row.id),
    name: row.name || '',
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    portal: row.portal || '',
    industry: row.industry || '',
    category: row.category || '',
    career_page_url: row.career_page_url || null,
    open_jobs: Math.max(0, Number(row.open_jobs || 0)),
  }));
}

function searchTerms(searchText: string) {
  return String(searchText || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
}

function toSearchHit(row: any) {
  const raw = row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
  const locationCategory = firstString(raw.job_location_category) || deriveLocationCategory(row);
  return {
    objectID: String(row.id),
    job_id: String(row.id),
    entity_id: String(row.entity_id),
    entity_name: row.entity_name || '',
    portal: row.portal || '',
    industry: row.industry || '',
    title: row.title || '',
    department: row.department || '',
    role_category: row.role_category || 'other',
    location_category: locationCategory,
    location: row.location || '',
    city: row.city || '',
    state: row.state || '',
    country: row.country || '',
    source: row.source || '',
    external_id: row.external_id || '',
    is_remote: Boolean(row.is_remote),
    is_overseas: Boolean(row.is_overseas),
    is_active: true,
    posted_at: row.posted_at ? new Date(row.posted_at).toISOString() : null,
    apply_url: firstString(raw.normalized_apply_url, raw.final_url, raw.url, raw.job_apply_link, raw.job_url),
  };
}

function deriveLocationCategory(row: any) {
  if (row.is_remote) return 'remote';
  const country = String(row.country || '').trim().toUpperCase();
  if (country === 'US') return 'domestic';
  if (country) return 'overseas';
  return 'unknown';
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}
