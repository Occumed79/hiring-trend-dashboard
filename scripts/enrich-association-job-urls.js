try {
  const dotenv = require('dotenv');
  dotenv.config({ path: '.env.local' });
  dotenv.config();
} catch (err) {
  if (err?.code !== 'MODULE_NOT_FOUND') throw err;
}

const { Client } = require('pg');
const CONCURRENCY = clamp(positiveInt(process.env.ASSOCIATION_DISCOVERY_CONCURRENCY, 6), 1, 10);
const TIMEOUT_MS = positiveInt(process.env.ASSOCIATION_DISCOVERY_TIMEOUT_MS, 12000);
const STALE_DAYS = positiveInt(process.env.ASSOCIATION_DISCOVERY_STALE_DAYS, 30);

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const client = new Client({ connectionString, ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT directory_key, entry_key, organization_name, source_url, jobs_url, metadata
      FROM source_directory_entries
      WHERE is_active=true AND entry_type IN ('municipal_league','county_association')
        AND source_url IS NOT NULL
      ORDER BY directory_key, state_code, organization_name
    `);
    const cutoff = Date.now() - STALE_DAYS * 86400000;
    const rows = result.rows.filter(row => {
      const checkedAt = row?.metadata?.jobs_discovery?.checked_at;
      const checked = checkedAt ? new Date(checkedAt).getTime() : 0;
      return !checked || !Number.isFinite(checked) || checked < cutoff;
    });
    let found = 0;
    let retained = 0;
    let missed = 0;
    await mapWithConcurrency(rows, CONCURRENCY, async row => {
      const checkedAt = new Date().toISOString();
      if (row.jobs_url && await validatesJobSurface(row.jobs_url).catch(() => false)) {
        await markDiscovery(client,row,{method:'retained-existing',score:100,checked_at:checkedAt},row.jobs_url);
        retained++;
        return;
      }
      const discovered = await discoverJobsUrl(row.source_url).catch(() => null);
      if (!discovered) {
        await markDiscovery(client,row,{method:'unresolved',score:0,checked_at:checkedAt},row.jobs_url||null);
        missed++;
        return;
      }
      await markDiscovery(client,row,{method:discovered.method,score:discovered.score,checked_at:checkedAt},discovered.url);
      found++;
    });
    console.log(`Association job-board enrichment complete: ${found} discovered, ${retained} retained, ${missed} unresolved, ${result.rows.length - rows.length} fresh/skipped.`);
  } finally {
    await client.end();
  }
}

async function markDiscovery(client,row,discovery,jobsUrl) {
  await client.query(
    `UPDATE source_directory_entries
     SET jobs_url=$3,
         metadata=COALESCE(metadata,'{}'::jsonb) || $4::jsonb,
         updated_at=NOW()
     WHERE directory_key=$1 AND entry_key=$2`,
    [row.directory_key,row.entry_key,jobsUrl,JSON.stringify({ jobs_discovery:discovery })],
  );
}

async function discoverJobsUrl(homeUrl) {
  const html = await fetchText(homeUrl);
  const candidates = [];
  for (const anchor of extractAnchors(html, homeUrl)) {
    const score = scoreCandidate(anchor.href, anchor.text, homeUrl);
    if (score > 0) candidates.push({ url: anchor.href, score, method: 'association-page-link' });
  }
  const origin = new URL(homeUrl).origin;
  for (const path of ['/jobs','/careers','/career-center','/job-board','/employment','/resources/jobs']) {
    candidates.push({ url: new URL(path, origin).toString(), score: 35, method: 'common-career-path' });
  }
  candidates.sort((a,b) => b.score - a.score);
  const seen = new Set();
  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate.url);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    if (await validatesJobSurface(normalized).catch(() => false)) return { ...candidate, url: normalized };
  }
  return null;
}

async function validatesJobSurface(url) {
  const response = await fetch(url, { redirect:'follow', headers:{'user-agent':'OccuMedHiringTrendDashboard/1.0',accept:'text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.6'}, signal:AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) return false;
  const finalUrl = response.url || url;
  const text = (await response.text()).slice(0,250000);
  const searchable = `${finalUrl} ${text}`.toLowerCase();
  const knownAts = /governmentjobs\.com\/careers\/|myworkdayjobs\.com|workdayjobs\.com|icims\.com|taleo\.net|oraclecloud\.com|jobvite\.com|smartrecruiters\.com|greenhouse\.io|lever\.co|applytojob\.com|dayforcehcm\.com|ultipro\.com|ukg\.com|workable\.com|personio\./i.test(searchable);
  const jobSignals = /job opportunities|job openings|career opportunities|employment opportunities|career center|job board|search jobs|current openings|vacancies/i.test(searchable);
  const detailSignals = /\bjob\b[^<]{0,80}(apply|location|salary|position)|application|requisition/i.test(searchable);
  return knownAts || (jobSignals && detailSignals);
}

function scoreCandidate(url, text, homeUrl) {
  const target = `${url} ${text}`.toLowerCase();
  let score = 0;
  if (/governmentjobs\.com\/careers\/|myworkdayjobs\.com|workdayjobs\.com|icims\.com|taleo\.net|oraclecloud\.com|jobvite\.com|smartrecruiters\.com|greenhouse\.io|lever\.co|applytojob\.com|dayforcehcm\.com|workable\.com|personio\./i.test(target)) score += 90;
  if (/career center|job board|job opportunities|job openings|careers|employment|current openings|vacancies/i.test(target)) score += 55;
  if (/\/jobs?\b|\/careers?\b|\/employment\b|\/career-center\b|\/job-board\b/i.test(url)) score += 25;
  if (sameDomain(url, homeUrl)) score += 10;
  if (/member jobs|classifieds|rfp|vendor|conference|event/i.test(target)) score -= 25;
  return score;
}
function extractAnchors(html, base) { const out=[]; const regex=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let match; while((match=regex.exec(html))!==null){ try{out.push({href:new URL(decodeEntities(match[1]),base).toString(),text:htmlToText(match[2])});}catch{} } return out; }
async function fetchText(url) { const response=await fetch(url,{redirect:'follow',headers:{'user-agent':'OccuMedHiringTrendDashboard/1.0',accept:'text/html,*/*;q=0.8'},signal:AbortSignal.timeout(TIMEOUT_MS)}); if(!response.ok)throw new Error(`HTTP ${response.status}`); return response.text(); }
function htmlToText(value){return decodeEntities(String(value||'').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();}
function decodeEntities(value){return String(value||'').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');}
function normalizeUrl(value){try{const url=new URL(String(value||'').trim());if(!['http:','https:'].includes(url.protocol))return null;url.hash='';return url.toString();}catch{return null;}}
function sameDomain(a,b){try{const x=new URL(a).hostname.toLowerCase().replace(/^www\./,''),y=new URL(b).hostname.toLowerCase().replace(/^www\./,'');return x===y||x.endsWith(`.${y}`)||y.endsWith(`.${x}`);}catch{return false;}}
function positiveInt(value,fallback){const n=Number(value);return Number.isFinite(n)&&n>0?Math.floor(n):fallback;}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
async function mapWithConcurrency(items,limit,worker){if(!items.length)return;let next=0;async function run(){while(true){const i=next++;if(i>=items.length)return;await worker(items[i]);}}await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>run()));}

main().catch(error => { console.error('Association job-board enrichment failed:', error); process.exitCode=1; });
