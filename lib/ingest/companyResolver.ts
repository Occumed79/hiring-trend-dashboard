export type AtsProvider =
  | 'greenhouse'
  | 'lever'
  | 'workday'
  | 'icims'
  | 'taleo'
  | 'smartrecruiters'
  | 'bamboohr'
  | 'jobvite'
  | 'usajobs'
  | 'other'
  | 'unknown';

export interface CompanyResolution {
  name: string;
  aliases: string[];
  career_page_url: string | null;
  ats_provider: AtsProvider;
  ats_board_id: string | null;
  confidence: 'high' | 'medium' | 'low';
  notes: string[];
}

interface AtsDetection {
  ats_provider: AtsProvider;
  ats_board_id: string | null;
  matched_url: string | null;
  confidence: 'high' | 'medium' | 'low';
}

const CAREER_KEYWORDS = ['career', 'careers', 'jobs', 'job openings', 'open roles', 'employment'];

export async function resolveCompany(name: string, suppliedCareerUrl?: string | null): Promise<CompanyResolution> {
  const cleanName = name.trim();
  const aliases = buildAliases(cleanName);
  const notes: string[] = [];

  const career = await discoverCareerPage(cleanName, suppliedCareerUrl || null);
  if (!career.url) {
    notes.push('No career page was auto-discovered. Aggregator/API fallback can still collect lower-confidence matches.');
    return {
      name: cleanName,
      aliases,
      career_page_url: null,
      ats_provider: 'unknown',
      ats_board_id: null,
      confidence: 'low',
      notes,
    };
  }

  const detection = await detectATS(career.url, cleanName, career.html);
  if (detection.ats_provider === 'unknown') {
    notes.push('Career page found, but no supported ATS was detected. Generic career-page parsing will be used.');
  } else {
    notes.push(`Detected ${detection.ats_provider}${detection.ats_board_id ? ` board ${detection.ats_board_id}` : ''}.`);
  }

  return {
    name: cleanName,
    aliases,
    career_page_url: career.url,
    ats_provider: detection.ats_provider,
    ats_board_id: detection.ats_board_id,
    confidence: detection.confidence,
    notes,
  };
}

export async function detectATS(careerPageUrl: string, companyName?: string, suppliedHtml?: string | null): Promise<AtsDetection> {
  const html = suppliedHtml ?? await fetchText(careerPageUrl);
  const urls = [careerPageUrl, ...extractUrls(html || '', careerPageUrl)];

  for (const url of urls) {
    const detected = detectFromUrl(url);
    if (detected.ats_provider !== 'unknown') return detected;
  }

  const lower = (html || '').toLowerCase();
  if (lower.includes('greenhouse')) return { ats_provider: 'greenhouse', ats_board_id: inferSlug(companyName), matched_url: careerPageUrl, confidence: 'low' };
  if (lower.includes('lever.co')) return { ats_provider: 'lever', ats_board_id: inferSlug(companyName), matched_url: careerPageUrl, confidence: 'low' };
  if (lower.includes('smartrecruiters')) return { ats_provider: 'smartrecruiters', ats_board_id: inferSlug(companyName), matched_url: careerPageUrl, confidence: 'low' };
  if (lower.includes('workday') || lower.includes('myworkdayjobs')) return { ats_provider: 'workday', ats_board_id: null, matched_url: careerPageUrl, confidence: 'medium' };
  if (lower.includes('icims')) return { ats_provider: 'icims', ats_board_id: null, matched_url: careerPageUrl, confidence: 'medium' };
  if (lower.includes('successfactors')) return { ats_provider: 'other', ats_board_id: null, matched_url: careerPageUrl, confidence: 'medium' };

  return { ats_provider: 'unknown', ats_board_id: null, matched_url: null, confidence: 'low' };
}

async function discoverCareerPage(companyName: string, suppliedCareerUrl: string | null): Promise<{ url: string | null; html: string | null }> {
  if (suppliedCareerUrl) {
    const normalized = normalizeUrl(suppliedCareerUrl);
    const html = await fetchText(normalized);
    if (html) return { url: normalized, html };
    return { url: normalized, html: null };
  }

  const slug = inferDomainSlug(companyName);
  if (!slug) return { url: null, html: null };

  const candidates = [
    `https://careers.${slug}.com`,
    `https://jobs.${slug}.com`,
    `https://www.${slug}.com/careers`,
    `https://www.${slug}.com/jobs`,
    `https://${slug}.com/careers`,
    `https://${slug}.com/jobs`,
    `https://${slug}.com/career`,
    `https://www.${slug}.com/career`,
  ];

  for (const candidate of candidates) {
    const html = await fetchText(candidate);
    if (!html) continue;
    if (looksLikeCareerPage(candidate, html)) return { url: candidate, html };
  }

  return { url: null, html: null };
}

function detectFromUrl(url: string): AtsDetection {
  const decoded = safeDecode(url);

  const greenhouse = decoded.match(/(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([^/?#&]+)/i)
    || decoded.match(/[?&]for=([^&#]+).*greenhouse/i)
    || decoded.match(/greenhouse\.io\/(?:embed\/job_board\?for=)?([^/?#&]+)/i);
  if (greenhouse?.[1]) {
    return { ats_provider: 'greenhouse', ats_board_id: cleanupToken(greenhouse[1]), matched_url: url, confidence: 'high' };
  }

  const lever = decoded.match(/jobs\.lever\.co\/([^/?#&]+)/i);
  if (lever?.[1]) {
    return { ats_provider: 'lever', ats_board_id: cleanupToken(lever[1]), matched_url: url, confidence: 'high' };
  }

  const smart = decoded.match(/jobs\.smartrecruiters\.com\/([^/?#&]+)/i)
    || decoded.match(/api\.smartrecruiters\.com\/v1\/companies\/([^/?#&]+)/i);
  if (smart?.[1]) {
    return { ats_provider: 'smartrecruiters', ats_board_id: cleanupToken(smart[1]), matched_url: url, confidence: 'high' };
  }

  const bamboo = decoded.match(/https?:\/\/([^./]+)\.bamboohr\.com\/careers/i);
  if (bamboo?.[1]) {
    return { ats_provider: 'bamboohr', ats_board_id: cleanupToken(bamboo[1]), matched_url: url, confidence: 'high' };
  }

  if (/myworkdayjobs\.com|myworkdaysite\.com|workdayjobs\.com/i.test(decoded)) {
    return { ats_provider: 'workday', ats_board_id: null, matched_url: url, confidence: 'medium' };
  }
  if (/icims\.com/i.test(decoded)) {
    return { ats_provider: 'icims', ats_board_id: null, matched_url: url, confidence: 'medium' };
  }
  if (/taleo\.net|oraclecloud\.com\/hcm/i.test(decoded)) {
    return { ats_provider: 'taleo', ats_board_id: null, matched_url: url, confidence: 'medium' };
  }
  if (/jobvite\.com/i.test(decoded)) {
    return { ats_provider: 'jobvite', ats_board_id: null, matched_url: url, confidence: 'medium' };
  }
  if (/successfactors\.com/i.test(decoded)) {
    return { ats_provider: 'other', ats_board_id: null, matched_url: url, confidence: 'medium' };
  }

  return { ats_provider: 'unknown', ats_board_id: null, matched_url: null, confidence: 'low' };
}

function extractUrls(html: string, baseUrl: string): string[] {
  const urls = new Set<string>();
  const hrefRegex = /href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;

  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    try {
      const absolute = new URL(href, baseUrl).toString();
      if (CAREER_KEYWORDS.some(k => absolute.toLowerCase().includes(k)) || detectFromUrl(absolute).ats_provider !== 'unknown') {
        urls.add(absolute);
      }
    } catch {
      // Ignore malformed links.
    }
  }

  return Array.from(urls).slice(0, 80);
}

function looksLikeCareerPage(url: string, html: string): boolean {
  const lowerUrl = url.toLowerCase();
  const lowerHtml = html.toLowerCase();
  return CAREER_KEYWORDS.some(k => lowerUrl.includes(k) || lowerHtml.includes(k));
}

async function fetchText(url: string): Promise<string | null> {
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

function buildAliases(name: string): string[] {
  const aliases = new Set<string>();
  const withoutSuffix = name.replace(/\b(inc\.?|llc|ltd\.?|corp\.?|corporation|company|co\.?|plc)\b/gi, '').replace(/\s+/g, ' ').trim();
  if (withoutSuffix && withoutSuffix.toLowerCase() !== name.toLowerCase()) aliases.add(withoutSuffix);
  return Array.from(aliases);
}

function inferDomainSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\b(inc\.?|llc|ltd\.?|corp\.?|corporation|company|co\.?|plc|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function inferSlug(name?: string): string | null {
  if (!name) return null;
  return inferDomainSlug(name) || null;
}

function normalizeUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

function cleanupToken(token: string): string {
  return token.replace(/^www\./i, '').replace(/\/$/, '').trim();
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
