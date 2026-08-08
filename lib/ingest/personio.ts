import { getIngestTimeout } from './http';

export async function fetchPersonioJobs(account: string) {
  const slug = sanitizeAccount(account);
  if (!slug) return [];
  for (const feedUrl of [`https://${slug}.jobs.personio.de/xml`, `https://${slug}.jobs.personio.com/xml`]) {
    try {
      const response = await fetch(feedUrl, {
        headers: { Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.7', 'User-Agent': 'OccuMedHiringTrendDashboard/1.0' },
        signal: AbortSignal.timeout(getIngestTimeout(12000)),
      });
      if (!response.ok) continue;
      const xml = await response.text();
      if (!xml.toLowerCase().includes('<position')) continue;
      return splitPositions(xml).map(block => normalizePosition(block, slug, feedUrl)).filter((job: any) => job.external_id && job.title);
    } catch {}
  }
  return [];
}

function splitPositions(xml: string) {
  const rows: string[] = [];
  let cursor = 0;
  const lower = xml.toLowerCase();
  while (true) {
    const start = lower.indexOf('<position', cursor);
    if (start < 0) break;
    const openEnd = lower.indexOf('>', start);
    if (openEnd < 0) break;
    const end = lower.indexOf('</position>', openEnd);
    if (end < 0) break;
    rows.push(xml.slice(openEnd + 1, end));
    cursor = end + 11;
  }
  return rows;
}

function normalizePosition(block: string, account: string, feedUrl: string) {
  const id = clean(readTag(block, 'id'));
  const title = clean(readTag(block, 'name'));
  const office = clean(readTag(block, 'office'));
  const department = clean(readTag(block, 'department')) || clean(readTag(block, 'recruitingCategory'));
  const explicitUrl = normalizeUrl(readTag(block, 'url') || readTag(block, 'jobUrl') || readTag(block, 'careerUrl'));
  const applyUrl = explicitUrl || (id ? `https://${account}.jobs.personio.de/job/${encodeURIComponent(id)}` : null);
  const country = countryFromLocation(office);
  return {
    external_id: String(id || applyUrl || `${title || ''}|${office || ''}`),
    source: 'personio',
    title,
    department,
    location: office,
    city: splitCity(office),
    state: splitState(office),
    country,
    lat: null,
    lng: null,
    is_remote: /\b(remote|virtual|home office|home-office)\b/i.test(`${title || ''} ${office || ''}`),
    is_overseas: country ? country !== 'US' : false,
    posted_at: normalizeDate(readTag(block, 'createdAt') || readTag(block, 'created_at')),
    raw_data: {
      normalized_apply_url: applyUrl,
      normalized_employer_source: 'personio-public-xml-feed',
      personio_account: account,
      feed_url: feedUrl,
      employment_type: clean(readTag(block, 'employmentType')),
      schedule: clean(readTag(block, 'schedule')),
    },
  };
}

function readTag(block: string, name: string) {
  const lower = block.toLowerCase();
  const open = `<${name.toLowerCase()}>`;
  const close = `</${name.toLowerCase()}>`;
  const start = lower.indexOf(open);
  if (start < 0) return '';
  const end = lower.indexOf(close, start + open.length);
  if (end < 0) return '';
  return decodeXml(block.slice(start + open.length, end).replace(/^<!\[CDATA\[/,'').replace(/\]\]>$/,'').trim());
}
function decodeXml(value: string) { return value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;|&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>'); }
function sanitizeAccount(value: unknown) { return String(value || '').trim().replace(/^https?:\/\//i,'').split(/[./]/)[0].replace(/[^a-z0-9-]/gi,'').toLowerCase(); }
function normalizeUrl(value: unknown) { try { const url = new URL(String(value || '').trim()); return ['http:','https:'].includes(url.protocol) ? url.toString() : null; } catch { return null; } }
function normalizeDate(value: unknown) { if (!value) return null; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function clean(value: unknown) { const text = String(value || '').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); return text || null; }
function splitCity(value?: string | null) { return value ? value.split(',')[0]?.trim() || null : null; }
function splitState(value?: string | null) { return value ? value.split(',')[1]?.trim() || null : null; }
function countryFromLocation(value?: string | null) { if (!value) return null; const pairs: Array<[RegExp,string]> = [[/\b(?:united states|usa|u\.s\.)\b/i,'US'],[/\bcanada\b/i,'CA'],[/\b(?:united kingdom|uk)\b/i,'GB'],[/\bgermany\b/i,'DE'],[/\baustralia\b/i,'AU'],[/\bfrance\b/i,'FR'],[/\bitaly\b/i,'IT'],[/\bspain\b/i,'ES'],[/\bpoland\b/i,'PL']]; for (const [pattern, code] of pairs) if (pattern.test(value)) return code; if (/\b[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}\b/.test(value)) return 'US'; return null; }
