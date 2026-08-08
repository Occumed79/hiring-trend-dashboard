import { getIngestTimeout } from './http';

export type CoverageCheck = {
  source: string;
  source_class: 'authoritative' | 'verified' | 'supplemental';
  status: 'success' | 'zero' | 'skipped' | 'error';
  jobs_found: number;
  authoritative_zero?: boolean;
  details?: Record<string, any>;
};

const SOURCE = 'gov:neogov_rss';

export async function fetchNeoGovFeedJobs(entity: any): Promise<{ jobs: any[]; check: CoverageCheck }> {
  const slug = governmentJobsSlug(entity);
  if (!slug) return {
    jobs: [],
    check: { source: SOURCE, source_class: 'authoritative', status: 'skipped', jobs_found: 0, details: { reason: 'no GovernmentJobs agency slug resolved' } },
  };

  const feedUrl = `https://www.governmentjobs.com/SearchEngine/JobsFeed?agency=${encodeURIComponent(slug)}`;
  try {
    const response = await fetch(feedUrl, {
      headers: { accept: 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.7', 'user-agent': 'OccuMedHiringTrendDashboard/1.0' },
      signal: AbortSignal.timeout(getIngestTimeout(12000)),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    const feedDetected = /<rss\b/i.test(xml) && /<channel\b/i.test(xml);
    if (!feedDetected) throw new Error('HTTP 200 response was not a recognized GovernmentJobs RSS feed');

    const items = parseItems(xml);
    const jobs = items.map((item, index) => normalizeItem(item, entity, slug, index)).filter(Boolean) as any[];
    const invalidItems = items.length - jobs.length;
    if (invalidItems > 0) {
      // Keep valid rows as partial evidence, but do not claim a complete
      // authoritative inventory or retire jobs while the feed parser is lossy.
      return {
        jobs,
        check: {
          source: SOURCE,
          source_class: 'authoritative',
          status: 'error',
          jobs_found: jobs.length,
          authoritative_zero: false,
          details: { agency: slug, feed_url: feedUrl, rss_items: items.length, invalid_items: invalidItems, feed_detected: true, error: 'one or more RSS items could not be normalized' },
        },
      };
    }

    return {
      jobs,
      check: {
        source: SOURCE,
        source_class: 'authoritative',
        status: jobs.length ? 'success' : 'zero',
        jobs_found: jobs.length,
        authoritative_zero: jobs.length === 0,
        details: { agency: slug, feed_url: feedUrl, rss_items: items.length, invalid_items: 0, feed_detected: true },
      },
    };
  } catch (error) {
    return {
      jobs: [],
      check: {
        source: SOURCE,
        source_class: 'authoritative',
        status: 'error',
        jobs_found: 0,
        authoritative_zero: false,
        details: { agency: slug, feed_url: feedUrl, feed_detected: false, error: error instanceof Error ? error.message : String(error) },
      },
    };
  }
}

function governmentJobsSlug(entity: any) {
  const provider = String(entity?.ats_provider || '').toLowerCase();
  const boardId = clean(entity?.ats_board_id);
  if ((provider === 'governmentjobs' || provider === 'neogov') && boardId) return sanitizeSlug(boardId);
  const urls = [entity?.career_page_url, entity?.hiring_page_url].filter(Boolean);
  for (const value of urls) {
    try {
      const url = new URL(String(value));
      if (!/(^|\.)governmentjobs\.com$/i.test(url.hostname)) continue;
      const match = url.pathname.match(/^\/careers\/([^/?#]+)/i);
      if (match?.[1]) return sanitizeSlug(match[1]);
    } catch {}
  }
  return null;
}

function parseItems(xml: string) {
  const items: Record<string,string>[] = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    items.push({
      title: readXmlTag(block, 'title'),
      link: readXmlTag(block, 'link'),
      guid: readXmlTag(block, 'guid'),
      description: readXmlTag(block, 'description'),
      pubDate: readXmlTag(block, 'pubDate') || readXmlTag(block, 'dc:date'),
      category: readXmlTag(block, 'category'),
    });
  }
  return items;
}

function normalizeItem(item: Record<string,string>, entity: any, slug: string, index: number) {
  const title = cleanText(item.title);
  const link = normalizeUrl(item.link || item.guid);
  if (!title || !link) return null;
  const description = cleanText(item.description) || '';
  const location = extractLocation(description);
  const state = extractState(location);
  const city = extractCity(location);
  const externalId = extractGovernmentJobsId(link) || cleanText(item.guid) || `${slug}-${hashString(`${title}|${link}|${index}`)}`;
  return {
    external_id: String(externalId),
    source: SOURCE,
    title,
    department: cleanText(item.category) || entity?.name || null,
    location,
    city,
    state,
    country: 'US',
    lat: null,
    lng: null,
    is_remote: /\b(remote|telework|virtual)\b/i.test(`${title} ${description}`),
    is_overseas: false,
    posted_at: normalizeDate(item.pubDate),
    raw_data: {
      normalized_apply_url: link,
      normalized_employer: entity?.name || null,
      normalized_employer_source: 'neogov-governmentjobs-rss',
      parser: 'structured_neogov_rss',
      governmentjobs_agency: slug,
      rss_description: description.slice(0, 8000),
    },
  };
}

function readXmlTag(block: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match?.[1] ? decodeXml(stripCdata(match[1]).trim()) : '';
}
function stripCdata(value: string) { return value.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, ''); }
function decodeXml(value: string) {
  return value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;|&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
function cleanText(value: unknown) {
  const text = String(value || '').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  return text || null;
}
function extractLocation(text: string) {
  const labeled = text.match(/\b(?:location|job location|work location)\s*[:\-–—]\s*([^|;]{2,100})/i);
  if (labeled?.[1]) return cleanLocation(labeled[1]);
  const cityState = text.match(/\b([A-Z][A-Za-z.' -]{1,48},\s*(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY))\b/);
  return cityState?.[1] ? cleanLocation(cityState[1]) : null;
}
function cleanLocation(value: string) { return value.replace(/\s+/g,' ').replace(/[.,;\s]+$/,'').trim(); }
function extractCity(location: string | null) { return location?.split(',')[0]?.trim() || null; }
function extractState(location: string | null) { const part = location?.split(',')[1]?.trim(); return part?.match(/^[A-Z]{2}$/) ? part : null; }
function extractGovernmentJobsId(url: string) { return url.match(/\/jobs\/(\d+)/i)?.[1] || new URL(url).searchParams.get('jobId'); }
function normalizeUrl(value: unknown) { try { const url = new URL(String(value || '').trim()); return ['http:','https:'].includes(url.protocol) ? url.toString() : null; } catch { return null; } }
function normalizeDate(value: unknown) { if (!value) return null; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function clean(value: unknown) { const text = String(value || '').trim(); return text || null; }
function sanitizeSlug(value: string) { return value.toLowerCase().replace(/^careers\//,'').replace(/[^a-z0-9_-]/g,'').slice(0,80) || null; }
function hashString(value: string) { let hash = 2166136261; for (let i=0;i<value.length;i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash,16777619); } return (hash >>> 0).toString(36); }
