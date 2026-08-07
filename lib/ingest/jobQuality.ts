import { normalizeApplyUrl } from './jobIdentity';

const STRUCTURED_SOURCES = new Set([
  'greenhouse', 'lever', 'smartrecruiters', 'bamboohr', 'ashby', 'recruitee', 'workday', 'usajobs',
  'jazzhr', 'jibeapply', 'amentum_careers',
]);

const LEGACY_WEAK_SOURCES = new Set([
  'serper', 'linkedin', 'monster', 'talent', 'simplyhired', 'indeed', 'glassdoor', 'ziprecruiter',
]);

const GENERIC_TITLE_PATTERNS: RegExp[] = [
  /^(?:careers?|jobs?|job search|search jobs|find jobs|current openings?|open positions?|job openings?)$/i,
  /^(?:see|view|browse|explore)\s+(?:all\s+)?(?:jobs?|openings?|opportunities|positions)$/i,
  /^(?:see|view)\s+all\s+opportunities$/i,
  /^(?:join (?:our|the) team|join our talent community|talent community)$/i,
  /^(?:learn more|click here to learn more|click to learn more|load more|show more)$/i,
  /^(?:go|back|return)(?:\s+back)?\s+to\s+(?:our\s+|the\s+)?(?:career|careers|job|jobs)(?:\s+(?:portal|page|site))?$/i,
  /^(?:career|careers|job|jobs)\s+(?:portal|page|site)$/i,
  /^(?:about|about us|services|experience|veterans|early careers?|career paths?|our military commitment)$/i,
  /^(?:labor law posters?|privacy|terms|cookie policy|skip to content|sign in|login)$/i,
  /^(?:top searches|by location|by category|categories|locations)$/i,
  /^(?:part[- ]time|student|work from home|remote jobs?)$/i,
  /^careers?\s*[-–—|:]\s*.+$/i,
  /^.+\s*[-–—|:]\s*careers?$/i,
  /^.+\s+jobs?\s*(?:&|and)\s*careers?(?:\s+profile)?$/i,
  /^.+\s+inc\.?\s*:\s*jobs?$/i,
  /^\d+\s+.+\s+jobs?\s+(?:hiring|available|openings?)\s+in\b/i,
  /^\$?\d+[^ ]*\s*[-–—]\s*\$?\d+[^ ]*\/hr\s+.+\s+jobs?\b/i,
  /^.+\s+jobs?\s+in\s+[^,]+(?:,\s*[A-Z]{2})?$/i,
];

export type JobQualityResult = { ok: boolean; reason: string | null; applyUrl: string | null; strongDetailUrl: boolean };

export function assessJobQuality(item: any): JobQualityResult {
  const title = cleanTitle(item?.title);
  const source = String(item?.source || '').trim().toLowerCase();
  const applyUrl = normalizeApplyUrl(item);
  const strongDetailUrl = looksLikeJobDetailUrl(applyUrl);
  if (!title) return reject('missing title', applyUrl, strongDetailUrl);
  if (title.length < 3 || title.length > 180) return reject('implausible title length', applyUrl, strongDetailUrl);
  if (looksLikeMarkupOrCss(title)) return reject('markup/css text', applyUrl, strongDetailUrl);
  if (isGenericNavigationTitle(title)) return reject('generic/navigation title', applyUrl, strongDetailUrl);

  const raw = item?.raw_data && typeof item.raw_data === 'object' ? item.raw_data : {};
  const parser = String(raw.parser || '').toLowerCase();
  const hasStructuredEvidence = parser.includes('json_ld') || parser.includes('structured') || raw.normalized_employer_source
    || STRUCTURED_SOURCES.has(source) || source.startsWith('portal:') || source.startsWith('gov:');

  if (source === 'career_page' || source.startsWith('ats:')) {
    if (!hasStructuredEvidence && !strongDetailUrl) return reject('career-page row lacks job-detail evidence', applyUrl, strongDetailUrl);
  }
  if (LEGACY_WEAK_SOURCES.has(source) && !strongDetailUrl) return reject('legacy discovery row lacks a direct job-detail URL', applyUrl, strongDetailUrl);
  if ((source.startsWith('web:') || source.startsWith('jobapi:')) && !strongDetailUrl) return reject('discovery row lacks a direct job-detail URL', applyUrl, strongDetailUrl);
  return { ok: true, reason: null, applyUrl, strongDetailUrl };
}

export function isAuthoritativeJob(item: any) {
  const source = String(item?.source || '').trim().toLowerCase();
  const quality = assessJobQuality(item);
  if (!quality.ok) return false;
  if (STRUCTURED_SOURCES.has(source) || source.startsWith('portal:') || source.startsWith('gov:')) return true;
  if (source.startsWith('ats:')) return quality.strongDetailUrl || hasStructuredParser(item);
  if (source === 'career_page') return quality.strongDetailUrl || hasStructuredParser(item);
  return false;
}

export function isLegacyWeakSource(source: unknown) { return LEGACY_WEAK_SOURCES.has(String(source || '').trim().toLowerCase()); }

export function looksLikeJobDetailUrl(value: unknown): boolean {
  if (!value) return false;
  let url: URL;
  try { url = new URL(String(value)); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const target = `${host}${path}${url.search}`.toLowerCase();
  if (/^\/(?:careers?|jobs?|employment|join-us|join-our-team|work-with-us|apply|jobs\/search)$/i.test(path)) return false;
  if (/\/(?:jobs?|careers?)\/(?:search|categories|locations|saved|alerts?|favorites?)$/i.test(path)) return false;
  const patterns = [
    /\/why-gov2x\/jobs\/\d{3,}(?:$|[/?#])/i,
    /amentumcareers\.com\/jobs\/(?!search(?:[/?#]|$))[^/?#]{5,}/i,
    /applytojob\.com\/apply\/jobs\/details\/[A-Za-z0-9_-]{4,}/i,
    /applytojob\.com\/apply\/[A-Za-z0-9_-]{4,}(?:\/[^/?#]+)?/i,
    /(?:boards|job-boards)\.greenhouse\.io\/[^/]+\/jobs\/\d+/i,
    /jobs\.lever\.co\/[^/]+\/[^/?#]+/i,
    /jobs\.ashbyhq\.com\/[^/]+\/[^/?#]+/i,
    /recruitee\.com\/o\/[^/?#]+/i,
    /(?:myworkdayjobs|myworkdaysite|workdayjobs)\.com\/.+\/job\//i,
    /smartrecruiters\.com\/[^/]+\/\d+/i,
    /bamboohr\.com\/careers\/\d+/i,
    /icims\.com\/jobs\/\d+/i,
    /taleo\.net\/.+(?:jobdetail|requisition)/i,
    /jobvite\.com\/.+(?:job|position)/i,
    /usajobs\.gov\/job\/\d+/i,
    /governmentjobs\.com\/careers\/[^/]+\/jobs\/\d+/i,
    /linkedin\.com\/jobs\/view\/\d+/i,
    /indeed\.com\/viewjob/i,
    /\/jobs?\/(?!search(?:\/|$)|categories(?:\/|$)|locations(?:\/|$))[^/?#]{4,}/i,
    /(?:jobid|job_id|gh_jid|requisitionid|reqid|postingid|jk)=/i,
  ];
  return patterns.some((pattern) => pattern.test(target));
}

export function isGenericNavigationTitle(value: unknown) {
  const title = cleanTitle(value);
  if (!title) return true;
  return GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(title.replace(/\s+/g, ' ').trim()));
}
function hasStructuredParser(item: any) { const parser = String(item?.raw_data?.parser || '').toLowerCase(); return parser.includes('json_ld') || parser.includes('structured'); }
function looksLikeMarkupOrCss(title: string) { return /[{}<>]|(?:^|\s)\.[a-z0-9_-]+\s*\{|display\s*:\s*(?:inline|block)|vertical-align\s*:/i.test(title) || /^(?:css|style|script)\b/i.test(title); }
function cleanTitle(value: unknown) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function reject(reason: string, applyUrl: string | null, strongDetailUrl: boolean): JobQualityResult { return { ok: false, reason, applyUrl, strongDetailUrl }; }
