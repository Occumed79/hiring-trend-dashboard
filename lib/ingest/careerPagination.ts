import { looksLikeJobDetailUrl } from './jobQuality';

export type CrawledCareerPage = {
  url: string;
  html: string;
};

type PageFetcher = (url: string) => Promise<string | null>;

const PAGE_QUERY_KEYS = new Set([
  'page', 'p', 'pg', 'pageno', 'page_no', 'page-number', 'page_number', 'pagenumber',
  'pageindex', 'page_index', 'offset', 'start', 'from', 'skip', 'first',
]);

export async function crawlCareerListingPages(startUrl: string, fetchPage: PageFetcher): Promise<CrawledCareerPage[]> {
  const canonicalStart = canonicalizeUrl(startUrl);
  if (!canonicalStart) return [];

  const firstHtml = await fetchPage(canonicalStart);
  if (!firstHtml) return [];

  const maxPages = clampPositiveEnv('CAREER_PAGINATION_MAX_PAGES', 75, 1, 250);
  const emptyStop = clampPositiveEnv('CAREER_PAGINATION_EMPTY_STOP', 3, 1, 10);
  const pages: CrawledCareerPage[] = [{ url: canonicalStart, html: firstHtml }];
  const visited = new Set<string>([canonicalStart]);
  const queued = new Set<string>();
  const queue: string[] = [];
  const knownJobKeys = extractJobCandidateKeys(firstHtml, canonicalStart);

  enqueuePaginationLinks(firstHtml, canonicalStart, canonicalStart, queue, queued, visited);

  let consecutivePagesWithoutNewJobs = 0;
  while (queue.length && pages.length < maxPages) {
    const nextUrl = queue.shift()!;
    queued.delete(nextUrl);
    if (visited.has(nextUrl)) continue;
    visited.add(nextUrl);

    const html = await fetchPage(nextUrl);
    if (!html) continue;

    const pageJobKeys = extractJobCandidateKeys(html, nextUrl);
    let newJobs = 0;
    for (const key of Array.from(pageJobKeys)) {
      if (!knownJobKeys.has(key)) {
        knownJobKeys.add(key);
        newJobs++;
      }
    }

    pages.push({ url: nextUrl, html });
    enqueuePaginationLinks(html, nextUrl, canonicalStart, queue, queued, visited);

    if (pageJobKeys.size === 0 || newJobs === 0) consecutivePagesWithoutNewJobs++;
    else consecutivePagesWithoutNewJobs = 0;

    // Protect against broken pagers that loop forever or keep returning the same listing page.
    if (consecutivePagesWithoutNewJobs >= emptyStop) break;
  }

  return pages;
}

function enqueuePaginationLinks(
  html: string,
  currentUrl: string,
  startUrl: string,
  queue: string[],
  queued: Set<string>,
  visited: Set<string>,
) {
  for (const candidate of extractPaginationLinks(html, currentUrl, startUrl)) {
    if (visited.has(candidate) || queued.has(candidate)) continue;
    queued.add(candidate);
    queue.push(candidate);
  }
}

function extractPaginationLinks(html: string, currentUrl: string, startUrl: string): string[] {
  const results = new Set<string>();
  const current = safeUrl(currentUrl);
  const start = safeUrl(startUrl);
  if (!current || !start) return [];

  const anchorRegex = /<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html)) !== null) {
    const attrs = `${match[1] || ''} ${match[3] || ''}`;
    const href = decodeEntities(match[2] || '').trim();
    const text = cleanText(match[4]);
    const candidate = canonicalizeUrl(href, currentUrl);
    if (!candidate || candidate === currentUrl) continue;
    if (!isSameOrigin(candidate, startUrl)) continue;
    if (looksLikeJobDetailUrl(candidate)) continue;
    if (!looksLikePaginationAnchor(attrs, text, candidate, currentUrl, startUrl)) continue;
    results.add(candidate);
  }

  // Some sites expose the next page only through <link rel="next"> in <head>.
  const linkRegex = /<link\b([^>]*?)href=["']([^"']+)["']([^>]*)>/gi;
  while ((match = linkRegex.exec(html)) !== null) {
    const attrs = `${match[1] || ''} ${match[3] || ''}`;
    if (!/\brel\s*=\s*["'][^"']*\bnext\b[^"']*["']/i.test(attrs)) continue;
    const candidate = canonicalizeUrl(decodeEntities(match[2] || ''), currentUrl);
    if (candidate && candidate !== currentUrl && isSameOrigin(candidate, startUrl) && !looksLikeJobDetailUrl(candidate)) {
      results.add(candidate);
    }
  }

  return Array.from(results);
}

function looksLikePaginationAnchor(attrs: string, text: string, candidateUrl: string, currentUrl: string, startUrl: string) {
  const normalizedText = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const normalizedAttrs = decodeEntities(attrs).toLowerCase();

  if (/\brel\s*=\s*["'][^"']*\bnext\b[^"']*["']/i.test(attrs)) return true;
  if (/\b(?:aria-label|title)\s*=\s*["'][^"']*(?:next|page\s*\d+|pagination)[^"']*["']/i.test(attrs)) return true;
  if (/\bdata-(?:page|page-number|page-index)\s*=\s*["']?\d+/i.test(attrs)) return true;
  if (/^(?:next(?:\s+page)?|older(?:\s+jobs?)?|more(?:\s+(?:jobs?|results?))?|load more|show more|›|»|→)$/i.test(normalizedText)) return true;

  const numericLabel = /^\d{1,4}$/.test(normalizedText);
  if (numericLabel && (hasPaginationUrlShape(candidateUrl) || isSiblingNumberedPage(candidateUrl, currentUrl, startUrl))) return true;

  // URL pagination is authoritative even when the visible label is an icon or inaccessible text.
  if (hasPaginationUrlShape(candidateUrl) && isListingFamily(candidateUrl, currentUrl, startUrl)) return true;

  // Common class names can identify pagination when the label itself is just an SVG/icon.
  if (/\b(?:pagination|pager|page-link|next-page|pagination-next)\b/i.test(normalizedAttrs)
      && isListingFamily(candidateUrl, currentUrl, startUrl)) return true;

  return false;
}

function hasPaginationUrlShape(value: string) {
  const url = safeUrl(value);
  if (!url) return false;
  for (const key of Array.from(url.searchParams.keys())) {
    if (PAGE_QUERY_KEYS.has(key.toLowerCase())) return true;
  }
  const path = url.pathname.toLowerCase();
  return /\/(?:page|p)[\/-]?\d+\/?$/.test(path)
    || /\/page[-_]\d+\/?$/.test(path)
    || /\/\d+\/?$/.test(path);
}

function isSiblingNumberedPage(candidateValue: string, currentValue: string, startValue: string) {
  const candidate = safeUrl(candidateValue);
  const current = safeUrl(currentValue);
  const start = safeUrl(startValue);
  if (!candidate || !current || !start) return false;
  if (!/\/\d+\/?$/.test(candidate.pathname)) return false;

  const candidateBase = stripPaginationFromPath(candidate.pathname);
  const currentBase = stripPaginationFromPath(current.pathname);
  const startBase = stripPaginationFromPath(start.pathname);
  return candidateBase === currentBase || candidateBase === startBase;
}

function isListingFamily(candidateValue: string, currentValue: string, startValue: string) {
  const candidate = safeUrl(candidateValue);
  const current = safeUrl(currentValue);
  const start = safeUrl(startValue);
  if (!candidate || !current || !start) return false;
  if (candidate.origin !== start.origin) return false;

  const candidateBase = stripPaginationFromPath(candidate.pathname);
  const currentBase = stripPaginationFromPath(current.pathname);
  const startBase = stripPaginationFromPath(start.pathname);
  if (candidateBase === currentBase || candidateBase === startBase) return true;

  const sharedPrefix = commonPathPrefix(candidateBase, startBase);
  return sharedPrefix >= Math.min(2, startBase.split('/').filter(Boolean).length);
}

function stripPaginationFromPath(pathname: string) {
  return pathname
    .replace(/\/(?:page|p)[\/-]?\d+\/?$/i, '')
    .replace(/\/page[-_]\d+\/?$/i, '')
    .replace(/\/\d+\/?$/, '')
    .replace(/\/+$/, '') || '/';
}

function commonPathPrefix(left: string, right: string) {
  const a = left.split('/').filter(Boolean);
  const b = right.split('/').filter(Boolean);
  let count = 0;
  while (count < a.length && count < b.length && a[count] === b[count]) count++;
  return count;
}

function extractJobCandidateKeys(html: string, baseUrl: string) {
  const keys = new Set<string>();
  const hrefRegex = /href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html)) !== null) {
    const absolute = canonicalizeUrl(decodeEntities(match[1] || ''), baseUrl);
    if (absolute && looksLikeJobDetailUrl(absolute)) keys.add(absolute);
  }

  // Include JobPosting identifiers/URLs so JSON-LD-only listing pages also drive the stop condition correctly.
  const jsonLdRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((match = jsonLdRegex.exec(html)) !== null) {
    const block = decodeEntities(match[1] || '');
    if (!/JobPosting/i.test(block)) continue;
    const urlMatches = Array.from(block.matchAll(/["']url["']\s*:\s*["']([^"']+)["']/gi));
    for (const urlMatch of urlMatches) {
      const absolute = canonicalizeUrl(urlMatch[1], baseUrl);
      if (absolute) keys.add(absolute);
    }
  }
  return keys;
}

function canonicalizeUrl(value: string, base?: string) {
  if (!value || /^\s*(?:javascript:|mailto:|tel:|#)/i.test(value)) return null;
  try {
    const url = base ? new URL(value, base) : new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}

function isSameOrigin(left: string, right: string) {
  const a = safeUrl(left);
  const b = safeUrl(right);
  return !!a && !!b && a.origin === b.origin;
}

function safeUrl(value: string) {
  try { return new URL(value); } catch { return null; }
}

function cleanText(value: unknown) {
  return decodeEntities(String(value || '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;|&#160;/g, ' ');
}

function clampPositiveEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}
