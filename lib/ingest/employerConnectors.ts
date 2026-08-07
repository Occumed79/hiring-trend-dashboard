import { getIngestTimeout } from './http';

type SpecializedResult = { handled: boolean; jobs: any[]; source: string | null };

export async function fetchSpecializedEmployerJobs(entityName: string, provider: string, careerPageUrl: string | null): Promise<SpecializedResult> {
  const name = normalizeName(entityName);
  if (!careerPageUrl) return { handled: false, jobs: [], source: null };

  if (/\b(?:v2x|vectrus)\b/.test(name) || provider === 'jibeapply') {
    return { handled: true, jobs: await fetchJibeApplyJobs(careerPageUrl, entityName), source: 'jibeapply' };
  }
  if (/\bids international\b/.test(name) || provider === 'jazzhr') {
    return { handled: true, jobs: await fetchJazzHRJobs(careerPageUrl, entityName), source: 'jazzhr' };
  }
  if (/\bamentum\b/.test(name) && /amentumcareers\.com/i.test(careerPageUrl)) {
    return { handled: true, jobs: await fetchPaginatedCareerTableJobs(careerPageUrl, entityName), source: 'amentum_careers' };
  }
  return { handled: false, jobs: [], source: null };
}

export async function fetchJibeApplyJobs(careerPageUrl: string, companyName: string) {
  const apiUrl = jibeApiUrl(careerPageUrl);
  if (!apiUrl) return [];
  try {
    const first = await fetchJson(apiUrl);
    const firstJobs = Array.isArray(first?.jobs) ? first.jobs : [];
    const total = safeInt(first?.totalCount, firstJobs.length);
    const pageSize = firstJobs.length || safeInt(first?.count, 10) || 10;
    const pages = Math.min(Math.max(1, Math.ceil(total / Math.max(pageSize, 1))), 300);
    const all = [...firstJobs];

    for (let page = 2; page <= pages; page++) {
      const url = new URL(apiUrl);
      url.searchParams.set('page', String(page));
      try {
        const payload = await fetchJson(url.toString());
        const rows = Array.isArray(payload?.jobs) ? payload.jobs : [];
        if (!rows.length) break;
        all.push(...rows);
      } catch (error) {
        console.error(`JibeApply page ${page} fetch error:`, error);
        break;
      }
    }

    const base = new URL(careerPageUrl);
    const basePath = base.pathname.replace(/\/+$/, '');
    return all.map((item: any) => {
      const data = item?.data ?? item ?? {};
      const title = clean(data.title);
      const slug = clean(data.slug) || clean(data.req_id) || clean(data.reqId) || clean(data.id);
      if (!title || !slug) return null;
      const location = clean(data.full_location) || joinLocation(data.city, data.state, data.country);
      const country = normalizeCountry(data.country || countryFromLocation(location));
      const detailUrl = new URL(`${basePath}/${encodeURIComponent(slug)}`, base.origin).toString();
      return {
        external_id: String(data.req_id || data.reqId || data.id || slug),
        source: 'jibeapply',
        title,
        department: clean(data.category) || clean(data.department),
        location,
        city: clean(data.city) || splitCity(location),
        state: clean(data.state) || splitState(location),
        country,
        lat: toNumber(data.latitude || data.lat),
        lng: toNumber(data.longitude || data.lng || data.lon),
        is_remote: /\b(remote|virtual|work from home)\b/i.test(`${title} ${location || ''} ${data.workplace_type || ''}`),
        is_overseas: country ? country !== 'US' : false,
        posted_at: normalizeDate(data.posted_date || data.postedDate || data.date_posted || data.created_at),
        raw_data: {
          ...data,
          normalized_apply_url: detailUrl,
          normalized_employer_source: 'jibeapply-public-api',
          parser: 'structured_jibeapply_api',
          companyName,
        },
      };
    }).filter(Boolean);
  } catch (error) {
    console.error('JibeApply fetch error:', error);
    return [];
  }
}

export async function fetchJazzHRJobs(careerPageUrl: string, companyName: string) {
  try {
    const boardUrl = normalizeJazzBoardUrl(careerPageUrl);
    const html = await fetchText(boardUrl);
    if (!html) return [];
    const rows = extractTableRows(html);
    const jobs: any[] = [];

    for (const row of rows) {
      const anchor = firstAnchor(row);
      if (!anchor) continue;
      const absolute = absolutize(anchor.href, boardUrl);
      if (!/applytojob\.com\/apply\/(?:jobs\/details\/)?[A-Za-z0-9_-]{4,}/i.test(absolute)) continue;
      const cells = extractCells(row);
      const title = cleanText(anchor.text);
      if (!title) continue;
      const location = cells.length >= 2 ? cleanText(cells[cells.length - 1]) : null;
      const department = cells.length >= 3 ? cleanText(cells[cells.length - 2]) : null;
      const id = absolute.match(/\/(?:details\/)?([A-Za-z0-9_-]+)(?:[/?#]|$)/i)?.[1] || absolute;
      const country = normalizeCountry(countryFromLocation(location));
      jobs.push({
        external_id: id,
        source: 'jazzhr',
        title,
        department: department && department !== title ? department : null,
        location,
        city: splitCity(location),
        state: splitState(location),
        country,
        lat: null,
        lng: null,
        is_remote: /\b(remote|virtual|work from home)\b/i.test(`${title} ${location || ''}`),
        is_overseas: country ? country !== 'US' : false,
        posted_at: null,
        raw_data: {
          normalized_apply_url: absolute,
          normalized_employer_source: 'jazzhr-public-board',
          parser: 'structured_jazzhr_table',
          companyName,
        },
      });
    }
    return dedupeByUrl(jobs);
  } catch (error) {
    console.error('JazzHR fetch error:', error);
    return [];
  }
}

export async function fetchPaginatedCareerTableJobs(careerPageUrl: string, companyName: string) {
  const firstUrl = withPage(careerPageUrl, 1);
  const firstHtml = await fetchText(firstUrl);
  if (!firstHtml) return [];
  const firstJobs = parseAmentumTable(firstHtml, firstUrl, companyName);
  const total = parseTotalCount(firstHtml) || firstJobs.length;
  const perPage = Math.max(firstJobs.length, 30);
  const pageCount = Math.min(Math.max(1, Math.ceil(total / perPage)), 150);
  if (pageCount === 1) return firstJobs;

  const jobs = [...firstJobs];
  const concurrency = 8;
  for (let start = 2; start <= pageCount; start += concurrency) {
    const pageNumbers = Array.from({ length: Math.min(concurrency, pageCount - start + 1) }, (_, index) => start + index);
    const batches = await Promise.all(pageNumbers.map(async (page) => {
      try {
        const url = withPage(careerPageUrl, page);
        const html = await fetchText(url);
        return html ? parseAmentumTable(html, url, companyName) : [];
      } catch (error) {
        console.error(`Career table page ${page} fetch error:`, error);
        return [];
      }
    }));
    for (const batch of batches) jobs.push(...batch);
  }
  return dedupeByUrl(jobs);
}

function parseAmentumTable(html: string, pageUrl: string, companyName: string) {
  const rows = extractTableRows(html);
  const jobs: any[] = [];
  for (const row of rows) {
    const anchor = firstAnchor(row);
    if (!anchor) continue;
    const absolute = absolutize(anchor.href, pageUrl);
    if (!/amentumcareers\.com\/jobs\/(?!search(?:[/?#]|$))[^/?#]{5,}/i.test(absolute)) continue;
    const cells = extractCells(row);
    const title = cleanText(anchor.text);
    if (!title) continue;
    const req = cells.map(cleanText).find((cell) => /^R\d{4,}$/i.test(cell || '')) || absolute;
    const location = cells.length >= 4 ? cleanText(cells[3]) : findLocationCell(cells);
    const country = normalizeCountry(countryFromLocation(location));
    jobs.push({
      external_id: req,
      source: 'amentum_careers',
      title,
      department: null,
      location,
      city: splitCity(location),
      state: splitState(location),
      country,
      lat: null,
      lng: null,
      is_remote: /\bremote\b/i.test(row) || /\b(remote|virtual|work from home)\b/i.test(`${title} ${location || ''}`),
      is_overseas: country ? country !== 'US' : false,
      posted_at: null,
      raw_data: {
        normalized_apply_url: absolute,
        normalized_employer_source: 'amentum-paginated-career-table',
        parser: 'structured_paginated_career_table',
        companyName,
      },
    });
  }
  return jobs;
}

function jibeApiUrl(careerPageUrl: string) {
  try {
    const url = new URL(careerPageUrl);
    if (url.protocol !== 'https:') return null;
    if (!url.pathname.startsWith('/api/')) url.pathname = `/api${url.pathname.startsWith('/') ? url.pathname : `/${url.pathname}`}`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch { return null; }
}
function normalizeJazzBoardUrl(value: string) {
  const url = new URL(value);
  if (!/\/apply\/jobs\/?$/i.test(url.pathname)) url.pathname = '/apply/jobs/';
  url.search = ''; url.hash = '';
  return url.toString();
}
function withPage(value: string, page: number) { const url = new URL(value); url.searchParams.set('page', String(page)); return url.toString(); }
async function fetchText(url: string) {
  const response = await fetch(url, { redirect: 'follow', headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'OccuMedHiringTrendDashboard/1.0' }, signal: AbortSignal.timeout(getIngestTimeout(12000)) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
async function fetchJson(url: string) {
  const response = await fetch(url, { redirect: 'follow', headers: { Accept: 'application/json', 'User-Agent': 'OccuMedHiringTrendDashboard/1.0' }, signal: AbortSignal.timeout(getIngestTimeout(12000)) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
function extractTableRows(html: string) { return Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi), (match) => match[1]); }
function extractCells(row: string) { return Array.from(row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi), (match) => match[1]); }
function firstAnchor(row: string) { const match = row.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i); return match ? { href: decodeEntities(match[1]), text: match[2] } : null; }
function cleanText(value: unknown) { const text = decodeEntities(String(value || '')).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); return text || null; }
function clean(value: unknown) { const text = String(value || '').trim(); return text || null; }
function decodeEntities(value: string) { return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;|&#160;/g, ' '); }
function absolutize(value: string, base: string) { try { return new URL(value, base).toString(); } catch { return base; } }
function joinLocation(...parts: unknown[]) { const values = parts.map(clean).filter(Boolean); return values.length ? values.join(', ') : null; }
function splitCity(location?: string | null) { if (!location || /^remote$/i.test(location)) return null; return location.split(',')[0]?.trim() || null; }
function splitState(location?: string | null) { if (!location || /^remote$/i.test(location)) return null; return location.split(',')[1]?.trim() || null; }
function findLocationCell(cells: string[]) { return cells.map(cleanText).find((value) => value && (/,/.test(value) || /\b(?:United States|United Kingdom|Germany|Kuwait|Qatar|Australia|Japan|Poland|Remote)\b/i.test(value))) || null; }
function parseTotalCount(html: string) { const match = cleanText(html)?.match(/Displaying\s+\d+\s*[-–]\s*\d+\s+of\s+([\d,]+)\s+in total/i); return match ? Number(match[1].replace(/,/g, '')) : 0; }
function dedupeByUrl(rows: any[]) { const map = new Map<string, any>(); for (const row of rows) { const url = String(row.raw_data?.normalized_apply_url || row.external_id); if (!map.has(url)) map.set(url, row); } return Array.from(map.values()); }
function safeInt(value: unknown, fallback: number) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback; }
function toNumber(value: unknown) { if (value === null || value === undefined || value === '') return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function normalizeDate(value: unknown) { if (!value) return null; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function normalizeName(value: unknown) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function normalizeCountry(value: unknown): string | null { const raw = clean(value); if (!raw) return null; const key = raw.toLowerCase(); const map: Record<string,string> = { us:'US', usa:'US','united states':'US','united states of america':'US', uk:'GB',gb:'GB','united kingdom':'GB',canada:'CA',ca:'CA',germany:'DE',de:'DE',kuwait:'KW',qatar:'QA',bahrain:'BH',iraq:'IQ',poland:'PL',australia:'AU',japan:'JP','south korea':'KR',korea:'KR',mexico:'MX',spain:'ES',italy:'IT',greece:'GR',france:'FR','russian federation':'RU',russia:'RU',taiwan:'TW' }; if (map[key]) return map[key]; if (/^[a-z]{2}$/i.test(raw)) return raw.toUpperCase(); return null; }
function countryFromLocation(value?: string | null) { if (!value) return null; const text = value.toLowerCase(); const names = ['united states','united kingdom','canada','germany','kuwait','qatar','bahrain','iraq','poland','australia','japan','south korea','korea','mexico','spain','italy','greece','france','russian federation','russia','taiwan']; return names.find((name) => text.includes(name)) || (/\b[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}\b/.test(value) ? 'united states' : null); }
