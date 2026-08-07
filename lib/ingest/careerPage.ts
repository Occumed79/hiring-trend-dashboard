import { assessJobQuality, isGenericNavigationTitle, looksLikeJobDetailUrl } from './jobQuality';

export async function fetchCareerPageJobs(careerPageUrl: string, companyName: string) {
  const html = await fetchCareerHtml(careerPageUrl);
  if (!html) return [];

  const linkedJobs = extractLinkedJobs(html, careerPageUrl);
  const detailLimit = getPositiveIntegerEnv('CAREER_DETAIL_ENRICH_LIMIT', 100);
  const enrichedLinkedJobs = await enrichLinkedJobsFromDetailPages(linkedJobs, detailLimit);
  const parsedJobs = [...extractJsonLdJobs(html, careerPageUrl), ...enrichedLinkedJobs];

  const seen = new Set<string>();
  return parsedJobs
    .filter(job => job.title && job.url)
    .map(job => ({
      external_id: job.external_id || hashString(`${companyName}|${job.title}|${job.url}`),
      source: 'career_page',
      title: job.title,
      department: job.department || null,
      location: job.location || null,
      city: splitCity(job.location),
      state: splitState(job.location),
      country: job.country || null,
      lat: null,
      lng: null,
      is_remote: /\b(remote|virtual|work from home|wfh)\b/i.test(`${job.title} ${job.location || ''}`),
      is_overseas: Boolean(job.country && String(job.country).toUpperCase() !== 'US'),
      posted_at: job.posted_at || null,
      raw_data: {
        companyName,
        careerPageUrl,
        url: job.url,
        normalized_apply_url: job.url,
        parser: job.parser,
        normalized_job_evidence: job.parser,
        detail_enriched: job.detail_enriched || false,
        detail_location_source: job.detail_location_source || null,
        detail_location_candidates: job.detail_location_candidates || [],
      },
    }))
    .filter(job => assessJobQuality(job).ok)
    .filter(job => {
      const key = `${job.title}|${job.location || ''}|${job.raw_data.normalized_apply_url}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

interface ParsedJob {
  external_id?: string;
  title: string;
  department?: string | null;
  location?: string | null;
  country?: string | null;
  posted_at?: string | null;
  url: string;
  parser: string;
  detail_enriched?: boolean;
  detail_location_source?: string | null;
  detail_location_candidates?: string[];
}

async function enrichLinkedJobsFromDetailPages(jobs: ParsedJob[], limit: number): Promise<ParsedJob[]> {
  const enriched: ParsedJob[] = [];
  const queue = jobs.slice(0, limit);
  const concurrency = 5;

  for (let i = 0; i < queue.length; i += concurrency) {
    enriched.push(...await Promise.all(queue.slice(i, i + concurrency).map(enrichOneLinkedJob)));
  }

  // Do not persist unenriched overflow from generic HTML. A row beyond the enrichment
  // budget must wait for a later run rather than enter the DB without verification.
  return enriched;
}

async function enrichOneLinkedJob(job: ParsedJob): Promise<ParsedJob> {
  const detailHtml = await fetchCareerHtml(job.url);
  if (!detailHtml) return job;

  const jsonLdJobs = extractJsonLdJobs(detailHtml, job.url);
  const jsonLdHit = jsonLdJobs.find(candidate => sameJob(candidate, job)) || jsonLdJobs[0];
  if (jsonLdHit) {
    return {
      ...job,
      external_id: jsonLdHit.external_id || job.external_id,
      title: jsonLdHit.title || job.title,
      department: jsonLdHit.department || job.department,
      location: jsonLdHit.location || job.location,
      country: jsonLdHit.country || job.country,
      posted_at: jsonLdHit.posted_at || job.posted_at,
      url: jsonLdHit.url || job.url,
      parser: `${job.parser}+detail_json_ld`,
      detail_enriched: true,
      detail_location_source: jsonLdHit.location ? 'detail_json_ld' : null,
      detail_location_candidates: jsonLdHit.location ? [jsonLdHit.location] : [],
    };
  }

  const candidates = extractLocationCandidatesFromDetailHtml(detailHtml);
  const location = candidates[0] || null;
  return {
    ...job,
    location: location || job.location,
    country: detectCountryFromLocation(location) || job.country,
    parser: location ? `${job.parser}+detail_html` : `${job.parser}+detail_verified`,
    detail_enriched: true,
    detail_location_source: location ? 'detail_html' : null,
    detail_location_candidates: candidates,
  };
}

async function fetchCareerHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: {
          'user-agent': 'OccuMedHiringTrendDashboard/1.0 (+https://github.com/Occumed79/hiring-trend-dashboard)',
          accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      return await res.text();
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

function extractJsonLdJobs(html: string, baseUrl: string): ParsedJob[] {
  const results: ParsedJob[] = [];
  const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(html)) !== null) {
    const raw = stripHtmlEntities(match[1].trim());
    try {
      const parsed = JSON.parse(raw);
      for (const node of flattenJsonLd(parsed)) {
        if (!isJobPosting(node)) continue;
        const title = cleanText(node.title || node.name || '');
        if (!title || isGenericNavigationTitle(title)) continue;
        const url = absolutize(node.url || node.sameAs || baseUrl, baseUrl);
        results.push({
          external_id: readIdentifier(node.identifier),
          title,
          department: node.employmentType || node.occupationalCategory || null,
          location: readJobLocation(node.jobLocation || node.applicantLocationRequirements || node.jobLocationType),
          country: readJobCountry(node.jobLocation || node.applicantLocationRequirements),
          posted_at: node.datePosted || node.validThrough || null,
          url,
          parser: 'json_ld',
        });
      }
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return results;
}

function extractLinkedJobs(html: string, baseUrl: string): ParsedJob[] {
  const results: ParsedJob[] = [];
  const anchorRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1];
    const text = cleanText(match[2]);
    if (!href || !text || text.length < 3 || text.length > 180 || isGenericNavigationTitle(text)) continue;

    const absolute = absolutize(href, baseUrl);
    if (!looksLikeJobDetailUrl(absolute)) continue;

    results.push({
      title: text,
      location: extractLocationFromText(text),
      country: detectCountryFromLocation(text),
      url: absolute,
      parser: 'strong_job_detail_link',
    });
  }

  return results.slice(0, 500);
}

function extractLocationCandidatesFromDetailHtml(html: string): string[] {
  const candidates = new Set<string>();
  const text = cleanText(html).slice(0, 160000);
  const patterns = [
    /\b(?:Location|Work Location|Job Location|Primary Location|Office Location|勤務地)\s*[:\-–—]\s*([^|•\n\r]{2,120})/gi,
    /\b(?:City|State|Country)\s*[:\-–—]\s*([^|•\n\r]{2,80})/gi,
    /\b([A-Z][a-zA-Z .'-]+,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY))\b/g,
    /\b(Remote|Hybrid|United States|United Kingdom|Kuwait|Qatar|Bahrain|Iraq|Germany|Afghanistan|Djibouti|Japan|Korea|Poland|Australia)\b/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const value = cleanLocationCandidate(match[1] || match[0]);
      if (value) candidates.add(value);
      if (candidates.size >= 20) break;
    }
  }
  return Array.from(candidates);
}

function flattenJsonLd(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (value['@graph']) return flattenJsonLd(value['@graph']);
  return [value];
}
function isJobPosting(node: any): boolean {
  const type = node?.['@type'];
  return Array.isArray(type) ? type.some(t => String(t).toLowerCase() === 'jobposting') : String(type || '').toLowerCase() === 'jobposting';
}
function readIdentifier(identifier: any): string | undefined {
  if (!identifier) return undefined;
  if (typeof identifier === 'string' || typeof identifier === 'number') return String(identifier);
  if (Array.isArray(identifier)) return readIdentifier(identifier[0]);
  return identifier.value || identifier.name || undefined;
}
function readJobLocation(location: any): string | null {
  if (!location) return null;
  if (typeof location === 'string') return cleanLocationCandidate(location);
  const loc = Array.isArray(location) ? location[0] : location;
  if (loc === 'TELECOMMUTE' || loc?.['@type'] === 'VirtualLocation') return 'Remote';
  const address = loc?.address || loc;
  const parts = [address?.addressLocality, address?.addressRegion, address?.addressCountry?.name || address?.addressCountry].filter(Boolean).map(String);
  return parts.length ? parts.join(', ') : null;
}
function readJobCountry(location: any): string | null {
  const loc = Array.isArray(location) ? location[0] : location;
  const address = loc?.address || loc;
  const country = address?.addressCountry?.name || address?.addressCountry;
  return normalizeCountry(country);
}
function normalizeCountry(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^[a-z]{2}$/i.test(raw)) return raw.toUpperCase();
  const map: Record<string, string> = {
    'united states': 'US', usa: 'US', 'united kingdom': 'GB', 'great britain': 'GB', germany: 'DE', canada: 'CA',
    australia: 'AU', iraq: 'IQ', kuwait: 'KW', qatar: 'QA', bahrain: 'BH', poland: 'PL', japan: 'JP',
    'south korea': 'KR', korea: 'KR', mexico: 'MX', spain: 'ES', italy: 'IT', greece: 'GR', france: 'FR',
  };
  return map[raw.toLowerCase()] || null;
}
function splitCity(location?: string | null): string | null { if (!location || /^remote$/i.test(location)) return null; return location.split(',')[0]?.trim() || null; }
function splitState(location?: string | null): string | null { if (!location || /^remote$/i.test(location)) return null; return location.split(',')[1]?.trim() || null; }
function absolutize(url: string, baseUrl: string): string { try { return new URL(url, baseUrl).toString(); } catch { return baseUrl; } }
function cleanText(value: unknown): string {
  return stripHtmlEntities(String(value || ''))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function stripHtmlEntities(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}
function sameJob(a: ParsedJob, b: ParsedJob) { return normalizeTitle(a.title) === normalizeTitle(b.title) || a.url === b.url; }
function normalizeTitle(value: string) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function extractLocationFromText(value: string) { const match = value.match(/\b([A-Z][a-zA-Z .'-]+,\s*[A-Z]{2})\b/); return match?.[1] || null; }
function detectCountryFromLocation(value?: string | null) {
  if (!value) return null;
  if (/kuwait/i.test(value)) return 'KW'; if (/qatar/i.test(value)) return 'QA'; if (/bahrain/i.test(value)) return 'BH';
  if (/iraq/i.test(value)) return 'IQ'; if (/germany/i.test(value)) return 'DE'; if (/united kingdom|\buk\b/i.test(value)) return 'GB';
  if (/poland/i.test(value)) return 'PL'; if (/australia/i.test(value)) return 'AU'; if (/japan/i.test(value)) return 'JP';
  if (/united states|usa|\b[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}\b/.test(value)) return 'US'; return null;
}
function cleanLocationCandidate(value: string) {
  return value.replace(/\s+/g, ' ').replace(/^(location|work location|job location|primary location|office location)\s*[:\-–—]\s*/i, '').replace(/[.;,\s]+$/g, '').trim();
}
function getPositiveIntegerEnv(name: string, fallback: number) { const parsed = Number(process.env[name]); return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback; }
function hashString(value: string): string { let hash = 5381; for (let i = 0; i < value.length; i++) { hash = ((hash << 5) + hash) + value.charCodeAt(i); hash &= hash; } return `career-${Math.abs(hash)}`; }
