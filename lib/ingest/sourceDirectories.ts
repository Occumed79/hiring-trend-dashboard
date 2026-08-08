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

export async function readDirectoryEntriesForEntity(entity: any): Promise<DirectoryEntry[]> {
  const portal = String(entity?.portal || '');
  const state = String(entity?.government_state || entity?.state || '').trim().toUpperCase() || null;
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
  const state = String(entity?.government_state || entity?.state || '').trim().toUpperCase();
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

function matchesFederalEntry(entity: any, entry: DirectoryEntry) {
  const haystack = comparable([entity?.name, ...(Array.isArray(entity?.aliases) ? entity.aliases : [])].filter(Boolean).join(' | '));
  const patterns = Array.isArray(entry.metadata?.match_patterns) ? entry.metadata.match_patterns : [];
  return patterns.some((pattern: unknown) => {
    const needle = comparable(pattern);
    return needle.length >= 3 && (` ${haystack} `.includes(` ${needle} `) || haystack === needle);
  });
}

async function safeQuery(sql: string, params: any[]) {
  try { return await query(sql, params) as DirectoryEntry[]; }
  catch { return []; }
}

function comparable(value: unknown) { return String(value || '').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim(); }
function dedupe(rows: DirectoryEntry[]) { const seen = new Set<string>(); return rows.filter(row => { const key = `${row.directory_key}|${row.entry_key}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
