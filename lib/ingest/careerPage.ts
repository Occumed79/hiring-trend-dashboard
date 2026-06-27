export async function fetchCareerPageJobs(careerPageUrl: string, companyName: string) {
  const html = await fetchCareerHtml(careerPageUrl);
  if (!html) return [];

  const linkedJobs = extractLinkedJobs(html, careerPageUrl);
  const detailLimit = getPositiveIntegerEnv('CAREER_DETAIL_ENRICH_LIMIT', 75);
  const enrichedLinkedJobs = await enrichLinkedJobsFromDetailPages(linkedJobs, detailLimit);

  const jobs = [
    ...extractJsonLdJobs(html, careerPageUrl),
    ...enrichedLinkedJobs,
  ];

  const seen = new Set<string>();
  return jobs
    .filter(job => job.title && job.url)
    .filter(job => {
      const key = `${job.title}|${job.location || ''}|${job.url}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(job => ({
      external_id: job.external_id || hashString(`${companyName}|${job.title}|${job.url}`),
      source: 'career_page',
      title: job.title,
      department: job.department || null,
      location: job.location || null,
      city: splitCity(job.location),
      state: splitState(job.location),
      country: job.country || 'US',
      lat: null,
      lng: null,
      is_remote: /remote/i.test(`${job.title} ${job.location || ''}`),
      is_overseas: String(job.country || 'US').toUpperCase() !== 'US',
      posted_at: job.posted_at || null,
      raw_data: {
        companyName,
        careerPageUrl,
        url: job.url,
        parser: job.parser,
        detail_enriched: job.detail_enriched || false,
        detail_location_source: job.detail_location_source || null,
        detail_location_candidates: job.detail_location_candidates || [],
      },
    }));
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
  const rest = jobs.slice(limit);
  const concurrency = 5;

  for (let i = 0; i < queue.length; i += concurrency) {
    const batch = queue.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(enrichOneLinkedJob));
    enriched.push(...results);
  }

  return [...enriched, ...rest];
}

async function enrichOneLinkedJob(job: ParsedJob): Promise<ParsedJob> {
  const detailHtml = await fetchCareerHtml(job.url);
  if (!detailHtml) return job;

  const jsonLdJobs = extractJsonLdJobs(detailHtml, job.url);
  const jsonLdHit = jsonLdJobs.find(candidate => sameJob(candidate, job)) || jsonLdJobs[0];
  if (jsonLdHit?.location) {
    return {
      ...job,
      external_id: jsonLdHit.external_id || job.external_id,
      title: jsonLdHit.title || job.title,
      department: jsonLdHit.department || job.department,
      location: jsonLdHit.location,
      country: jsonLdHit.country || job.country,
      posted_at: jsonLdHit.posted_at || job.posted_at,
      parser: `${job.parser}+detail_json_ld`,
      detail_enriched: true,
      detail_location_source: 'detail_json_ld',
      detail_location_candidates: [jsonLdHit.location],
    };
  }

  const candidates = extractLocationCandidatesFromDetailHtml(detailHtml);
  const location = candidates[0] || null;
  return {
    ...job,
    location: location || job.location,
    city: undefined as any,
    country: detectCountryFromLocation(location) || job.country,
    parser: location ? `${job.parser}+detail_html` : job.parser,
    detail_enriched: !!location,
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
      const nodes = flattenJsonLd(parsed);
      for (const node of nodes) {
        if (!isJobPosting(node)) continue;
        const url = absolutize(node.url || node.sameAs || baseUrl, baseUrl);
        results.push({
          external_id: readIdentifier(node.identifier),
          title: node.title || node.name || 'Untitled role',
          department: node.employmentType || node.occupationalCategory || null,
          location: readJobLocation(node.jobLocation || node.applicantLocationRequirements || node.jobLocationType),
          country: readJobCountry(node.jobLocation || node.applicantLocationRequirements),
          posted_at: node.datePosted || node.validThrough || null,
          url,
          parser: 'json_ld',
        });
      }
    } catch {
      // Ignore malformed JSON-LD scripts.
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
    if (!href || !text || text.length < 4 || text.length > 160) continue;

    const absolute = absolutize(href, baseUrl);
    const lower = `${absolute} ${text}`.toLowerCase();
    const looksLikeJob = /job|career|opening|position|posting|requisition|req/.test(lower);
    const junk = /privacy|terms|cookie|login|sign in|talent community|job alert|saved jobs|view all/i.test(text);
    if (!looksLikeJob || junk) continue;

    results.push({
      title: text,
      location: extractLocationFromText(text),
      country: 'US',
      url: absolute,
      parser: 'anchor_link',
    });
  }

  return results.slice(0, 250);
}

function extractLocationCandidatesFromDetailHtml(html: string): string[] {
  const candidates = new Set<string>();
  const text = cleanText(html).slice(0, 120000);

  const patterns = [
    /\b(?:Location|Work Location|Job Location|Primary Location|Office Location|勤務地)\s*[:\-–—]\s*([^|•\n\r]{2,120})/gi,
    /\b(?:City|State|Country)\s*[:\-–—]\s*([^|•\n\r]{2,80})/gi,
    /\b([A-Z][a-zA-Z .'-]+,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY))\b/g,
    /\b(Remote|Hybrid|United States|Kuwait|Qatar|Bahrain|Iraq|Germany|Afghanistan|Djibouti|Japan|Korea)\b/gi,
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
  if (Array.isArray(type)) return type.some(t => String(t).toLowerCase() === 'jobposting');
  return String(type || '').toLowerCase() === 'jobposting';
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
  const parts = [address?.addressLocality, address?.addressRegion, address?.addressCountry?.name || address?.addressCountry]
    .filter(Boolean)
    .map(String);
  return parts.length ? parts.join(', ') : null;
}

function readJobCountry(location: any): string | null {
  const loc = Array.isArray(location) ? location[0] : location;
  const address = loc?.address || loc;
  const country = address?.addressCountry?.name || address?.addressCountry;
  if (!country) return null;
  if (String(country).length === 2) return String(country).toUpperCase();
  if (/united states|usa|us/i.test(String(country))) return 'US';
  if (/united kingdom|uk|great britain/i.test(String(country))) return 'GB';
  if (/germany/i.test(String(country))) return 'DE';
  if (/kuwait/i.test(String(country))) return 'KW';
  if (/qatar/i.test(String(country))) return 'QA';
  if (/bahrain/i.test(String(country))) return 'BH';
  if (/iraq/i.test(String(country))) return 'IQ';
  return String(country).slice(0, 2).toUpperCase();
}

function splitCity(location?: string | null): string | null {
  if (!location || /^remote$/i.test(location)) return null;
  return location.split(',')[0]?.trim() || null;
}

function splitState(location?: string | null): string | null {
  if (!location || /^remote$/i.test(location)) return null;
  return location.split(',')[1]?.trim() || null;
}

function absolutize(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return baseUrl;
  }
}

function cleanText(html: string): string {
  return stripHtmlEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function sameJob(a: ParsedJob, b: ParsedJob) {
  return normalizeTitle(a.title) === normalizeTitle(b.title) || a.url === b.url;
}

function normalizeTitle(value: string) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function extractLocationFromText(value: string) {
  const match = value.match(/\b([A-Z][a-zA-Z .'-]+,\s*[A-Z]{2})\b/);
  return match?.[1] || null;
}

function detectCountryFromLocation(value?: string | null) {
  if (!value) return null;
  if (/kuwait/i.test(value)) return 'KW';
  if (/qatar/i.test(value)) return 'QA';
  if (/bahrain/i.test(value)) return 'BH';
  if (/iraq/i.test(value)) return 'IQ';
  if (/germany/i.test(value)) return 'DE';
  if (/united kingdom|uk/i.test(value)) return 'GB';
  if (/united states|usa|\b[A-Z]{2}\b/.test(value)) return 'US';
  return null;
}

function cleanLocationCandidate(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^(location|work location|job location|primary location|office location)\s*[:\-–—]\s*/i, '')
    .replace(/[.;,\s]+$/g, '')
    .trim();
}

function getPositiveIntegerEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) + value.charCodeAt(i);
    hash = hash & hash;
  }
  return `career-${Math.abs(hash)}`;
}
