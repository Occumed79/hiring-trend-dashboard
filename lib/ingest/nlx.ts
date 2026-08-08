import { getIngestTimeout } from './http';
import type { CoverageCheck } from './neogovFeed';

const SOURCE = 'nlx';
const DEFAULT_BASE = 'https://api.nlxresearchhub.com/v2/jobs';

export async function fetchNLxJobs(entity: any): Promise<{ jobs: any[]; check: CoverageCheck }> {
  const apiKey = firstEnv(['NLX_API_KEY','NLX_RESEARCH_HUB_API_KEY']);
  if (!apiKey) return { jobs: [], check: skipped('NLx API key not configured') };

  const state = normalizeState(entity?.government_state || entity?.state || process.env.NLX_DEFAULT_STATE);
  if (!state) return { jobs: [], check: skipped('NLx requires a state/ZIP location filter; no state resolved for this entity') };

  const end = startOfTomorrow();
  const start = new Date(end.getTime() - clamp(Number(process.env.NLX_LOOKBACK_DAYS || 30), 1, 34) * 86400000);
  const employer = String(entity?.name || '').trim();
  const url = buildUrl(start, end, state, employer);
  const headerName = process.env.NLX_API_KEY_HEADER || 'X-API-Key';

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', [headerName]: apiKey },
      signal: AbortSignal.timeout(getIngestTimeout(15000)),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json().catch(() => null);
    const rows = extractRows(payload);
    const jobs = rows.map((row: any, index: number) => normalizeNLxRow(row, entity, index)).filter(Boolean) as any[];
    return {
      jobs,
      check: {
        source: SOURCE,
        source_class: 'verified',
        status: jobs.length ? 'success' : 'zero',
        jobs_found: jobs.length,
        details: { state, start: isoDate(start), end: isoDate(end), rows_returned: rows.length, endpoint: safeEndpoint(url) },
      },
    };
  } catch (error) {
    return {
      jobs: [],
      check: {
        source: SOURCE,
        source_class: 'verified',
        status: 'error',
        jobs_found: 0,
        details: { state, endpoint: safeEndpoint(url), error: error instanceof Error ? error.message : String(error) },
      },
    };
  }
}

function buildUrl(start: Date, end: Date, state: string, employer: string) {
  const template = process.env.NLX_API_URL_TEMPLATE;
  if (template) {
    return template
      .replaceAll('{start}', encodeURIComponent(isoDate(start)))
      .replaceAll('{end}', encodeURIComponent(isoDate(end)))
      .replaceAll('{state}', encodeURIComponent(state))
      .replaceAll('{employer}', encodeURIComponent(employer));
  }

  const base = (process.env.NLX_API_BASE_URL || DEFAULT_BASE).replace(/\/+$/,'');
  const url = new URL(`${base}/${isoDate(start)}/${isoDate(end)}`);
  url.searchParams.set(process.env.NLX_STATE_PARAM || 'state', state);
  if (employer) url.searchParams.set(process.env.NLX_EMPLOYER_PARAM || 'employer', employer);
  url.searchParams.set(process.env.NLX_EXPIRED_PARAM || 'expired', 'false');
  const extra = process.env.NLX_EXTRA_QUERY_JSON;
  if (extra) {
    try {
      const parsed = JSON.parse(extra);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
      }
    } catch {}
  }
  return url.toString();
}

function extractRows(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  const candidates = [payload?.jobs, payload?.results, payload?.data, payload?.items, payload?.records, payload?.data?.jobs, payload?.data?.results];
  return candidates.find(Array.isArray) || [];
}

function normalizeNLxRow(row: any, entity: any, index: number) {
  if (!row || typeof row !== 'object') return null;
  const title = pickString(row, ['job_title','title','position_title','name']);
  if (!title) return null;
  const employer = pickString(row, ['employer','employer_name','company','company_name','hiring_organization','organization']);
  if (employer && !employerMatches(employer, entity)) return null;
  const applyUrl = pickString(row, ['url','job_url','apply_url','applyUrl','original_url','source_url','posting_url']);
  const state = normalizeState(pickString(row, ['state','state_code','location_state','location.state'])) || normalizeState(entity?.government_state);
  const city = pickString(row, ['city','location_city','location.city']);
  const country = (pickString(row, ['country','country_code','location.country']) || 'US').toUpperCase();
  const location = pickString(row, ['location','location_name','job_location']) || [city,state].filter(Boolean).join(', ') || null;
  const id = pickString(row, ['job_id','id','posting_id','external_id']) || applyUrl || `${entity?.id || entity?.name}-${index}`;
  return {
    external_id: String(id),
    source: SOURCE,
    title,
    department: pickString(row, ['department','occupation_title','job_category']) || employer || entity?.name || null,
    location,
    city,
    state,
    country,
    lat: toNumber(pick(row, ['lat','latitude','location.lat','location.latitude'])),
    lng: toNumber(pick(row, ['lng','longitude','location.lng','location.longitude'])),
    is_remote: booleanValue(pick(row, ['remote','is_remote'])) || /\b(remote|virtual|telework)\b/i.test(`${title} ${location || ''}`),
    is_overseas: country !== 'US',
    posted_at: normalizeDate(pick(row, ['created_date','posted_at','date_posted','publication_date','created_at'])),
    raw_data: {
      ...row,
      normalized_apply_url: normalizeUrl(applyUrl),
      normalized_employer: entity?.name || employer || null,
      normalized_employer_source: 'national-labor-exchange',
      parser: 'structured_nlx_api',
    },
  };
}

function employerMatches(value: string, entity: any) {
  const haystack = comparable(value);
  const names = [entity?.name, ...(Array.isArray(entity?.aliases) ? entity.aliases : [])].map(comparable).filter(text => text.length >= 3);
  return names.some(name => haystack === name || haystack.includes(name) || name.includes(haystack));
}
function comparable(value: unknown) { return String(value || '').toLowerCase().replace(/&/g,' and ').replace(/\b(inc|llc|ltd|corp|corporation|company|co|government|the)\b/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim(); }
function pick(row: any, keys: string[]) { for (const key of keys) { const value = key.split('.').reduce((acc, part) => acc == null ? undefined : acc[part], row); if (value !== undefined && value !== null && value !== '') return value; } return null; }
function pickString(row: any, keys: string[]) { const value = pick(row, keys); return value === null || value === undefined ? null : String(value).trim() || null; }
function booleanValue(value: unknown) { if (typeof value === 'boolean') return value; return ['1','true','yes','y'].includes(String(value || '').toLowerCase()); }
function toNumber(value: unknown) { const n = Number(value); return value !== null && value !== '' && Number.isFinite(n) ? n : null; }
function normalizeDate(value: unknown) { if (!value) return null; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function normalizeUrl(value: unknown) { if (!value) return null; try { const url = new URL(String(value)); return ['http:','https:'].includes(url.protocol) ? url.toString() : null; } catch { return null; } }
function normalizeState(value: unknown) { const raw = String(value || '').trim().toUpperCase(); return /^[A-Z]{2}$/.test(raw) ? raw : STATE_NAME_TO_CODE[String(value || '').trim().toLowerCase()] || null; }
function startOfTomorrow() { const date = new Date(); date.setUTCHours(0,0,0,0); return new Date(date.getTime() + 86400000); }
function isoDate(date: Date) { return date.toISOString().slice(0,10); }
function firstEnv(names: string[]) { for (const name of names) { const value = String(process.env[name] || '').trim(); if (value) return value; } return ''; }
function skipped(reason: string): CoverageCheck { return { source: SOURCE, source_class: 'verified', status: 'skipped', jobs_found: 0, details: { reason } }; }
function safeEndpoint(value: string) { try { const url = new URL(value); for (const key of Array.from(url.searchParams.keys())) if (/key|token|secret|auth/i.test(key)) url.searchParams.set(key,'***'); return url.toString(); } catch { return 'configured NLx endpoint'; } }
function clamp(value: number, min: number, max: number) { return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value),min),max) : min; }
const STATE_NAME_TO_CODE: Record<string,string> = { alabama:'AL',alaska:'AK',arizona:'AZ',arkansas:'AR',california:'CA',colorado:'CO',connecticut:'CT',delaware:'DE',florida:'FL',georgia:'GA',hawaii:'HI',idaho:'ID',illinois:'IL',indiana:'IN',iowa:'IA',kansas:'KS',kentucky:'KY',louisiana:'LA',maine:'ME',maryland:'MD',massachusetts:'MA',michigan:'MI',minnesota:'MN',mississippi:'MS',missouri:'MO',montana:'MT',nebraska:'NE',nevada:'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND',ohio:'OH',oklahoma:'OK',oregon:'OR',pennsylvania:'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD',tennessee:'TN',texas:'TX',utah:'UT',vermont:'VT',virginia:'VA',washington:'WA','west virginia':'WV',wisconsin:'WI',wyoming:'WY','district of columbia':'DC' };
