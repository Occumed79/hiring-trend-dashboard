try {
  const dotenv = require('dotenv');
  dotenv.config({ path: '.env.local' });
  dotenv.config();
} catch (err) {
  if (err?.code !== 'MODULE_NOT_FOUND') throw err;
}

const { Client } = require('pg');

const STALE_DAYS = positiveInt(process.env.SOURCE_DIRECTORY_STALE_DAYS, 14);
const TIMEOUT_MS = positiveInt(process.env.SOURCE_DIRECTORY_TIMEOUT_MS, 20000);
const SOURCES = {
  naspe: process.env.NASPE_JOBS_DIRECTORY_URL || 'https://www.naspe.net/jobs-links',
  nlc: process.env.NLC_MUNICIPAL_LEAGUES_URL || 'https://www.nlc.org/membership/state-municipal-leagues/',
  naco: process.env.NACO_STATE_ASSOCIATIONS_URL || 'https://www.naco.org/page/state-associations-affiliates-and-affinity-organizations',
};
const DIRECTORY_MINIMUMS = {
  'naspe-state-jobs': positiveInt(process.env.NASPE_DIRECTORY_MIN_ROWS, 45),
  'nlc-municipal-leagues': positiveInt(process.env.NLC_DIRECTORY_MIN_ROWS, 45),
  'naco-state-associations': positiveInt(process.env.NACO_DIRECTORY_MIN_ROWS, 35),
};
const REMOTE_DIRECTORY_KEYS = Object.keys(DIRECTORY_MINIMUMS);

const STATES = {
  Alabama:'AL',Alaska:'AK',Arizona:'AZ',Arkansas:'AR',California:'CA',Colorado:'CO',Connecticut:'CT',Delaware:'DE',Florida:'FL',Georgia:'GA',Hawaii:'HI',Idaho:'ID',Illinois:'IL',Indiana:'IN',Iowa:'IA',Kansas:'KS',Kentucky:'KY',Louisiana:'LA',Maine:'ME',Maryland:'MD',Massachusetts:'MA',Michigan:'MI',Minnesota:'MN',Mississippi:'MS',Missouri:'MO',Montana:'MT',Nebraska:'NE',Nevada:'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND',Ohio:'OH',Oklahoma:'OK',Oregon:'OR',Pennsylvania:'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD',Tennessee:'TN',Texas:'TX',Utah:'UT',Vermont:'VT',Virginia:'VA',Washington:'WA','West Virginia':'WV',Wisconsin:'WI',Wyoming:'WY','District of Columbia':'DC'
};
const STATE_NAMES_BY_CODE = Object.fromEntries(Object.entries(STATES).map(([name, code]) => [code, name]));

const FEDERAL_EXCEPTION_SEEDS = [
  {
    entry_key: 'usps-new-careers', entry_type: 'federal_exception', organization_name: 'United States Postal Service — New Careers',
    jobs_url: 'https://jobs.usps.com/', source_url: 'https://about.usps.com/careers/how-to-apply/', source_class: 'authoritative', lineage_root: 'usps',
    metadata: { match_patterns: ['united states postal service','us postal service','usps','postal service'], note: 'USPS operates a new careers system alongside legacy eCareer.' }
  },
  {
    entry_key: 'usps-legacy-ecareer', entry_type: 'federal_exception', organization_name: 'United States Postal Service — Legacy eCareer',
    jobs_url: 'https://about.usps.com/careers/how-to-apply/', source_url: 'https://about.usps.com/careers/how-to-apply/', source_class: 'authoritative', lineage_root: 'usps',
    metadata: { match_patterns: ['united states postal service','us postal service','usps','postal service'], note: 'USPS explicitly instructs applicants to search both the new and legacy systems for complete coverage.' }
  },
  {
    entry_key: 'federal-judiciary', entry_type: 'federal_exception', organization_name: 'United States Courts — Judiciary Jobs',
    jobs_url: 'https://www.uscourts.gov/careers/search-judiciary-jobs', source_url: 'https://www.uscourts.gov/careers/search-judiciary-jobs', source_class: 'authoritative', lineage_root: 'federal-judiciary',
    metadata: { match_patterns: ['united states courts','u.s. courts','us courts','federal judiciary','judiciary'], note: 'Federal Judiciary maintains its own vacancy inventory.' }
  },
  {
    entry_key: 'federal-oscar', entry_type: 'federal_exception', organization_name: 'OSCAR — Federal Law Clerk and Staff Attorney Jobs',
    jobs_url: 'https://oscar.uscourts.gov/', source_url: 'https://oscar.uscourts.gov/', source_class: 'verified', lineage_root: 'federal-judiciary',
    metadata: { match_patterns: ['united states courts','u.s. courts','us courts','federal judiciary','judiciary'], note: 'OSCAR supplements Judiciary coverage for federal law clerk and appellate staff attorney positions.' }
  },
  {
    entry_key: 'intelligence-community', entry_type: 'federal_exception', organization_name: 'U.S. Intelligence Community Careers',
    jobs_url: 'https://www.intelligencecareers.gov/', source_url: 'https://www.intelligencecareers.gov/agencies', source_class: 'verified', lineage_root: 'intelligence-community',
    metadata: { match_patterns: ['central intelligence agency','cia','national security agency','nsa','defense intelligence agency','dia','national geospatial-intelligence agency','nga','national reconnaissance office','nro','office of the director of national intelligence','odni','intelligence community'], note: 'Official Intelligence Community career directory; agency-specific portals remain separate authoritative lineages when discovered.' }
  }
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const client = new Client({ connectionString, ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });
  await client.connect();
  try {
    if (process.argv.includes('--if-stale') && !(await shouldRefresh(client))) {
      console.log('Source directories are fresh; skipping sync.');
      return;
    }

    const fetched = await Promise.all([
      fetchDirectory('naspe-state-jobs', SOURCES.naspe, parseNaspe),
      fetchDirectory('nlc-municipal-leagues', SOURCES.nlc, parseNlc),
      fetchDirectory('naco-state-associations', SOURCES.naco, parseNaco),
    ]);
    const federalRows = FEDERAL_EXCEPTION_SEEDS.map(entry => ({ directory_key: 'federal-exceptions', state_code: null, ...entry }));

    await client.query('BEGIN');
    for (const result of fetched) {
      if (!result.accepted) {
        console.warn(`${result.directoryKey} refresh rejected; preserving previous active rows (${result.reason}).`);
        continue;
      }
      await replaceDirectory(client, result.directoryKey, result.rows);
    }
    await replaceDirectory(client, 'federal-exceptions', federalRows);
    await client.query('COMMIT');

    const counts = Object.fromEntries(fetched.map(result => [result.directoryKey, result.accepted ? result.rows.length : `preserved (${result.rows.length} parsed)`]));
    counts['federal-exceptions'] = federalRows.length;
    console.log('Source directory sync complete:', counts);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function fetchDirectory(directoryKey, url, parser) {
  try {
    const html = await fetchText(url);
    const parsed = parser(html);
    const unique = dedupeDirectoryRows(parsed);
    const minimum = DIRECTORY_MINIMUMS[directoryKey] || 1;
    if (unique.length < minimum) {
      return { directoryKey, rows: unique, accepted: false, reason: `only ${unique.length} rows parsed; minimum is ${minimum}` };
    }
    return { directoryKey, rows: unique, accepted: true, reason: null };
  } catch (error) {
    return { directoryKey, rows: [], accepted: false, reason: message(error) };
  }
}

async function replaceDirectory(client, directoryKey, rows) {
  await client.query('UPDATE source_directory_entries SET is_active = false WHERE directory_key = $1', [directoryKey]);
  for (const row of rows) await upsert(client, row);
}

async function shouldRefresh(client) {
  try {
    const result = await client.query(
      `SELECT directory_key, COUNT(*) FILTER (WHERE is_active=true)::int AS cnt,
              MAX(last_seen_at) FILTER (WHERE is_active=true) AS newest
       FROM source_directory_entries
       WHERE directory_key = ANY($1::text[])
       GROUP BY directory_key`,
      [REMOTE_DIRECTORY_KEYS],
    );
    const byKey = new Map(result.rows.map(row => [row.directory_key, row]));
    const staleMs = STALE_DAYS * 86400000;
    for (const directoryKey of REMOTE_DIRECTORY_KEYS) {
      const row = byKey.get(directoryKey);
      const minimum = DIRECTORY_MINIMUMS[directoryKey] || 1;
      const count = Number(row?.cnt || 0);
      const newest = row?.newest ? new Date(row.newest).getTime() : 0;
      if (count < minimum || !newest || Date.now() - newest > staleMs) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function parseNaspe(html) {
  if (!html) return [];
  const anchors = extractAnchors(html, SOURCES.naspe);
  const rows = [];
  for (const anchor of anchors) {
    const stateName = normalizeStateName(anchor.text);
    const code = stateName ? STATES[stateName] : null;
    if (!code || !isHttp(anchor.href)) continue;
    rows.push({
      directory_key: 'naspe-state-jobs', entry_key: code, entry_type: 'state_jobs', state_code: code,
      organization_name: `${stateName} State Government Jobs`, source_url: SOURCES.naspe, jobs_url: anchor.href,
      source_class: 'authoritative', lineage_root: `state-jobs:${code.toLowerCase()}`,
      metadata: { directory: 'National Association of State Personnel Executives', state_name: stateName }
    });
  }
  return rows;
}

function parseNlc(html) {
  if (!html) return [];
  const rows = [];
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const chunk = match[1];
    const text = htmlToText(chunk);
    const stateCode = text.match(/(?:^|\s)([A-Z]{2})(?:\s|$)/)?.[1] || null;
    if (!stateCode || !STATE_NAMES_BY_CODE[stateCode]) continue;
    const anchors = extractAnchors(chunk, SOURCES.nlc).filter(anchor => isHttp(anchor.href));
    const best = anchors.find(anchor => !sameDomain(anchor.href, SOURCES.nlc)) || anchors[0];
    if (!best) continue;
    const name = clean(best.text) || `${STATE_NAMES_BY_CODE[stateCode]} Municipal League`;
    rows.push({
      directory_key: 'nlc-municipal-leagues', entry_key: stateCode, entry_type: 'municipal_league', state_code: stateCode,
      organization_name: name, source_url: best.href, jobs_url: null, source_class: 'supplemental',
      lineage_root: `municipal-league:${stateCode.toLowerCase()}`,
      metadata: { directory: 'National League of Cities', state_name: STATE_NAMES_BY_CODE[stateCode] }
    });
  }
  return rows;
}

function parseNaco(html) {
  if (!html) return [];
  const rows = [];
  const headingRegex = /<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/gi;
  const headings = [];
  let match;
  while ((match = headingRegex.exec(html)) !== null) {
    const stateName = normalizeStateName(htmlToText(match[1]));
    if (stateName && STATES[stateName]) headings.push({ stateName, code: STATES[stateName], start: headingRegex.lastIndex });
  }
  for (let i = 0; i < headings.length; i++) {
    const current = headings[i];
    const end = headings[i + 1]?.start || html.length;
    const section = html.slice(current.start, end);
    const anchors = extractAnchors(section, SOURCES.naco)
      .filter(anchor => isHttp(anchor.href) && !sameDomain(anchor.href, SOURCES.naco));
    let ordinal = 0;
    for (const anchor of anchors) {
      const host = safeHost(anchor.href);
      if (!host || /facebook|twitter|linkedin|youtube|instagram/i.test(host)) continue;
      const name = clean(anchor.text);
      if (!name || /^(website|visit|click here|read more)$/i.test(name)) continue;
      ordinal++;
      rows.push({
        directory_key: 'naco-state-associations', entry_key: `${current.code}-${slug(name)}-${ordinal}`,
        entry_type: 'county_association', state_code: current.code, organization_name: name, source_url: anchor.href,
        jobs_url: null, source_class: 'supplemental', lineage_root: `county-association:${current.code.toLowerCase()}:${slug(name)}`,
        metadata: { directory: 'National Association of Counties', state_name: current.stateName }
      });
    }
  }
  return rows;
}

async function upsert(client, row) {
  await client.query(`
    INSERT INTO source_directory_entries (
      directory_key, entry_key, entry_type, state_code, organization_name, source_url, jobs_url,
      source_class, lineage_root, metadata, is_active, last_seen_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,true,NOW(),NOW())
    ON CONFLICT (directory_key, entry_key) DO UPDATE SET
      entry_type=EXCLUDED.entry_type, state_code=EXCLUDED.state_code, organization_name=EXCLUDED.organization_name,
      source_url=EXCLUDED.source_url, jobs_url=COALESCE(EXCLUDED.jobs_url, source_directory_entries.jobs_url),
      source_class=EXCLUDED.source_class, lineage_root=EXCLUDED.lineage_root,
      metadata=source_directory_entries.metadata || EXCLUDED.metadata,
      is_active=true, last_seen_at=NOW(), updated_at=NOW()`,
    [row.directory_key,row.entry_key,row.entry_type,row.state_code,row.organization_name,row.source_url,row.jobs_url,row.source_class,row.lineage_root,JSON.stringify(row.metadata || {})]
  );
}

function dedupeDirectoryRows(rows) {
  const unique = new Map();
  for (const row of rows) unique.set(`${row.directory_key}|${row.entry_key}`, row);
  return Array.from(unique.values());
}
async function fetchText(url) {
  const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'OccuMedHiringTrendDashboard/1.0', accept: 'text/html,*/*;q=0.8' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function extractAnchors(html, base) {
  const out = [];
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try { out.push({ href: new URL(decodeEntities(match[1]), base).toString(), text: htmlToText(match[2]) }); } catch {}
  }
  return out;
}
function htmlToText(value) { return clean(decodeEntities(String(value || '').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' '))); }
function decodeEntities(value) { return String(value || '').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>'); }
function normalizeStateName(value) { const text = clean(value).replace(/\s+/g,' '); return Object.keys(STATES).find(name => name.toLowerCase() === text.toLowerCase()) || null; }
function sameDomain(a,b) { try { return new URL(a).hostname.replace(/^www\./,'') === new URL(b).hostname.replace(/^www\./,''); } catch { return false; } }
function safeHost(value) { try { return new URL(value).hostname.toLowerCase(); } catch { return ''; } }
function isHttp(value) { try { return ['http:','https:'].includes(new URL(value).protocol); } catch { return false; } }
function clean(value) { return String(value || '').replace(/\s+/g,' ').trim(); }
function slug(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80) || 'entry'; }
function positiveInt(value, fallback) { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback; }
function message(error) { return error instanceof Error ? error.message : String(error); }

main().catch(error => { console.error('Source directory sync failed:', error); process.exitCode = 1; });