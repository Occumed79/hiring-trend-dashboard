import { query } from '@/db/client';

export type DirectoryEntry = {
  directory_key: string;
  entry_key: string;
  entry_type: string;
  state_code: string | null;
  organization_name: string;
  source_url: string | null;
  jobs_url: string | null;
  source_class: 'authoritative' | 'verified' | 'supplemental';
  lineage_root: string;
  metadata: Record<string, any>;
};

const STATE_CODES: Record<string,string> = {
  alabama:'AL',alaska:'AK',arizona:'AZ',arkansas:'AR',california:'CA',colorado:'CO',connecticut:'CT',delaware:'DE',florida:'FL',georgia:'GA',hawaii:'HI',idaho:'ID',illinois:'IL',indiana:'IN',iowa:'IA',kansas:'KS',kentucky:'KY',louisiana:'LA',maine:'ME',maryland:'MD',massachusetts:'MA',michigan:'MI',minnesota:'MN',mississippi:'MS',missouri:'MO',montana:'MT',nebraska:'NE',nevada:'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND',ohio:'OH',oklahoma:'OK',oregon:'OR',pennsylvania:'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD',tennessee:'TN',texas:'TX',utah:'UT',vermont:'VT',virginia:'VA',washington:'WA','west virginia':'WV',wisconsin:'WI',wyoming:'WY','district of columbia':'DC',dc:'DC'
};
const VALID_CODES = new Set(Object.values(STATE_CODES));

export async function readDirectoryEntriesForEntity(entity: any): Promise<DirectoryEntry[]> {
  const portal = String(entity?.portal || '');
  const state = inferStateCode(entity);
  const entries: DirectoryEntry[] = [];

  if (portal === 'state_agencies' && state) {
    entries.push(...await safeQuery(
      `SELECT directory_key, entry_key, entry_type, state_code, organization_name, source_url, jobs_url,
              source_class, lineage_root, metadata
       FROM source_directory_entries
       WHERE is_active = true AND entry_type = 'state_jobs' AND state_code = $1
       ORDER BY directory_key, entry_key`,
      [state],
    ));
  }

  if (portal === 'counties_and_cities' && state) {
    entries.push(...await safeQuery(
      `SELECT directory_key, entry_key, entry_type, state_code, organization_name, source_url, jobs_url,
              source_class, lineage_root, metadata
       FROM source_directory_entries
       WHERE is_active = true AND state_code = $1 AND entry_type IN ('municipal_league','county_association')
       ORDER BY entry_type, organization_name`,
      [state],
    ));
  }

  if (portal === 'federal_agencies') {
    const federal = await safeQuery(
      `SELECT directory_key, entry_key, entry_type, state_code, organization_name, source_url, jobs_url,
              source_class, lineage_root, metadata
       FROM source_directory_entries
       WHERE is_active = true AND entry_type = 'federal_exception'
       ORDER BY organization_name`,
      [],
    );
    entries.push(...federal.filter((entry: DirectoryEntry) => matchesFederalEntry(entity, entry)));
  }

  return dedupe(entries);
}

export async function readAssociationEntriesForEntity(entity: any): Promise<DirectoryEntry[]> {
  const state = inferStateCode(entity);
  if (!state || String(entity?.portal || '') !== 'counties_and_cities') return [];
  return dedupe(await safeQuery(
    `SELECT directory_key, entry_key, entry_type, state_code, organization_name, source_url, jobs_url,
            source_class, lineage_root, metadata
     FROM source_directory_entries
     WHERE is_active = true AND state_code = $1 AND entry_type IN ('municipal_league','county_association')
     ORDER BY entry_type, organization_name`,
    [state],
  ));
}

export function inferStateCode(entity: any): string | null {
  for (const raw of [entity?.government_state, entity?.state, entity?.state_code]) {
    const code = normalizeState(raw);
    if (code) return code;
  }

  const names = [entity?.name, ...(Array.isArray(entity?.aliases) ? entity.aliases : [])]
    .map((value: unknown) => String(value || '').trim())
    .filter(Boolean);
  for (const value of names) {
    const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
    for (const [stateName, code] of Object.entries(STATE_CODES).sort((a,b)=>b[0].length-a[0].length)) {
      if (` ${normalized} `.includes(` ${stateName} `)) return code;
    }
    const codeMatch = value.toUpperCase().match(/(?:^|[\s,(\-])([A-Z]{2})(?=$|[\s,)\-])/g)?.map(token=>token.replace(/[^A-Z]/g,'')) || [];
    for (const code of codeMatch) if (VALID_CODES.has(code)) return code;
  }

  try {
    const url = new URL(String(entity?.career_page_url || entity?.website || ''));
    const govMatch = url.hostname.toLowerCase().match(/\.([a-z]{2})\.gov$/);
    if (govMatch && VALID_CODES.has(govMatch[1].toUpperCase())) return govMatch[1].toUpperCase();
  } catch {}
  return null;
}

function matchesFederalEntry(entity: any, entry: DirectoryEntry) {
  const haystack = comparable([entity?.name, ...(Array.isArray(entity?.aliases) ? entity.aliases : [])].filter(Boolean).join(' | '));
  const patterns = Array.isArray(entry.metadata?.match_patterns) ? entry.metadata.match_patterns : [];
  return patterns.some((pattern: unknown) => {
    const needle = comparable(pattern);
    return needle.length >= 3 && (` ${haystack} `.includes(` ${needle} `) || haystack === needle);
  });
}

function normalizeState(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (VALID_CODES.has(upper)) return upper;
  return STATE_CODES[raw.toLowerCase().replace(/[^a-z ]+/g,' ').replace(/\s+/g,' ').trim()] || null;
}
async function safeQuery(sql: string, params: any[]) {
  try { return await query(sql, params) as DirectoryEntry[]; }
  catch { return []; }
}
function comparable(value: unknown) { return String(value || '').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim(); }
function dedupe(rows: DirectoryEntry[]) { const seen = new Set<string>(); return rows.filter(row => { const key = `${row.directory_key}|${row.entry_key}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
