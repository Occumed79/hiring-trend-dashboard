import type { CoverageCheck } from './neogovFeed';

const ENDPOINT = 'https://api.langsearch.com/v1/web-search';

type Board = {
  id: string;
  domains: string[];
  directPath: RegExp;
  label: string;
};

const BOARDS: Board[] = [
  { id: 'board:icma', domains: ['icma.org'], directPath: /\/job-posts\/\d+/i, label: 'ICMA Job Center' },
  { id: 'board:naco', domains: ['naco.org','jobs.naco.org'], directPath: /\/(?:job|jobs|career|careers)[/?#-]/i, label: 'NACo Career Center' },
  { id: 'board:careersingovernment', domains: ['careersingovernment.com'], directPath: /\/job\/\d+\//i, label: 'Careers in Government' },
];

export async function fetchPublicSectorBoardJobs(entity: any): Promise<{ jobs: any[]; checks: CoverageCheck[] }> {
  if (!['state_agencies','counties_and_cities'].includes(String(entity?.portal || ''))) return { jobs: [], checks: [] };
  const keys = readKeys();
  if (!keys.length) {
    return { jobs: [], checks: BOARDS.map(board => ({ source: board.id, source_class: 'supplemental', status: 'skipped', jobs_found: 0, details: { reason: 'LangSearch key missing', board: board.label } })) };
  }

  const results = await Promise.all(BOARDS.map(board => fetchOneBoard(board, entity, keys)));
  return { jobs: results.flatMap(result => result.jobs), checks: results.map(result => result.check) };
}

async function fetchOneBoard(board: Board, entity: any, keys: string[]) {
  const names = [entity?.name, ...(Array.isArray(entity?.aliases) ? entity.aliases : [])].map(value => String(value || '').trim()).filter(Boolean).slice(0,4);
  const quoted = names.map(name => `"${name}"`).join(' OR ');
  const query = `Find current open job-detail pages on ${board.domains[0]} where the employer is ${quoted}. Return direct individual job pages, not search/category pages.`;
  let lastError = '';

  for (const key of keys) {
    try {
      const response = await fetch(process.env.LANGSEARCH_API_URL || process.env.LANGSEARCH_ENDPOINT || ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, freshness: 'oneMonth', summary: true, count: 10 }),
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        if ([401,402,403,429].includes(response.status)) continue;
        break;
      }
      const payload = await response.json().catch(() => null);
      const pages = Array.isArray(payload?.data?.webPages?.value) ? payload.data.webPages.value : [];
      const jobs = pages.map((page: any, index: number) => normalizeBoardPage(page, board, entity, index)).filter(Boolean) as any[];
      return {
        jobs: dedupe(jobs),
        check: { source: board.id, source_class: 'supplemental', status: jobs.length ? 'success' : 'zero', jobs_found: jobs.length, details: { board: board.label, search_results: pages.length } } as CoverageCheck,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    jobs: [],
    check: { source: board.id, source_class: 'supplemental', status: 'error', jobs_found: 0, details: { board: board.label, error: lastError || 'search failed' } } as CoverageCheck,
  };
}

function normalizeBoardPage(page: any, board: Board, entity: any, index: number) {
  const url = normalizeUrl(page?.url || page?.displayUrl);
  if (!url) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (!board.domains.some(domain => sameOrSubdomain(parsed.hostname, domain))) return null;
  if (!board.directPath.test(`${parsed.pathname}${parsed.search}`)) return null;

  const originalTitle = clean(page?.name);
  const snippet = clean(`${page?.snippet || ''} ${page?.summary || ''}`) || '';
  if (!originalTitle || !hasEmployerEvidence(`${originalTitle} ${snippet}`, entity)) return null;
  const title = cleanTitle(originalTitle, entity);
  if (!title || title.length < 3 || title.length > 180) return null;
  const location = extractLocation(`${originalTitle} ${snippet}`);
  const state = extractState(location);
  const country = 'US';
  return {
    external_id: `${board.id}-${hashString(url)}`,
    source: board.id,
    title,
    department: entity?.name || null,
    location,
    city: location?.split(',')[0]?.trim() || null,
    state,
    country,
    lat: null,
    lng: null,
    is_remote: /\b(remote|virtual|telework)\b/i.test(`${originalTitle} ${snippet}`),
    is_overseas: false,
    posted_at: normalizeDate(page?.datePublished),
    raw_data: {
      normalized_apply_url: url,
      normalized_employer: entity?.name || null,
      normalized_employer_match: 'board-page-employer-evidence',
      board: board.label,
      board_result_title: originalTitle,
      board_result_snippet: snippet,
      search_result_index: index,
      parser: 'verified_public_sector_board_search',
    },
  };
}

function hasEmployerEvidence(text: string, entity: any) {
  const haystack = comparable(text);
  const names = [entity?.name, ...(Array.isArray(entity?.aliases) ? entity.aliases : [])]
    .map(comparable).filter((value: string) => value.length >= 4);
  return names.some((name: string) => containsPhrase(haystack, name) || containsPhrase(haystack, stripGovernmentPrefix(name)));
}
function cleanTitle(title: string, entity: any) {
  let value = title.replace(/\s*[|–—-]\s*(?:ICMA|Careers in Government|NACo).*$/i,'').trim();
  const names = [entity?.name, ...(Array.isArray(entity?.aliases) ? entity.aliases : [])].map((name: any) => String(name || '').trim()).filter(Boolean);
  for (const name of names) value = value.replace(new RegExp(`\\s*[|–—-]\\s*${escapeRegExp(name)}.*$`, 'i'), '').trim();
  return value;
}
function extractLocation(value: string) {
  const labeled = value.match(/\b(?:location|address)\s*[:\-–—]\s*([^|;]{2,90})/i);
  if (labeled?.[1]) return labeled[1].trim();
  const cityState = value.match(/\b([A-Z][A-Za-z.' -]{1,48},\s*(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY))\b/);
  return cityState?.[1] || null;
}
function extractState(location: string | null) { const match = location?.match(/,\s*([A-Z]{2})\b/); return match?.[1] || null; }
function readKeys() { return Array.from(new Set(['LANGSEARCH_API_KEY','LANGSEARCH-API-KEY','LANG_SEARCH_API_KEY','LANGSEARCH_API_KEY_2','LANGSEARCH-API-KEY-2','LANG_SEARCH_API_KEY_2'].map(name => String(process.env[name] || '').trim()).filter(Boolean))); }
function normalizeUrl(value: unknown) { try { const url = new URL(String(value || '').trim()); return ['http:','https:'].includes(url.protocol) ? url.toString() : null; } catch { return null; } }
function sameOrSubdomain(host: string, domain: string) { const h = host.toLowerCase().replace(/^www\./,''); const d = domain.toLowerCase().replace(/^www\./,''); return h === d || h.endsWith(`.${d}`); }
function comparable(value: unknown) { return String(value || '').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim(); }
function stripGovernmentPrefix(value: string) { return value.replace(/^(?:city|county|state|town|village|borough) of /,'').replace(/ (?:city|county)$/, '').trim(); }
function containsPhrase(haystack: string, needle: string) { return needle.length >= 4 && ` ${haystack} `.includes(` ${needle} `); }
function clean(value: unknown) { const text = String(value || '').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); return text || null; }
function normalizeDate(value: unknown) { if (!value) return null; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
function hashString(value: string) { let hash = 2166136261; for (let i=0;i<value.length;i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash,16777619); } return (hash>>>0).toString(36); }
function dedupe(jobs: any[]) { const seen = new Set<string>(); return jobs.filter(job => { const key = String(job.raw_data?.normalized_apply_url || job.external_id).toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; }); }
