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
    COALESCE(j.raw_data::text, '')
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
  params.push(safeLimit);

  const rows = await query(
    `SELECT e.id, e.name, e.aliases, e.portal, e.industry, e.category, e.career_page_url,
            COUNT(j.id) FILTER (WHERE j.is_active = true) AS open_jobs
     FROM entities e
     LEFT JOIN jobs j ON j.entity_id = e.id
     WHERE e.is_active = true AND ${filters}
     GROUP BY e.id, e.name, e.aliases, e.portal, e.industry, e.category, e.career_page_url
     ORDER BY CASE WHEN LOWER(e.name) = LOWER($1) THEN 0 ELSE 1 END,
              COUNT(j.id) FILTER (WHERE j.is_active = true) DESC,
              e.name ASC
     LIMIT $${params.length}`,
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
  const oh = raw.clarifai_oh && typeof raw.clarifai_oh === 'object' ? raw.clarifai_oh : {};
  const signals = [
    oh.safety_sensitive && 'safety sensitive',
    oh.likely_preplacement_exam && 'pre placement exam occupational physical',
    oh.likely_drug_testing && 'drug testing',
    oh.likely_hearing_conservation && 'hearing conservation audiogram',
    oh.likely_respirator_use && 'respirator fit testing pulmonary',
    oh.likely_medical_surveillance && 'medical surveillance',
    oh.deployment_oconus && 'deployment oconus overseas',
    oh.dot_cdl && 'DOT CDL driver',
    oh.hazardous_exposure && 'hazardous exposure hazmat',
    oh.clearance_security && 'clearance security',
    String(oh.physical_demand || '').toLowerCase() === 'high' && 'high physical demand',
  ].filter(Boolean) as string[];

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
    occupational_health_score: clamp(Math.round(Number(oh.opportunity_score) || 0), 0, 100),
    occupational_health_signals: signals,
    occupational_health_reason: firstString(oh.reason),
  };
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
