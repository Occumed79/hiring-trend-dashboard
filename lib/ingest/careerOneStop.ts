import type { CoverageCheck } from './neogovFeed';
import { getIngestTimeout } from './http';

const SOURCE = 'careeronestop:nlx_mirror';
const PAGE_SIZE = clampInt(process.env.CAREERONESTOP_PAGE_SIZE, 100, 10, 500);
const MAX_PAGES = clampInt(process.env.CAREERONESTOP_MAX_PAGES, 20, 1, 100);
const DAYS = clampInt(process.env.CAREERONESTOP_DAYS, 60, 1, 365);

export async function fetchCareerOneStopJobs(entity: any): Promise<{ jobs: any[]; check: CoverageCheck }> {
  const token = String(process.env.CAREERONESTOP_API_TOKEN || '').trim();
  const userId = String(process.env.CAREERONESTOP_USER_ID || '').trim();
  if (!token || !userId) {
    return { jobs: [], check: { source:SOURCE, source_class:'verified', status:'skipped', jobs_found:0, authoritative_zero:false, details:{ lineage_root:'nlx', reason:'CareerOneStop API token/user ID not configured', role:'NLx resilience mirror' } } };
  }

  const location = stateHint(entity) || String(process.env.CAREERONESTOP_LOCATION || 'US').trim() || 'US';
  const base = String(process.env.CAREERONESTOP_API_BASE_URL || 'https://api.careeronestop.org').replace(/\/$/,'');
  const jobs:any[] = [];
  let startRecord = 0;
  let total = Number.POSITIVE_INFINITY;
  let pages = 0;

  try {
    while (startRecord < total && pages < MAX_PAGES) {
      const path = `/v2/jobsearch/${encodeURIComponent(userId)}/0/${encodeURIComponent(location)}/0/0/0/${startRecord}/${PAGE_SIZE}/${DAYS}`;
      const url = new URL(`${base}${path}`);
      url.searchParams.set('companyName', String(entity?.name || '').trim());
      url.searchParams.set('showFilters', 'false');
      url.searchParams.set('enableJobDescriptionSnippet', 'true');
      url.searchParams.set('enableMetaData', 'true');
      const response = await fetch(url.toString(), {
        headers: { Authorization:`Bearer ${token}`, Accept:'application/json', 'User-Agent':'OccuMedHiringTrendDashboard/1.0' },
        signal: AbortSignal.timeout(getIngestTimeout(15000)),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json().catch(() => null);
      if (payload?.ErrorMessage) throw new Error(String(payload.ErrorMessage));
      const rows = Array.isArray(payload?.Jobs) ? payload.Jobs : [];
      total = numeric(payload?.JobCount, rows.length);
      pages++;
      if (!rows.length) break;
      for (const row of rows) {
        if (!employerEquivalent(entity, row?.Company)) continue;
        const applyUrl = normalizeUrl(row?.URL);
        if (!applyUrl || !row?.JobTitle) continue;
        const locationText = clean(row?.Location);
        jobs.push({
          external_id: String(row?.JvId || applyUrl),
          source: SOURCE,
          title: clean(row?.JobTitle),
          department: null,
          location: locationText,
          city: splitCity(locationText),
          state: splitState(locationText),
          country: 'US',
          lat: null,
          lng: null,
          is_remote: /\b(remote|virtual|work from home)\b/i.test(`${row?.JobTitle || ''} ${locationText || ''}`),
          is_overseas: false,
          // AcquisitionDate is when CareerOneStop/NLx acquired the row, not a
          // guaranteed employer posting date. Keep it as provenance only.
          posted_at: null,
          raw_data: {
            ...row,
            normalized_apply_url: applyUrl,
            normalized_employer: clean(row?.Company) || entity?.name || null,
            normalized_employer_source: 'careeronestop-nlx-mirror',
            source_graph_lineage: 'nlx',
            acquisition_date: row?.AcquisitionDate || null,
          },
        });
      }
      startRecord += rows.length;
      if (rows.length < PAGE_SIZE) break;
    }
    const unique = dedupe(jobs);
    const truncated = startRecord < total && pages >= MAX_PAGES;
    return { jobs:unique, check:{ source:SOURCE, source_class:'verified', status:unique.length?'success':'zero', jobs_found:unique.length, authoritative_zero:false, details:{ lineage_root:'nlx', role:'NLx resilience mirror', location, pages, reported_total:Number.isFinite(total)?total:null, truncated } } };
  } catch (error) {
    return { jobs:[], check:{ source:SOURCE, source_class:'verified', status:'error', jobs_found:0, authoritative_zero:false, details:{ lineage_root:'nlx', role:'NLx resilience mirror', location, error:message(error) } } };
  }
}

function employerEquivalent(entity:any,candidate:unknown) { const target=comparable(candidate); if(!target)return false; const names=[entity?.name,...(Array.isArray(entity?.aliases)?entity.aliases:[])].map(comparable).filter(Boolean); return names.some(name=>target===name||stripSuffix(target)===stripSuffix(name)||((target.includes(name)||name.includes(target))&&Math.min(target.length,name.length)>=7)); }
function stateHint(entity:any){const raw=String(entity?.government_state||entity?.state||'').trim().toUpperCase();return /^[A-Z]{2}$/.test(raw)?raw:null;}
function comparable(value:unknown){return String(value||'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();}
function stripSuffix(value:string){return value.replace(/\b(?:inc|incorporated|llc|ltd|limited|corp|corporation|company|co|holdings|group|plc)\b/g,' ').replace(/\s+/g,' ').trim();}
function normalizeUrl(value:unknown){try{const url=new URL(String(value||'').trim());return ['http:','https:'].includes(url.protocol)?url.toString():null;}catch{return null;}}
function clean(value:unknown){const text=String(value||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();return text||null;}
function splitCity(value?:string|null){return value&&!/^remote$/i.test(value)?value.split(',')[0]?.trim()||null:null;}
function splitState(value?:string|null){return value&&!/^remote$/i.test(value)?value.split(',')[1]?.trim()||null:null;}
function numeric(value:unknown,fallback:number){const n=Number(value);return Number.isFinite(n)&&n>=0?n:fallback;}
function dedupe(rows:any[]){const seen=new Set<string>();return rows.filter(row=>{const key=String(row?.raw_data?.normalized_apply_url||row?.external_id||'');if(!key||seen.has(key))return false;seen.add(key);return true;});}
function clampInt(value:unknown,fallback:number,min:number,max:number){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):fallback;}
function message(error:unknown){return error instanceof Error?error.message:String(error);}
