import { query } from '@/db/client';
import { firstRuntimeEnv, RUNTIME_ENV } from '@/lib/runtimeEnv';

const DEFAULT_INDEX = 'hiring_jobs';
const BATCH_SIZE = 500;
const MAX_ENTITY_RECORDS = 5000;

type AlgoliaConfig = {
  appId: string;
  indexName: string;
  writeKey?: string;
  searchKey?: string;
};

export type AlgoliaSyncResult = {
  status: 'success' | 'skipped' | 'error';
  indexed: number;
  deleted: number;
  reason?: string;
};

export async function syncEntityToAlgolia(entityId: string): Promise<AlgoliaSyncResult> {
  const config = getConfig();
  if (!config.appId || !config.writeKey) {
    return { status: 'skipped', indexed: 0, deleted: 0, reason: 'Algolia application ID or write-capable API key missing' };
  }

  try {
    const rows = await query(
      `SELECT j.id, j.entity_id, j.title, j.department, j.role_category, j.location,
              j.city, j.state, j.country, j.source, j.external_id, j.is_remote,
              j.is_overseas, j.posted_at, j.is_active, j.raw_data,
              e.name AS entity_name, e.portal, e.industry
       FROM jobs j
       JOIN entities e ON e.id = j.entity_id
       WHERE j.entity_id = $1
         AND (j.is_active = true OR j.updated_at >= NOW() - INTERVAL '2 days')
       ORDER BY j.is_active DESC, COALESCE(j.posted_at, j.created_at) DESC NULLS LAST
       LIMIT $2`,
      [entityId, MAX_ENTITY_RECORDS],
    );

    const requests = rows.map((row: any) => row.is_active
      ? { action: 'updateObject', body: toAlgoliaRecord(row) }
      : { action: 'deleteObject', body: { objectID: String(row.id) } });

    if (!requests.length) return { status: 'success', indexed: 0, deleted: 0 };

    for (let i = 0; i < requests.length; i += BATCH_SIZE) {
      await algoliaRequest(config, 'write', `/1/indexes/${encodeURIComponent(config.indexName)}/batch`, {
        method: 'POST',
        body: JSON.stringify({ requests: requests.slice(i, i + BATCH_SIZE) }),
      });
    }

    return {
      status: 'success',
      indexed: rows.filter((row: any) => row.is_active).length,
      deleted: rows.filter((row: any) => !row.is_active).length,
    };
  } catch (error) {
    return { status: 'error', indexed: 0, deleted: 0, reason: errorMessage(error) };
  }
}

export async function purgeEntityFromAlgolia(entityId: string): Promise<AlgoliaSyncResult> {
  const config = getConfig();
  if (!config.appId || !config.writeKey) {
    return { status: 'skipped', indexed: 0, deleted: 0, reason: 'Algolia application ID or write-capable API key missing' };
  }

  try {
    const rows = await query(`SELECT id FROM jobs WHERE entity_id = $1 LIMIT $2`, [entityId, MAX_ENTITY_RECORDS]);
    const requests = rows.map((row: any) => ({ action: 'deleteObject', body: { objectID: String(row.id) } }));
    for (let i = 0; i < requests.length; i += BATCH_SIZE) {
      await algoliaRequest(config, 'write', `/1/indexes/${encodeURIComponent(config.indexName)}/batch`, {
        method: 'POST',
        body: JSON.stringify({ requests: requests.slice(i, i + BATCH_SIZE) }),
      });
    }
    return { status: 'success', indexed: 0, deleted: requests.length };
  } catch (error) {
    return { status: 'error', indexed: 0, deleted: 0, reason: errorMessage(error) };
  }
}

export async function searchAlgoliaJobs(searchText: string, limit = 40) {
  const config = getConfig();
  const key = config.searchKey || config.writeKey;
  if (!config.appId || !key) {
    return { configured: false, hits: [], nbHits: 0, query: searchText };
  }

  const safeLimit = Math.min(Math.max(Math.floor(limit || 40), 1), 100);
  try {
    const payload = await algoliaRequest(config, config.searchKey ? 'search' : 'write', `/1/indexes/${encodeURIComponent(config.indexName)}/query`, {
      method: 'POST',
      body: JSON.stringify({
        query: String(searchText || '').trim(),
        hitsPerPage: safeLimit,
        attributesToHighlight: [],
        attributesToSnippet: [],
      }),
    });
    const hits = (Array.isArray(payload?.hits) ? payload.hits : []).filter((hit: any) => hit?.is_active !== false);
    return {
      configured: true,
      hits,
      nbHits: Number(payload?.nbHits || hits.length),
      query: searchText,
      processingTimeMS: Number(payload?.processingTimeMS || 0),
    };
  } catch (error) {
    const message = errorMessage(error);
    if (/index.*does not exist|not found|404/i.test(message)) {
      return { configured: true, hits: [], nbHits: 0, query: searchText, warming: true };
    }
    throw error;
  }
}

function toAlgoliaRecord(row: any) {
  const oh = row.raw_data?.clarifai_oh || {};
  const ohTerms = [
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

  const applyUrl = firstString(
    row.raw_data?.normalized_apply_url,
    row.raw_data?.final_url,
    row.raw_data?.url,
    row.raw_data?.job_apply_link,
    row.raw_data?.job_url,
  );

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
    apply_url: applyUrl,
    occupational_health_score: clamp(Math.round(Number(oh.opportunity_score) || 0), 0, 100),
    occupational_health_signals: ohTerms,
    occupational_health_reason: firstString(oh.reason),
    search_text: [
      row.entity_name,
      row.title,
      row.department,
      row.role_category,
      row.location,
      row.city,
      row.state,
      row.country,
      ...ohTerms,
    ].filter(Boolean).join(' '),
  };
}

function getConfig(): AlgoliaConfig {
  const sharedApiKey = firstRuntimeEnv(['ALGOLIA_API_KEY']);
  return {
    appId: firstRuntimeEnv([...RUNTIME_ENV.algoliaAppId]),
    indexName: String(process.env.ALGOLIA_INDEX_NAME || DEFAULT_INDEX).trim() || DEFAULT_INDEX,
    writeKey: firstRuntimeEnv(['ALGOLIA_WRITE_API_KEY']) || sharedApiKey || undefined,
    searchKey: firstRuntimeEnv(['ALGOLIA_SEARCH_API_KEY']) || sharedApiKey || undefined,
  };
}

async function algoliaRequest(config: AlgoliaConfig, mode: 'search' | 'write', path: string, init: RequestInit) {
  const apiKey = mode === 'search' ? config.searchKey : config.writeKey;
  if (!apiKey) throw new Error(`Algolia ${mode} key missing`);
  const response = await fetch(`https://${config.appId}.algolia.net${path}`, {
    ...init,
    headers: {
      'x-algolia-application-id': config.appId,
      'x-algolia-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || `Algolia HTTP ${response.status}`);
  return payload;
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
