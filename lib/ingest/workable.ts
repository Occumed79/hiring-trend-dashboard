import { getIngestTimeout } from './http';

export async function fetchWorkableJobs(account: string) {
  const slug = sanitizeAccount(account);
  if (!slug) return [];
  try {
    const response = await fetch(`https://www.workable.com/api/accounts/${encodeURIComponent(slug)}?details=true`, {
      headers: { Accept: 'application/json', 'User-Agent': 'OccuMedHiringTrendDashboard/1.0' },
      signal: AbortSignal.timeout(getIngestTimeout(12000)),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json().catch(() => null);
    const rows = Array.isArray(payload?.jobs) ? payload.jobs : Array.isArray(payload) ? payload : Array.isArray(payload?.results) ? payload.results : [];
    return rows.map((job: any) => normalizeJob(job, slug)).filter((job: any) => job.external_id && job.title && job.raw_data?.normalized_apply_url);
  } catch (error) {
    console.error('Workable public feed error:', error);
    return [];
  }
}

function normalizeJob(job: any, account: string) {
  const loc = job?.location && typeof job.location === 'object' ? job.location : {};
  const location = clean(loc.location_str) || clean(job?.location) || [loc.city, loc.region_code || loc.region, loc.country].filter(Boolean).join(', ') || null;
  const country = normalizeCountry(loc.country_code || loc.country || job?.country);
  const applyUrl = normalizeUrl(job?.url || job?.shortlink || job?.application_url || job?.shortlink_url);
  return {
    external_id: String(job?.id || job?.shortcode || job?.code || applyUrl || `${job?.title || ''}|${location || ''}`),
    source: 'workable',
    title: clean(job?.title || job?.full_title),
    department: clean(job?.department) || firstDepartment(job?.department_hierarchy),
    location,
    city: clean(loc.city) || splitCity(location),
    state: clean(loc.region_code || loc.region) || splitState(location),
    country,
    lat: null,
    lng: null,
    is_remote: Boolean(loc.telecommuting) || /\b(remote|virtual|work from home)\b/i.test(`${job?.title || ''} ${location || ''}`),
    is_overseas: country ? country !== 'US' : false,
    posted_at: normalizeDate(job?.published_at || job?.created_at || job?.updated_at),
    raw_data: { ...job, normalized_apply_url: applyUrl, normalized_employer_source: 'workable-public-account-feed', workable_account: account },
  };
}

function sanitizeAccount(value: unknown) { return String(value || '').trim().replace(/^https?:\/\//i,'').split(/[./]/)[0].replace(/[^a-z0-9-]/gi,'').toLowerCase(); }
function firstDepartment(value: unknown) { const rows = Array.isArray(value) ? value : []; return rows.map((row:any)=>clean(row?.name || row)).find(Boolean) || null; }
function normalizeUrl(value: unknown) { try { const url = new URL(String(value || '').trim()); return ['http:','https:'].includes(url.protocol) ? url.toString() : null; } catch { return null; } }
function normalizeDate(value: unknown) { if (!value) return null; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function clean(value: unknown) { const text = String(value || '').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); return text || null; }
function splitCity(value?: string | null) { return value ? value.split(',')[0]?.trim() || null : null; }
function splitState(value?: string | null) { return value ? value.split(',')[1]?.trim() || null : null; }
function normalizeCountry(value: unknown) { const raw = String(value || '').trim(); if (!raw) return null; const lower = raw.toLowerCase(); const map: Record<string,string> = { us:'US',usa:'US','united states':'US','united states of america':'US',ca:'CA',canada:'CA',gb:'GB',uk:'GB','united kingdom':'GB',de:'DE',germany:'DE',au:'AU',australia:'AU',fr:'FR',france:'FR',it:'IT',italy:'IT',es:'ES',spain:'ES',pl:'PL',poland:'PL' }; return map[lower] || (/^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : null); }
