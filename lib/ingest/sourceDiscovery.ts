import { getIngestTimeout } from './http';

export type DiscoveredHiringSource = {
  source_key: string;
  source_type: string;
  source_url: string;
  ats_provider: string | null;
  board_id: string | null;
  source_class: 'authoritative' | 'verified' | 'supplemental';
  lineage_root: string;
  discovery_method: string;
  metadata: Record<string, any>;
};

const MAX_LINKS = clampInt(process.env.SOURCE_DISCOVERY_MAX_LINKS, 160, 20, 500);

export async function discoverHiringSurfaces(entity: any): Promise<DiscoveredHiringSource[]> {
  const seeds = [entity?.career_page_url, entity?.website].map(normalizeUrl).filter(Boolean) as string[];
  const sources: DiscoveredHiringSource[] = [];
  for (const seed of Array.from(new Set(seeds))) {
    const html = await fetchText(seed).catch(() => '');
    const root = safeOrigin(seed);
    if (!root) continue;
    if (html) {
      for (const link of extractLinks(html, seed).slice(0, MAX_LINKS)) {
        const detected = atsSource(link, 'official-page-link', sameRegistrableDomain(seed, link));
        if (detected) sources.push(detected);
      }
    }
    const robots = await fetchText(new URL('/robots.txt', root).toString()).catch(() => '');
    const sitemaps = extractSitemaps(robots, root);
    if (!sitemaps.length) {
      sitemaps.push(new URL('/sitemap.xml', root).toString());
      sitemaps.push(new URL('/sitemap_index.xml', root).toString());
    }
    for (const sitemap of Array.from(new Set(sitemaps)).slice(0, 8)) {
      const xml = await fetchText(sitemap).catch(() => '');
      if (!xml) continue;
      const locs = readLocs(xml);
      if (/<sitemapindex\b/i.test(xml)) {
        const jobMaps = locs.filter(url => /job|career|position|opening|vacan/i.test(url)).slice(0, 12);
        for (const nested of jobMaps) {
          const nestedXml = await fetchText(nested).catch(() => '');
          if (nestedXml && readLocs(nestedXml).some(looksLikeJobUrl)) sources.push(sitemapSource(nested, root));
        }
      } else if (locs.some(looksLikeJobUrl)) {
        sources.push(sitemapSource(sitemap, root));
      }
      for (const loc of locs.slice(0, MAX_LINKS)) {
        const detected = atsSource(loc, 'sitemap-link', sameRegistrableDomain(seed, loc));
        if (detected) sources.push(detected);
      }
    }
  }

  if (entity?.name) {
    const langSources = await discoverViaLangSearch(entity).catch(() => []);
    sources.push(...langSources);
  }
  return dedupeSources(sources).slice(0, 40);
}

async function discoverViaLangSearch(entity:any):Promise<DiscoveredHiringSource[]> {
  const keys=readLangSearchKeys(); if(!keys.length)return[];
  const query=`Find official career sites and applicant tracking system job boards for "${String(entity.name).replace(/"/g,'')}" including subsidiaries, acquired companies, international boards, and alternate hiring portals. Return official employer or ATS URLs.`;
  for(const key of keys){
    try{
      const response=await fetch(process.env.LANGSEARCH_ENDPOINT||'https://api.langsearch.com/v1/web-search',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({query,count:10,freshness:process.env.LANGSEARCH_FRESHNESS||'oneMonth'}),signal:AbortSignal.timeout(getIngestTimeout(12000))});
      if(!response.ok)continue;
      const payload=await response.json().catch(()=>null);
      const pages=Array.isArray(payload?.data?.webPages?.value)?payload.data.webPages.value:[];
      const out:DiscoveredHiringSource[]=[];
      for(const page of pages){const url=normalizeUrl(page?.url||page?.displayUrl);if(!url)continue;const ats=atsSource(url,'langsearch',false);if(ats)out.push(ats);else if(looksLikeCareerLanding(url,page?.name))out.push(careerSource(url,'langsearch'));}
      return out;
    }catch{}
  }
  return[];
}

// A sitemap is an official-domain discovery surface, but this parser intentionally
// samples bounded job URLs and only accepts structured JobPosting JSON-LD. It is
// therefore corroborating evidence, not proof that the employer's full inventory
// was enumerated. Never let a zero sitemap sample masquerade as an authoritative zero.
function sitemapSource(url:string,root:string):DiscoveredHiringSource { return { source_key:`sitemap:${hashString(url)}`, source_type:'sitemap', source_url:url, ats_provider:null, board_id:null, source_class:'verified', lineage_root:`official-domain:${registrableHost(safeHost(root))}`, discovery_method:'robots/sitemap', metadata:{ structured_only:true, enumeration_complete:false, bounded_sample:true } }; }
function extractSitemaps(text:string,root:string){const out:string[]=[];const regex=/^\s*Sitemap:\s*(\S+)\s*$/gim;let match:RegExpExecArray|null;while((match=regex.exec(text))!==null){const url=normalizeUrl(match[1]);if(url)out.push(url);else try{out.push(new URL(match[1],root).toString());}catch{}}return out;}
function safeOrigin(value:string){try{return new URL(value).origin;}catch{return null;}}

function atsSource(value:string,method:string,authoritativeDomain:boolean):DiscoveredHiringSource|null {
  let url:URL;try{url=new URL(value);}catch{return null;}
  const host=url.hostname.toLowerCase();const path=url.pathname;
  let provider:string|null=null;let board:string|null=null;
  const greenhouse=value.match(/(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([^/?#&]+)/i)||value.match(/[?&]for=([^&#]+).*greenhouse/i);
  if(greenhouse?.[1]){provider='greenhouse';board=cleanToken(greenhouse[1]);}
  else { const lever=value.match(/jobs\.lever\.co\/([^/?#&]+)/i); if(lever?.[1]){provider='lever';board=cleanToken(lever[1]);} }
  if(!provider){const ashby=value.match(/jobs\.ashbyhq\.com\/([^/?#&]+)/i);if(ashby?.[1]){provider='ashby';board=cleanToken(ashby[1]);}}
  if(!provider){const recruitee=host.match(/^([^.]+)\.recruitee\.com$/i);if(recruitee?.[1]){provider='recruitee';board=cleanToken(recruitee[1]);}}
  if(!provider){const smart=value.match(/jobs\.smartrecruiters\.com\/([^/?#&]+)/i);if(smart?.[1]){provider='smartrecruiters';board=cleanToken(smart[1]);}}
  if(!provider){const bamboo=host.match(/^([^.]+)\.bamboohr\.com$/i);if(bamboo?.[1]&&/\/careers/i.test(path)){provider='bamboohr';board=cleanToken(bamboo[1]);}}
  if(!provider && /myworkdayjobs\.com|myworkdaysite\.com|workdayjobs\.com/i.test(host)){provider='workday';board=canonicalWorkday(value);}
  if(!provider && /apply\.workable\.com$/i.test(host)){provider='workable';board=firstPath(path);}
  if(!provider && /jobs\.personio\.(?:com|de)$/i.test(host)){provider='personio';board=host.split('.')[0];}
  if(!provider && /governmentjobs\.com$/i.test(host)){provider='governmentjobs';board=path.match(/\/careers\/([^/?#]+)/i)?.[1]||null;}
  if(!provider && /icims\.com$/i.test(host)){provider='icims';board=firstPath(path);}
  if(!provider && /taleo\.net$/i.test(host)){provider='taleo';board=firstPath(path);}
  if(!provider && /oraclecloud\.com$/i.test(host)){provider='oracle';board=firstPath(path);}
  if(!provider && /successfactors\.com$/i.test(host)){provider='successfactors';board=firstPath(path);}
  if(!provider && /jobvite\.com$/i.test(host)){provider='jobvite';board=firstPath(path);}
  if(!provider && /teamtailor\.com$/i.test(host)){provider='teamtailor';board=host.split('.')[0];}
  if(!provider && /applytojob\.com$/i.test(host)){provider='jazzhr';board=firstPath(path);}
  if(!provider && /dayforcehcm\.com$/i.test(host)){provider='dayforce';board=path.split('/').filter(Boolean)[1]||null;}
  if(!provider && /ultipro\.com$|ukg\.com$/i.test(host)){provider='ukg';board=firstPath(path);}
  if(!provider && /workforcenow\.adp\.com$/i.test(host)){provider='adp';board=firstPath(path);}
  if(!provider && /recruiting\.paylocity\.com$/i.test(host)){provider='paylocity';board=firstPath(path);}
  if(!provider && /paycomonline\.net$/i.test(host)){provider='paycom';board=firstPath(path);}
  if(!provider && /(?:csod|csodfed|cornerstoneondemand)\.(?:com|net)$/i.test(host)){provider='cornerstone';board=host.split('.')[0];}
  if(!provider && /avature\.net$/i.test(host)){provider='avature';board=host.split('.')[0];}
  if(!provider && /eightfold\.ai$/i.test(host)){provider='eightfold';board=firstPath(path);}
  if(!provider && /phenom\.com$/i.test(host)){provider='phenom';board=firstPath(path);}

  if(!provider)return null;
  const keyMaterial=`${provider}|${board||normalizeUrl(value)}`;
  return {source_key:`ats:${provider}:${hashString(keyMaterial)}`,source_type:'ats',source_url:value,ats_provider:provider,board_id:board,source_class:authoritativeDomain?'authoritative':'verified',lineage_root:`ats:${provider}:${board||registrableHost(host)}`,discovery_method:method,metadata:{host}};
}

function careerSource(url:string,method:string):DiscoveredHiringSource { const host=safeHost(url);return {source_key:`career:${hashString(url)}`,source_type:'career_page',source_url:url,ats_provider:null,board_id:null,source_class:'authoritative',lineage_root:`official-domain:${registrableHost(host)}`,discovery_method:method,metadata:{}}; }
function extractLinks(html:string,base:string){const out:string[]=[];const regex=/(?:href|src)=["']([^"']+)["']/gi;let match:RegExpExecArray|null;while((match=regex.exec(html))!==null){const raw=match[1];if(!raw||raw.startsWith('#')||raw.startsWith('mailto:')||raw.startsWith('tel:'))continue;try{out.push(new URL(raw,base).toString());}catch{}}return dedupe(out);}
function readLocs(xml:string){const out:string[]=[];const regex=/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi;let match:RegExpExecArray|null;while((match=regex.exec(xml))!==null){const url=normalizeUrl(match[1].replace(/&amp;/g,'&').trim());if(url)out.push(url);}return out.slice(0,300);}
function looksLikeJobUrl(value:string){try{const url=new URL(value);return /\/(?:job|jobs|position|positions|opening|openings|vacanc|requisition)[^?#]*/i.test(url.pathname)||/(?:jobid|reqid|requisition|posting)=/i.test(url.search);}catch{return false;}}
function looksLikeCareerLanding(url:string,title:unknown){return /\b(career|careers|jobs|employment|open positions|join us)\b/i.test(`${url} ${String(title||'')}`);}
async function fetchText(url:string){const response=await fetch(url,{redirect:'follow',headers:{'user-agent':'OccuMedHiringTrendDashboard/1.0',accept:'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.7'},signal:AbortSignal.timeout(getIngestTimeout(10000))});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.text();}
function readLangSearchKeys(){return Array.from(new Set(['LANGSEARCH_API_KEY','LANGSEARCH-API-KEY','LANG_SEARCH_API_KEY','LANGSEARCH_API_KEY_2','LANGSEARCH-API-KEY-2','LANG_SEARCH_API_KEY_2'].map(name=>String(process.env[name]||'').trim()).filter(Boolean)));}
function canonicalWorkday(value:string){try{const url=new URL(value);const parts=url.pathname.split('/').filter(Boolean);if(parts[0]?.match(/^[a-z]{2}-[A-Z]{2}$/))parts.shift();return parts[0]?`${url.origin}/${parts[0]}`:url.origin;}catch{return value;}}
function firstPath(path:string){return path.split('/').filter(Boolean)[0]||null;}
function cleanToken(value:string){return decodeURIComponent(value).replace(/[^a-z0-9._-]/gi,'').slice(0,120)||null;}
function sameRegistrableDomain(a:string,b:string){try{return registrableHost(new URL(a).hostname)===registrableHost(new URL(b).hostname);}catch{return false;}}
function registrableHost(host:string){const parts=String(host||'').toLowerCase().replace(/^www\./,'').split('.');return parts.length>=2?parts.slice(-2).join('.'):parts[0]||'';}
function safeHost(value:string){try{return new URL(value).hostname;}catch{return '';}}
function normalizeUrl(value:unknown){try{const url=new URL(String(value||'').trim());return ['http:','https:'].includes(url.protocol)?url.toString():null;}catch{return null;}}
function dedupe(values:string[]){return Array.from(new Set(values));}
function dedupeSources(rows:DiscoveredHiringSource[]){const seen=new Set<string>();return rows.filter(row=>{const key=`${row.source_type}|${row.ats_provider||''}|${row.board_id||''}|${normalizeUrl(row.source_url)||row.source_url}`;if(seen.has(key))return false;seen.add(key);return true;});}
function hashString(value:string){let hash=2166136261;for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(36);}
function clampInt(value:unknown,fallback:number,min:number,max:number){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):fallback;}
