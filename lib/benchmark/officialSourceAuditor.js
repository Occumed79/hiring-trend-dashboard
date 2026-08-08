'use strict';

const DEFAULT_TIMEOUT_MS = clampInt(process.env.BENCHMARK_AUDIT_TIMEOUT_MS, 15000, 2000, 60000);
const MAX_PAGES = clampInt(process.env.BENCHMARK_AUDIT_MAX_PAGES, 250, 1, 500);
const USER_AGENT = 'OccuMedHiringTrendBenchmarkAuditor/1.0';

async function auditOfficialSource(entity, source) {
  const provider = text(source?.ats_provider || entity?.ats_provider).toLowerCase();
  const boardId = text(source?.board_id || entity?.ats_board_id);
  const sourceUrl = normalizeUrl(source?.source_url || entity?.career_page_url);
  const shared = source?.metadata?.shared_inventory === true;
  const sourceClass = text(source?.source_class || 'authoritative').toLowerCase();
  const verified = source?.is_verified === true || sourceClass === 'authoritative';

  if (!verified || shared || sourceClass !== 'authoritative') {
    return unsupported('source is not a dedicated verified authoritative inventory', sourceUrl);
  }

  try {
    if (provider === 'governmentjobs' || provider === 'neogov' || isGovernmentJobsUrl(sourceUrl) || isGovernmentJobsUrl(boardId)) {
      return await auditGovernmentJobs(boardId, sourceUrl);
    }
    if (provider === 'usajobs') return await auditUsaJobs(boardId, entity);
    if (provider === 'workday') return await auditWorkday(boardId || sourceUrl);
    if (provider === 'greenhouse') return await auditGreenhouse(boardId);
    if (provider === 'lever') return await auditLever(boardId);
    if (provider === 'smartrecruiters') return await auditSmartRecruiters(boardId);
    if (provider === 'bamboohr') return await auditBambooHr(boardId);
    if (provider === 'ashby') return await auditAshby(boardId);
    if (provider === 'recruitee') return await auditRecruitee(boardId);
    if (provider === 'workable') return await auditWorkable(boardId);
    if (provider === 'personio') return await auditPersonio(boardId);

    const name = normalizeName(entity?.name);
    if (/\b(?:v2x|vectrus)\b/.test(name) && sourceUrl) return await auditJibe(sourceUrl);
    if (/\bids international\b/.test(name) && sourceUrl) return await auditJazzHr(sourceUrl);
    if (/\bamentum\b/.test(name) && sourceUrl && /amentumcareers\.com$/i.test(new URL(sourceUrl).hostname)) return await auditAmentum(sourceUrl);

    return unsupported(`no independent auditor for ${provider || 'this source family'}`, sourceUrl);
  } catch (error) {
    return { status:'error', complete:false, sourceUrl, sourceLabel:provider || 'official source', officialCount:null, jobUrls:[], metadata:{ error:message(error) } };
  }
}

async function auditGovernmentJobs(boardId, sourceUrl) {
  const slug = governmentJobsSlug(boardId, sourceUrl);
  if (!slug) return unsupported('GovernmentJobs agency slug unavailable', sourceUrl);
  const feedUrl = `https://www.governmentjobs.com/SearchEngine/JobsFeed?agency=${encodeURIComponent(slug)}`;
  const response = await fetchText(feedUrl, 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.7');
  if (!/<rss\b/i.test(response) || !/<channel\b/i.test(response)) throw new Error('response was not RSS');
  const blocks = Array.from(response.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi), match => match[1]);
  const urls=[];
  let invalid=0;
  for(const block of blocks){const link=normalizeUrl(readXmlTag(block,'link')||readXmlTag(block,'guid'));if(link)urls.push(link);else invalid++;}
  if(invalid>0)return incomplete('GovernmentJobs RSS contained unparseable items',feedUrl,blocks.length,urls,{invalid_items:invalid,agency:slug});
  return complete('GovernmentJobs / NEOGOV RSS',feedUrl,blocks.length,urls,{agency:slug,rss_items:blocks.length});
}

async function auditUsaJobs(organizationCode, entity) {
  const apiKey=text(process.env.USAJOBS_API_KEY), userAgent=text(process.env.USAJOBS_USER_AGENT||process.env.USAJOBS_EMAIL);
  if(!apiKey||!userAgent)return unsupported('USAJOBS credentials unavailable',null);
  if(!organizationCode)return unsupported('USAJOBS organization code unavailable',null);
  const urls=[];let reportedTotal=null;let numberOfPages=1;let scanned=0;
  const perPage=500;
  for(let page=1;page<=Math.min(MAX_PAGES,numberOfPages);page++){
    const url=new URL('https://data.usajobs.gov/api/search');
    url.searchParams.set('Organization',organizationCode);url.searchParams.set('ResultsPerPage',String(perPage));url.searchParams.set('Page',String(page));url.searchParams.set('Fields','Full');
    const payload=await fetchJson(url.toString(),{'Authorization-Key':apiKey,'User-Agent':userAgent,Host:'data.usajobs.gov'});
    const search=payload?.SearchResult||{};reportedTotal=nonNegativeOrNull(search.SearchResultCountAll??search.SearchResultCount)??0;
    numberOfPages=positiveInt(search?.UserArea?.NumberOfPages,Math.max(1,Math.ceil(reportedTotal/perPage)));
    const rows=Array.isArray(search.SearchResultItems)?search.SearchResultItems:[];scanned++;
    for(const item of rows){const pos=item?.MatchedObjectDescriptor||{};const apply=firstUrl(pos.ApplyURI)||normalizeUrl(pos.PositionURI);if(apply)urls.push(apply);}
    if(!rows.length||page>=numberOfPages)break;
  }
  const unique=uniqueUrls(urls);
  const completeInventory=numberOfPages<=MAX_PAGES && reportedTotal!==null && unique.length>=reportedTotal;
  if(!completeInventory)return incomplete('USAJOBS audit did not enumerate the reported inventory','https://data.usajobs.gov/api/search',reportedTotal,unique,{organization_code:organizationCode,pages_scanned:scanned,number_of_pages:numberOfPages,entity:entity?.name||null});
  return complete('USAJOBS official API','https://data.usajobs.gov/api/search',reportedTotal,unique,{organization_code:organizationCode,pages_scanned:scanned,number_of_pages:numberOfPages});
}

async function auditWorkday(value) {
  const config=parseWorkday(value);if(!config)return unsupported('Workday tenant/site could not be parsed',normalizeUrl(value));
  const urls=[];let offset=0,total=null,pages=0;const limit=50;
  while(pages<MAX_PAGES){
    const payload=await fetchJson(config.endpoint,{}, { method:'POST', body:JSON.stringify({appliedFacets:{},limit,offset,searchText:''}), headers:{'Content-Type':'application/json'} });
    const rows=Array.isArray(payload?.jobPostings)?payload.jobPostings:[];
    total=nonNegativeOrNull(payload?.total)??rows.length;pages++;
    for(const row of rows){const path=text(row?.externalPath);if(path)urls.push(new URL(`${config.languagePrefix}/${config.site}${path.startsWith('/')?path:`/${path}`}`,config.origin).toString());}
    offset+=rows.length;if(!rows.length||offset>=total||rows.length<limit)break;
  }
  const unique=uniqueUrls(urls);const done=total!==null&&unique.length>=total;
  if(!done)return incomplete('Workday audit did not enumerate the reported inventory',config.sourceUrl,total,unique,{pages,tenant:config.tenant,site:config.site});
  return complete('Workday official career API',config.sourceUrl,total,unique,{pages,tenant:config.tenant,site:config.site});
}

async function auditGreenhouse(board) {
  if(!board)return unsupported('Greenhouse board ID unavailable',null);
  const url=`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=false`;
  const payload=await fetchJson(url);const rows=Array.isArray(payload?.jobs)?payload.jobs:[];
  const urls=uniqueUrls(rows.map(row=>row?.absolute_url));
  if(rows.length!==urls.length)return incomplete('Greenhouse returned rows without posting URLs',url,rows.length,urls,{board});
  return complete('Greenhouse official job board API',url,rows.length,urls,{board});
}

async function auditLever(board) {
  if(!board)return unsupported('Lever board ID unavailable',null);
  const url=`https://api.lever.co/v0/postings/${encodeURIComponent(board)}?mode=json`;
  const payload=await fetchJson(url);const rows=Array.isArray(payload)?payload:[];
  const urls=uniqueUrls(rows.map(row=>row?.hostedUrl||row?.applyUrl));
  if(rows.length!==urls.length)return incomplete('Lever returned rows without posting URLs',url,rows.length,urls,{board});
  return complete('Lever official postings API',url,rows.length,urls,{board});
}

async function auditSmartRecruiters(board) {
  if(!board)return unsupported('SmartRecruiters company identifier unavailable',null);
  const base=`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(board)}/postings`;let offset=0,total=null,pages=0;const limit=100;const ids=[];
  while(pages<MAX_PAGES){const url=new URL(base);url.searchParams.set('limit',String(limit));url.searchParams.set('offset',String(offset));const payload=await fetchJson(url.toString());const rows=Array.isArray(payload?.content)?payload.content:[];total=nonNegativeOrNull(payload?.totalFound??payload?.total)??rows.length;for(const row of rows){if(row?.id)ids.push(String(row.id));}pages++;offset+=rows.length;if(!rows.length||offset>=total||rows.length<limit)break;}
  if(total===null||ids.length<total)return incomplete('SmartRecruiters audit did not enumerate all posting IDs',base,total,[],{board,pages,ids_collected:ids.length});
  return complete('SmartRecruiters official postings API',base,total,[],{board,pages,posting_ids:ids.slice(0,5000),count_only:true});
}

async function auditBambooHr(board) {
  if(!board)return unsupported('BambooHR subdomain unavailable',null);
  const slug=sanitizeToken(board);const url=`https://${slug}.bamboohr.com/careers/list`;const payload=await fetchJson(url);const rows=Array.isArray(payload?.result)?payload.result:Array.isArray(payload)?payload:[];
  return complete('BambooHR official careers feed',url,rows.length,[],{board:slug,job_ids:rows.map(row=>String(row?.id||row?.jobOpeningId||'')).filter(Boolean),count_only:true});
}

async function auditAshby(board) {
  if(!board)return unsupported('Ashby board ID unavailable',null);
  const url=`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=false`;const payload=await fetchJson(url);const rows=(Array.isArray(payload?.jobs)?payload.jobs:[]).filter(row=>row?.isListed!==false);
  const urls=uniqueUrls(rows.map(row=>row?.jobUrl||row?.applyUrl||row?.url));
  if(rows.length!==urls.length)return incomplete('Ashby returned listed rows without posting URLs',url,rows.length,urls,{board});
  return complete('Ashby official job board API',url,rows.length,urls,{board});
}

async function auditRecruitee(board) {
  if(!board)return unsupported('Recruitee subdomain unavailable',null);
  const slug=sanitizeToken(board);const url=`https://${slug}.recruitee.com/api/offers/`;const payload=await fetchJson(url);const rows=(Array.isArray(payload?.offers)?payload.offers:Array.isArray(payload)?payload:[]).filter(row=>!row?.status||String(row.status).toLowerCase()==='published');
  const urls=uniqueUrls(rows.map(row=>row?.careers_url||row?.careers_apply_url||row?.url));
  if(rows.length!==urls.length)return incomplete('Recruitee returned published rows without posting URLs',url,rows.length,urls,{board:slug});
  return complete('Recruitee official careers API',url,rows.length,urls,{board:slug});
}

async function auditWorkable(board) {
  if(!board)return unsupported('Workable account unavailable',null);
  const slug=sanitizeToken(board);const url=`https://www.workable.com/api/accounts/${encodeURIComponent(slug)}?details=true`;const payload=await fetchJson(url);const rows=Array.isArray(payload?.jobs)?payload.jobs:Array.isArray(payload?.results)?payload.results:Array.isArray(payload)?payload:[];
  const urls=uniqueUrls(rows.map(row=>row?.url||row?.shortlink||row?.application_url||row?.shortlink_url));
  if(rows.length!==urls.length)return incomplete('Workable returned rows without posting URLs',url,rows.length,urls,{board:slug});
  return complete('Workable official account feed',url,rows.length,urls,{board:slug});
}

async function auditPersonio(board) {
  if(!board)return unsupported('Personio account unavailable',null);
  const slug=sanitizeToken(board);
  for(const host of [`${slug}.jobs.personio.de`,`${slug}.jobs.personio.com`]){const url=`https://${host}/xml`;try{const xml=await fetchText(url,'application/xml,text/xml;q=0.9,*/*;q=0.7');if(!/<position\b/i.test(xml))continue;const blocks=splitXmlBlocks(xml,'position');const urls=[];let invalid=0;for(const block of blocks){const id=text(readXmlTag(block,'id'));const explicit=normalizeUrl(readXmlTag(block,'url')||readXmlTag(block,'jobUrl')||readXmlTag(block,'careerUrl'));const jobUrl=explicit||(id?`https://${host}/job/${encodeURIComponent(id)}`:null);if(jobUrl)urls.push(jobUrl);else invalid++;}if(invalid)return incomplete('Personio XML contained positions without stable URLs',url,blocks.length,urls,{board:slug,invalid,host});return complete('Personio official XML feed',url,blocks.length,urls,{board:slug,host});}catch{} }
  throw new Error('Personio XML feed unavailable');
}

async function auditJibe(sourceUrl) {
  const source=new URL(sourceUrl);if(!/(?:gov2x|v2x|vectrus)/i.test(source.hostname+source.pathname))return unsupported('Jibe audit restricted to recognized V2X career surface',sourceUrl);
  const api=new URL(sourceUrl);if(!api.pathname.startsWith('/api/'))api.pathname=`/api${api.pathname.startsWith('/')?api.pathname:`/${api.pathname}`}`;api.search='';api.hash='';
  let page=1,total=null,pages=0;const urls=[];const basePath=source.pathname.replace(/\/+$/,'');
  while(page<=MAX_PAGES){const u=new URL(api.toString());u.searchParams.set('page',String(page));const payload=await fetchJson(u.toString());const rows=Array.isArray(payload?.jobs)?payload.jobs:[];if(total===null)total=nonNegativeOrNull(payload?.totalCount)??rows.length;for(const row of rows){const data=row?.data??row??{};const slug=text(data.slug||data.req_id||data.reqId||data.id);if(slug)urls.push(new URL(`${basePath}/${encodeURIComponent(slug)}`,source.origin).toString());}pages++;if(!rows.length||uniqueUrls(urls).length>=total)break;page++;}
  const unique=uniqueUrls(urls);if(total===null||unique.length<total)return incomplete('Jibe audit did not enumerate reported total',api.toString(),total,unique,{pages});return complete('Jibe official career API',api.toString(),total,unique,{pages});
}

async function auditJazzHr(sourceUrl) {
  const url=new URL(sourceUrl);if(!/applytojob\.com$/i.test(url.hostname))return unsupported('JazzHR audit requires applytojob.com board',sourceUrl);url.pathname='/apply/jobs/';url.search='';url.hash='';const html=await fetchText(url.toString(),'text/html,application/xhtml+xml');const rows=Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi),m=>m[1]);const urls=[];for(const row of rows){const m=row.match(/<a\b[^>]*href=["']([^"']+)["']/i);if(!m)continue;const absolute=normalizeUrl(new URL(decodeHtml(m[1]),url).toString());if(absolute&&/applytojob\.com\/apply\/(?:jobs\/details\/)?[A-Za-z0-9_-]{4,}/i.test(absolute))urls.push(absolute);}const unique=uniqueUrls(urls);return complete('JazzHR official hosted board',url.toString(),unique.length,unique,{table_rows:rows.length});
}

async function auditAmentum(sourceUrl) {
  const base=new URL(sourceUrl);if(!/amentumcareers\.com$/i.test(base.hostname))return unsupported('Amentum audit requires amentumcareers.com',sourceUrl);let page=1,total=null;const urls=[];while(page<=MAX_PAGES){const u=new URL(sourceUrl);u.searchParams.set('page',String(page));const html=await fetchText(u.toString(),'text/html,application/xhtml+xml');if(total===null)total=parseAmentumTotal(html);const pageUrls=Array.from(html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi),m=>normalizeUrl(new URL(decodeHtml(m[1]),u).toString())).filter(v=>v&&/amentumcareers\.com\/jobs\/(?!search(?:[/?#]|$))[^/?#]{5,}/i.test(v));urls.push(...pageUrls);const unique=uniqueUrls(urls);if((total!==null&&unique.length>=total)||pageUrls.length===0)break;page++;}
  const unique=uniqueUrls(urls);const official=total??unique.length;if(unique.length<official)return incomplete('Amentum audit did not enumerate displayed total',sourceUrl,official,unique,{pages:page});return complete('Amentum official careers inventory',sourceUrl,official,unique,{pages:page});
}

function complete(label,url,count,urls,metadata){return{status:'complete',complete:true,sourceLabel:label,sourceUrl:url||null,officialCount:Math.max(0,Number(count)||0),jobUrls:uniqueUrls(urls),metadata:metadata||{}};}
function incomplete(reason,url,count,urls,metadata){return{status:'incomplete',complete:false,sourceLabel:'official source audit',sourceUrl:url||null,officialCount:nonNegativeOrNull(count),jobUrls:uniqueUrls(urls),metadata:{...(metadata||{}),reason}};}
function unsupported(reason,url){return{status:'unsupported',complete:false,sourceLabel:'official source audit',sourceUrl:url||null,officialCount:null,jobUrls:[],metadata:{reason}};}

async function fetchJson(url,headers={},options={}){const response=await fetch(url,{redirect:'follow',method:options.method||'GET',headers:{Accept:'application/json','User-Agent':USER_AGENT,...headers,...(options.headers||{})},body:options.body,signal:AbortSignal.timeout(DEFAULT_TIMEOUT_MS)});if(!response.ok)throw new Error(`HTTP ${response.status}`);const type=String(response.headers?.get?.('content-type')||'');if(type&&/text\/html/i.test(type))throw new Error('expected JSON but received HTML');return response.json();}
async function fetchText(url,accept){const response=await fetch(url,{redirect:'follow',headers:{Accept:accept,'User-Agent':USER_AGENT},signal:AbortSignal.timeout(DEFAULT_TIMEOUT_MS)});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.text();}
function isGovernmentJobsUrl(value){if(!value)return false;try{const url=new URL(String(value));return /(^|\.)governmentjobs\.com$/i.test(url.hostname);}catch{return false;}}
function governmentJobsSlug(board,url){
  const raw=text(board);
  if(raw&&!/^https?:\/\//i.test(raw)&&/^[a-z0-9_-]+$/i.test(raw)&&!['governmentjobs','neogov'].includes(raw.toLowerCase()))return sanitizeToken(raw);
  for(const candidate of [raw,url]){if(!candidate)continue;try{const u=new URL(candidate);if(/(^|\.)governmentjobs\.com$/i.test(u.hostname)){const m=u.pathname.match(/\/careers\/([^/?#]+)/i);if(m?.[1])return sanitizeToken(m[1]);}}catch{}}
  return null;
}
function parseWorkday(value){try{const url=new URL(String(value||''));if(!/(?:myworkdayjobs|myworkdaysite|workdayjobs)\.com$/i.test(url.hostname))return null;const tenant=url.hostname.split('.')[0];const parts=url.pathname.split('/').filter(Boolean);const languagePrefix=parts[0]?.match(/^[a-z]{2}-[A-Z]{2}$/)?`/${parts.shift()}`:'';const site=parts[0];if(!tenant||!site)return null;return{sourceUrl:url.toString(),origin:url.origin,tenant,site,languagePrefix,endpoint:`${url.origin}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/jobs`};}catch{return null;}}
function firstUrl(value){const rows=Array.isArray(value)?value:[value];for(const v of rows){const u=normalizeUrl(v);if(u)return u;}return null;}
function parseAmentumTotal(html){const textOnly=String(html||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');const m=textOnly.match(/Displaying\s+\d+\s*[-–]\s*\d+\s+of\s+([\d,]+)\s+in total/i);return m?Number(m[1].replace(/,/g,'')):null;}
function splitXmlBlocks(xml,tag){const escaped=tag.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return Array.from(xml.matchAll(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`,'gi')),m=>m[1]);}
function readXmlTag(block,tag){const escaped=tag.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const m=String(block||'').match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`,'i'));return m?.[1]?decodeXml(m[1].replace(/^<!\[CDATA\[/,'').replace(/\]\]>$/,'').trim()):'';}
function decodeXml(value){return String(value||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;|&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
function decodeHtml(value){return decodeXml(value).replace(/&nbsp;|&#160;/g,' ');}
function normalizeUrl(value){try{const url=new URL(String(value||'').trim());if(!['http:','https:'].includes(url.protocol))return null;url.hash='';for(const key of Array.from(url.searchParams.keys())){const lower=key.toLowerCase();if(lower.startsWith('utm_')||['source','src','ref','referrer','trackingid','trk','gh_src'].includes(lower))url.searchParams.delete(key);}url.searchParams.sort();return url.toString().replace(/\/$/,'');}catch{return null;}}
function uniqueUrls(values){return Array.from(new Set((Array.isArray(values)?values:[]).map(normalizeUrl).filter(Boolean)));}
function sanitizeToken(value){return text(value).replace(/^https?:\/\//i,'').split(/[./]/)[0].replace(/[^a-z0-9_-]/gi,'').toLowerCase()||null;}
function normalizeName(value){return text(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function text(value){return String(value||'').trim();}
function message(error){return error instanceof Error?error.message:String(error);}
function nonNegativeOrNull(value){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)&&n>=0?Math.floor(n):null;}
function positiveInt(value,fallback){const n=Number(value);return Number.isFinite(n)&&n>0?Math.floor(n):fallback;}
function clampInt(value,fallback,min,max){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):fallback;}

module.exports={auditOfficialSource,normalizeUrl,parseWorkday,governmentJobsSlug};
