export async function fetchCareerPageJobs(careerPageUrl: string, companyName: string) {
  const html = await fetchCareerHtml(careerPageUrl);
  if (!html) return [];

  const jobs = [
    ...extractJsonLdJobs(html, careerPageUrl),
    ...extractLinkedJobs(html, careerPageUrl),
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
      is_overseas: false,
      posted_at: job.posted_at || null,
      raw_data: {
        companyName,
        careerPageUrl,
        url: job.url,
        parser: job.parser,
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
}

async function fetchCareerHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'OccuMedHiringTrendDashboard/1.0 (+https://github.com/Occumed79/hiring-trend-dashboard)',
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    return await res.text();
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
          external_id: node.identifier?.value || node.identifier || undefined,
          title: node.title || node.name || 'Untitled role',
          department: node.employmentType || null,
          location: readJobLocation(node.jobLocation),
          country: readJobCountry(node.jobLocation),
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
    if (!href || !text || text.length < 4 || text.length > 140) continue;

    const absolute = absolutize(href, baseUrl);
    const lower = `${absolute} ${text}`.toLowerCase();
    const looksLikeJob = /job|career|opening|position|posting|requisition|req/.test(lower);
    const junk = /privacy|terms|cookie|login|sign in|talent community|job alert|saved jobs|view all/i.test(text);
    if (!looksLikeJob || junk) continue;

    results.push({
      title: text,
      location: null,
      country: 'US',
      url: absolute,
      parser: 'anchor_link',
    });
  }

  return results.slice(0, 250);
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

function readJobLocation(location: any): string | null {
  const loc = Array.isArray(location) ? location[0] : location;
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
  return String(country).slice(0, 2).toUpperCase();
}

function splitCity(location?: string | null): string | null {
  if (!location) return null;
  return location.split(',')[0]?.trim() || null;
}

function splitState(location?: string | null): string | null {
  if (!location) return null;
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
    .replace(/&gt;/g, '>');
}

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) + value.charCodeAt(i);
    hash = hash & hash;
  }
  return `career-${Math.abs(hash)}`;
}
