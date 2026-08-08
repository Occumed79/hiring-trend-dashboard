import { getIngestTimeout } from './http';

export type DiscoveredHiringSource = {
  source_key: string;
  source_type: 'ats' | 'career_page' | 'sitemap';
  source_url: string;
  ats_provider: string | null;
  board_id: string | null;
  source_class: 'authoritative' | 'verified';
  lineage_root: string;
  discovery_method: string;
  metadata: Record<string, any>;
};

const MAX_LINKS = clampInt(process.env.SOURCE_DISCOVERY_MAX_LINKS, 160, 20, 500);

export async function discoverHiringSurfaces(entity: any): Promise<DiscoveredHiringSource[]> {
  const seeds = [entity?.career_page_url, entity?.government_website, entity?.website].map(normalizeUrl).filter(Boolean) as string[];
  const found: DiscoveredHiringSource[] = [];

  for (const seed of dedupe(seeds).slice(0, 3)) {
    found.push(sourceFromUrl(seed, 'stored-or-official-page', true) || careerSource(seed, 'stored-or-official-page'));
    const html = await fetchText(seed).catch(() => '');
    if (html) {
      for (const url of extractLinks(html, seed).slice(0, MAX_LINKS)) {
        const source = sourceFromUrl(url, 'official-page-link', sameRegistrableDomain(url, seed));
        if (source) found.push(source);
      }
    }
    found.push(...await discoverSitemaps(seed));
  }

  found.push(...await discoverViaLangSearch(entity));
  return dedupeSources(found);
}

async function discoverSitemaps(seed: string): Promise<DiscoveredHiringSource[]> {
  let origin: URL;
  try { origin = new URL(seed); } catch { return []; }
  const candidates = new Set<string>([`${origin.origin}/sitemap.xml`]);
  const robots = await fetchText(`${origin.origin}/robots.txt`).catch(() => '');
  for (const line of robots.split(/\r?\n/)) {
    const match = line.match(/^\s*Sitemap\s*:\s*(https?:\/\/\S+)/i);
    if (match?.[1]) candidates.add(match[1].trim());
  }

  const out: DiscoveredHiringSource[] = [];
  for (const sitemap of Array.from(candidates).slice(0, 6)) {
    const xml = await fetchText(sitemap).catch(() => '');
    if (!xml) continue;
    const locs = readLocs(xml);
    const hasJobSignal = locs.some(url => looksLikeJobUrl(url) || /job|career|position|opening|vacan/i.test(url));
    if (!hasJobSignal) continue;
    out.push({
      source_key: `sitemap:${hashString(sitemap)}`,
      source_type: 'sitemap',
      source_url: sitemap,
      ats_provider: null,
      board_id: null,
      source_class: 'authoritative',
      lineage_root: `official-domain:${registrableHost(origin.hostname)}`,
      discovery_method: 'robots-or-sitemap',
      metadata: { seed, loc_count_sampled: locs.length },
    });
  }
  return out;
}

async function discoverViaLangSearch(entity: any): Promise<DiscoveredHiringSource[]> {
  const keys = readLangSearchKeys();
  if (!keys.length || !entity?.name) return [];
  const endpoint = process.env.LANGSEARCH_API_URL || process.env.LANGSEARCH_ENDPOINT || 'https://api.langsearch.com/v1/web-search';
  const query = `Find every official careers page and applicant-tracking-system job board operated by "${String(entity.name).replace(/"/g,'')}". Include distinct subsidiary, international, acquired-company, and alternate hiring portals. Return career landing pages and ATS board pages, not individual job-detail pages.`;

  for (const key of keys) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, freshness: 'oneMonth', summary: true, count: 10 }),
        signal: AbortSignal.timeout(getIngestTimeout(12000)),
      });
      if (!response.ok) {
        if ([401,402,403,429].includes(response.status)) continue;
        return [];
      }
      const payload = await response.json().catch(() => null);
      const pages = Array.isArray(payload?.data?.webPages?.value) ? payload.data.webPages.value : [];
      return pages.flatMap((page: any) => {
        const url = normalizeUrl(page?.url || page?.displayUrl);
        if (!url) return [];
        const source = sourceFromUrl(url, 'verified-web-source-discovery', false);
        if (source) return [{ ...source, source_class: 'verified' as const, metadata: { ...source.metadata, search_title: page?.name || null, search_snippet: page?.snippet || null } }];
        if (looksLikeCareerLanding(url, page?.name)) return [{ ...careerSource(url, 'verified-web-source-discovery'), source_class: 'verified' as const, metadata: { search_title: page?.name || null } }];
        return [];
      });
    } catch {}
  }
  return [];
}

function sourceFromUrl(value: string, method: string, authoritativeDomain: boolean): DiscoveredHiringSource | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  let provider: string | null = null;
  let board: string | null = null;

  let match = value.match(/(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([^/?#&]+)/i);
  if (match?.[1]) { provider='greenhouse'; board=cleanToken(match[1]); }
  else if ((match=value.match(/jobs\.lever\.co\/([^/?#&]+)/i))?.[1]) { provider='lever'; board=cleanToken(match[1]); }
  else if ((match=value.match(/jobs\.ashbyhq\.com\/([^/?#&]+)/i))?.[1]) { provider='ashby'; board=cleanToken(match[1]); }
  else if ((match=host.match(/^([^.]+)\.recruitee\.com$/i))?.[1]) { provider='recruitee'; board=cleanToken(match[1]); }
  else if ((match=value.match(/jobs\.smartrecruiters\.com\/([^/?#&]+)/i))?.[1]) { provider='smartrecruiters'; board=cleanToken(match[1]); }
  else if ((match=host.match(/^([^.]+)\.bamboohr\.com$/i))?.[1] && /\/careers/i.test(path)) { provider='bamboohr'; board=cleanToken(match[1]); }
  else if (/myworkdayjobs\.com|myworkdaysite\.com|workdayjobs\.com/i.test(host)) { provider='workday'; board=canonicalWorkday(value); }
  else if (/apply\.workable\.com$/i.test(host)) { provider='workable'; board=firstPath(path); }
  else if (/jobs\.personio\.(?:de|com)$/i.test(host)) { provider='personio'; board=host.split('.')[0]; }
  else if (/governmentjobs\.com$/i.test(host)) { provider='governmentjobs'; board=path.match(/\/careers\/([^/?#]+)/i)?.[1] || null; }
  else if (/icims\.com$/i.test(host)) { provider='icims'; board=firstPath(path); }
  else if (/taleo\.net$/i.test(host)) { provider='taleo'; board=firstPath(path); }
  else if (/successfactors\.com$/i.test(host)) { provider='successfactors'; board=firstPath(path); }
  else if (/jobvite\.com$/i.test(host)) { provider='jobvite'; board=firstPath(path); }
  else if (/teamtailor\.com$/i.test(host)) { provider='teamtailor'; board=host.split('.')[0]; }
  else if (/applytojob\.com$/i.test(host)) { provider='jazzhr'; board=firstPath(path); }
  else if (/dayforcehcm\.com$/i.test(host)) { provider='dayforce'; board=path.split('/').filter(Boolean)[1] || null; }
  else if (/ultipro\.com$|ukg\.com$/i.test(host)) { provider='ukg'; board=firstPath(path); }
  else if (/workforcenow\.adp\.com$/i.test(host)) { provider='adp'; board=firstPath(path); }
  else if (/recruiting\.paylocity\.com$/i.test(host)) { provider='paylocity'; board=firstPath(path); }
  else if (/paycomonline\.net$/i.test(host)) { provider='paycom'; board=firstPath(path); }
  else if (/csod\.com$/i.test(host)) { provider='cornerstone'; board=host.split('.')[0]; }
  else if (/avature\.net$/i.test(host)) { provider='avature'; board=host.split('.')[0]; }
  else if (/eightfold\.ai$/i.test(host)) { provider='eightfold'; board=firstPath(path); }
  else if (/phenom\.com$/i.test(host)) { provider='phenom'; board=firstPath(path); }

  if (!provider) return null;
  const keyMaterial = `${provider}|${board || normalizeUrl(value)}`;
  return {
    source_key: `ats:${provider}:${hashString(keyMaterial)}`,
    source_type: 'ats',
    source_url: value,
    ats_provider: provider,
    board_id: board,
    source_class: authoritativeDomain ? 'authoritative' : 'verified',
    lineage_root: `ats:${provider}:${board || registrableHost(host)}`,
    discovery_method: method,
    metadata: { host },
  };
}

function careerSource(url: string, method: string): DiscoveredHiringSource {
  const host = safeHost(url);
  return { source_key:`career:${hashString(url)}`, source_type:'career_page', source_url:url, ats_provider:null, board_id:null, source_class:'authoritative', lineage_root:`official-domain:${registrableHost(host)}`, discovery_method:method, metadata:{} };
}
function extractLinks(html:string,base:string) { const out:string[]=[]; const regex=/(?:href|src)=["']([^"']+)["']/gi; let match:RegExpExecArray|null; while((match=regex.exec(html))!==null){ const raw=match[1]; if(!raw||raw.startsWith('#')||raw.startsWith('mailto:')||raw.startsWith('tel:'))continue; try{out.push(new URL(raw,base).toString());}catch{} } return dedupe(out); }
function readLocs(xml:string) { const out:string[]=[]; const regex=/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi; let match:RegExpExecArray|null; while((match=regex.exec(xml))!==null){ const url=normalizeUrl(match[1].replace(/&amp;/g,'&').trim()); if(url)out.push(url); } return out.slice(0,300); }
function looksLikeJobUrl(value:string) { try{ const url=new URL(value); return /\/(?:job|jobs|position|positions|opening|openings|vacanc|requisition)[^?#]*/i.test(url.pathname)||/(?:jobid|reqid|requisition|posting)=/i.test(url.search);}catch{return false;} }
function looksLikeCareerLanding(url:string,title:unknown) { return /\b(career|careers|jobs|employment|open positions|join us)\b/i.test(`${url} ${String(title||'')}`); }
async function fetchText(url:string) { const response=await fetch(url,{redirect:'follow',headers:{'user-agent':'OccuMedHiringTrendDashboard/1.0',accept:'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.7'},signal:AbortSignal.timeout(getIngestTimeout(10000))}); if(!response.ok)throw new Error(`HTTP ${response.status}`); return response.text(); }
function readLangSearchKeys(){ return Array.from(new Set(['LANGSEARCH_API_KEY','LANGSEARCH-API-KEY','LANG_SEARCH_API_KEY','LANGSEARCH_API_KEY_2','LANGSEARCH-API-KEY-2','LANG_SEARCH_API_KEY_2'].map(name=>String(process.env[name]||'').trim()).filter(Boolean))); }
function canonicalWorkday(value:string){ try{const url=new URL(value); const parts=url.pathname.split('/').filter(Boolean); if(parts[0]?.match(/^[a-z]{2}-[A-Z]{2}$/))parts.shift(); return parts[0]?`${url.origin}/${parts[0]}`:url.origin;}catch{return value;} }
function firstPath(path:string){return path.split('/').filter(Boolean)[0]||null;}
function cleanToken(value:string){return decodeURIComponent(value).replace(/[^a-z0-9._-]/gi,'').slice(0,120)||null;}
function sameRegistrableDomain(a:string,b:string){try{return registrableHost(new URL(a).hostname)===registrableHost(new URL(b).hostname);}catch{return false;}}
function registrableHost(host:string){const parts=String(host||'').toLowerCase().replace(/^www\./,'').split('.'); return parts.length>=2?parts.slice(-2).join('.'):parts[0]||'';}
function safeHost(value:string){try{return new URL(value).hostname;}catch{return '';}}
function normalizeUrl(value:unknown){try{const url=new URL(String(value||'').trim());return ['http:','https:'].includes(url.protocol)?url.toString():null;}catch{return null;}}
function dedupe(values:string[]){return Array.from(new Set(values));}
function dedupeSources(rows:DiscoveredHiringSource[]){const seen=new Set<string>();return rows.filter(row=>{const key=`${row.source_type}|${row.ats_provider||''}|${row.board_id||''}|${normalizeUrl(row.source_url)||row.source_url}`;if(seen.has(key))return false;seen.add(key);return true;});}
function hashString(value:string){let hash=2166136261;for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(36);}
function clampInt(value:unknown,fallback:number,min:number,max:number){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):fallback;}
