import { getIngestTimeout } from './http';

const MAX_JOB_URLS = clampInt(process.env.SITEMAP_JOB_MAX_URLS, 60, 10, 250);
const PAGE_CONCURRENCY = clampInt(process.env.SITEMAP_JOB_CONCURRENCY, 5, 1, 10);

export async function fetchSitemapJobs(sitemapUrl: string, entityName: string) {
  const urls = await collectJobUrls(sitemapUrl);
  if (!urls.length) return [];
  const rows = await mapWithConcurrency(urls.slice(0, MAX_JOB_URLS), PAGE_CONCURRENCY, url => fetchJobPosting(url, entityName));
  return rows.flat().filter(Boolean);
}

async function collectJobUrls(rootUrl: string) {
  const xml = await fetchText(rootUrl).catch(() => '');
  if (!xml) return [];
  const locs = readLocs(xml);
  if (/<sitemapindex\b/i.test(xml)) {
    const nested = locs.slice(0, 8).filter(url => /job|career|position|opening|vacan/i.test(url));
    const pages = await Promise.all(nested.map(url => fetchText(url).catch(() => '')));
    return dedupe(pages.flatMap(readLocs).filter(looksLikeJobUrl)).slice(0, MAX_JOB_URLS);
  }
  return dedupe(locs.filter(looksLikeJobUrl)).slice(0, MAX_JOB_URLS);
}

async function fetchJobPosting(url: string, entityName: string): Promise<any[]> {
  const html = await fetchText(url).catch(() => '');
  if (!html) return [];
  const objects = extractJsonLd(html);
  return objects.flatMap(object => normalizeJsonLd(object, url, entityName)).filter(Boolean);
}

function extractJsonLd(html: string) {
  const rows: any[] = [];
  const regex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const raw = decodeHtml(match[1]).trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) rows.push(...parsed);
      else if (Array.isArray(parsed?.['@graph'])) rows.push(...parsed['@graph']);
      else rows.push(parsed);
    } catch {}
  }
  return rows;
}

function normalizeJsonLd(object: any, pageUrl: string, entityName: string): any[] {
  if (!object || typeof object !== 'object') return [];
  if (Array.isArray(object)) return object.flatMap(row => normalizeJsonLd(row, pageUrl, entityName));
  const type = Array.isArray(object['@type']) ? object['@type'].join(' ') : String(object['@type'] || '');
  if (!/JobPosting/i.test(type)) return [];
  const title = clean(object.title || object.name);
  if (!title) return [];
  const hiringName = clean(object?.hiringOrganization?.name);
  if (hiringName && !employerCompatible(hiringName, entityName)) return [];
  const location = jsonLdLocation(object);
  const address = firstAddress(object);
  const country = normalizeCountry(address?.addressCountry || countryFromLocation(location));
  const applyUrl = normalizeUrl(object.url || object?.directApplyUrl || pageUrl) || pageUrl;
  return [{
    external_id: String(object.identifier?.value || object.identifier || object.jobId || applyUrl),
    source: 'official_sitemap',
    title,
    department: clean(object?.occupationalCategory || object?.industry),
    location,
    city: clean(address?.addressLocality) || splitCity(location),
    state: clean(address?.addressRegion) || splitState(location),
    country,
    lat: numberOrNull(object?.jobLocation?.geo?.latitude || address?.latitude),
    lng: numberOrNull(object?.jobLocation?.geo?.longitude || address?.longitude),
    is_remote: /TELECOMMUTE|remote|virtual/i.test(`${object.jobLocationType || ''} ${location || ''} ${title}`),
    is_overseas: country ? country !== 'US' : false,
    posted_at: normalizeDate(object.datePosted),
    raw_data: {
      normalized_apply_url: applyUrl,
      normalized_employer: hiringName || entityName,
      normalized_employer_source: 'official-jsonld-jobposting',
      sitemap_page_url: pageUrl,
      valid_through: object.validThrough || null,
      parser: 'jsonld-jobposting',
    },
  }];
}

function readLocs(xml: string) {
  const out: string[] = [];
  const regex = /<loc\b[^>]*>([\s\S]*?)<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const url = normalizeUrl(decodeHtml(match[1].trim()));
    if (url) out.push(url);
  }
  return out;
}
function looksLikeJobUrl(url: string) { try { const parsed = new URL(url); return /\/(?:job|jobs|career|careers|position|positions|opening|openings|vacanc|requisition)[^?#]*/i.test(parsed.pathname) || /(?:jobid|reqid|requisition|posting)=/i.test(parsed.search); } catch { return false; } }
function firstAddress(object: any) { const locations = Array.isArray(object.jobLocation) ? object.jobLocation : object.jobLocation ? [object.jobLocation] : []; return locations.map((row:any)=>row?.address).find(Boolean) || null; }
function jsonLdLocation(object: any) { const addr = firstAddress(object); const parts = [addr?.addressLocality, addr?.addressRegion, addr?.addressCountry].filter(Boolean).map(String); if (parts.length) return parts.join(', '); if (/TELECOMMUTE/i.test(String(object.jobLocationType || ''))) return 'Remote'; return null; }
function employerCompatible(a: string, b: string) { const left = comparable(a); const right = comparable(b); if (!left || !right) return true; return left === right || left.includes(right) || right.includes(left) || tokenOverlap(left,right) >= 0.6; }
function tokenOverlap(a:string,b:string) { const aa = new Set(a.split(' ').filter(token=>token.length>2)); const bb = new Set(b.split(' ').filter(token=>token.length>2)); if (!aa.size || !bb.size) return 0; let common=0; aa.forEach(token=>{ if(bb.has(token)) common++; }); return common / Math.min(aa.size,bb.size); }
function comparable(value: unknown) { return String(value || '').toLowerCase().replace(/\b(?:inc|llc|ltd|corp|corporation|company|co|holdings|group)\b/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim(); }
async function fetchText(url: string) { const response = await fetch(url,{redirect:'follow',headers:{'user-agent':'OccuMedHiringTrendDashboard/1.0',accept:'application/xml,text/xml,text/html,application/xhtml+xml;q=0.9,*/*;q=0.7'},signal:AbortSignal.timeout(getIngestTimeout(12000))}); if(!response.ok) throw new Error(`HTTP ${response.status}`); return response.text(); }
function decodeHtml(value:string) { return value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>'); }
function normalizeUrl(value: unknown) { try { const url = new URL(String(value || '').trim()); return ['http:','https:'].includes(url.protocol) ? url.toString() : null; } catch { return null; } }
function normalizeDate(value: unknown) { if (!value) return null; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function clean(value: unknown) { const text = String(value || '').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); return text || null; }
function splitCity(value?:string|null) { return value && !/^remote$/i.test(value) ? value.split(',')[0]?.trim() || null : null; }
function splitState(value?:string|null) { return value && !/^remote$/i.test(value) ? value.split(',')[1]?.trim() || null : null; }
function numberOrNull(value:unknown) { const n=Number(value); return Number.isFinite(n) ? n : null; }
function normalizeCountry(value:unknown) { const raw=clean(value); if(!raw) return null; const lower=raw.toLowerCase(); const map:Record<string,string>={us:'US',usa:'US','united states':'US','united states of america':'US',ca:'CA',canada:'CA',gb:'GB',uk:'GB','united kingdom':'GB',de:'DE',germany:'DE',au:'AU',australia:'AU',fr:'FR',france:'FR',it:'IT',italy:'IT',es:'ES',spain:'ES',pl:'PL',poland:'PL'}; return map[lower] || (/^[a-z]{2}$/i.test(raw)?raw.toUpperCase():null); }
function countryFromLocation(value?:string|null) { if(!value) return null; if(/\b(?:united states|usa|u\.s\.)\b/i.test(value)) return 'US'; if(/\bcanada\b/i.test(value)) return 'CA'; if(/\b(?:united kingdom|uk)\b/i.test(value)) return 'GB'; if(/\bgermany\b/i.test(value)) return 'DE'; if(/\baustralia\b/i.test(value)) return 'AU'; if(/\b[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}\b/.test(value)) return 'US'; return null; }
function dedupe(values:string[]) { return Array.from(new Set(values)); }
function clampInt(value:unknown,fallback:number,min:number,max:number) { const n=Number(value); return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):fallback; }
async function mapWithConcurrency<T,R>(items:T[],limit:number,worker:(item:T)=>Promise<R>):Promise<R[]> { const results=new Array<R>(items.length); let next=0; async function run(){ while(true){ const i=next++; if(i>=items.length)return; results[i]=await worker(items[i]); } } await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>run())); return results; }
