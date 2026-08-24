import monitorData from '../../config/theirstack-monitors.json';
import { query } from '@/db/client';

export type TheirStackPortal = 'current_clients' | 'prospects' | 'private_companies' | 'federal_agencies' | 'state_agencies' | 'counties_and_cities';
export type TheirStackEnvKey = 'THEIRSTACK_API_KEY' | 'THEIRSTACK_API_KEY_2' | 'THEIRSTACK_API_KEY_3' | 'THEIRSTACK_API_KEY_4' | 'THEIRSTACK_API_KEY_5';

export type TheirStackMonitor = {
  name: string;
  envKey: TheirStackEnvKey;
  portal: TheirStackPortal;
  listId?: number | null;
  listName?: string | null;
  source?: 'live_list' | 'config_fallback';
};

const VALID_KEYS = new Set<TheirStackEnvKey>([
  'THEIRSTACK_API_KEY',
  'THEIRSTACK_API_KEY_2',
  'THEIRSTACK_API_KEY_3',
  'THEIRSTACK_API_KEY_4',
  'THEIRSTACK_API_KEY_5',
]);

const VALID_PORTALS = new Set<TheirStackPortal>([
  'current_clients',
  'prospects',
  'private_companies',
  'federal_agencies',
  'state_agencies',
  'counties_and_cities',
]);

// config/theirstack-monitors.json is the bootstrap/fallback map. The daily live
// list sync persists the actual saved-list membership into Neon, and runtime
// reads prefer that state whenever it exists.
export const THEIRSTACK_MONITORS: TheirStackMonitor[] = monitorData.map((row) => {
  const envKey = String(row.envKey) as TheirStackEnvKey;
  const portal = String(row.portal) as TheirStackPortal;
  const name = String(row.name || '').trim();
  if (!name || !VALID_KEYS.has(envKey) || !VALID_PORTALS.has(portal)) {
    throw new Error(`Invalid TheirStack monitor registry row: ${JSON.stringify(row)}`);
  }
  return { name, envKey, portal, source: 'config_fallback' };
});

export function monitorsForEntity(entity: { name?: string | null; aliases?: string[] | null }) {
  return matchEntityMonitors(entity, THEIRSTACK_MONITORS);
}

export async function monitorsForEntityLive(entity: { name?: string | null; aliases?: string[] | null }) {
  const monitors = await loadTheirStackMonitors();
  return matchEntityMonitors(entity, monitors);
}

export function uniqueTheirStackMonitors() {
  return dedupeAssignments(THEIRSTACK_MONITORS);
}

export async function loadTheirStackMonitors(): Promise<TheirStackMonitor[]> {
  try {
    const rows = await query(
      `SELECT env_key, company_name, portal, list_id, list_name, source
       FROM theirstack_monitor_assignments
       WHERE is_active = true
       ORDER BY env_key, company_name`,
    );
    const live = rows.map((row: any) => ({
      name: String(row.company_name || '').trim(),
      envKey: String(row.env_key) as TheirStackEnvKey,
      portal: String(row.portal) as TheirStackPortal,
      listId: row.list_id == null ? null : Number(row.list_id),
      listName: row.list_name || null,
      source: row.source === 'live_list' ? 'live_list' as const : 'config_fallback' as const,
    })).filter((row: TheirStackMonitor) => row.name && VALID_KEYS.has(row.envKey) && VALID_PORTALS.has(row.portal));
    return live.length ? dedupeAssignments(live) : uniqueTheirStackMonitors();
  } catch {
    // First deploys and local dev can run before the live-sync table exists.
    return uniqueTheirStackMonitors();
  }
}

function matchEntityMonitors(entity: { name?: string | null; aliases?: string[] | null }, monitors: TheirStackMonitor[]) {
  const names = [entity?.name, ...(Array.isArray(entity?.aliases) ? entity.aliases : [])]
    .flatMap(value => [normalizeName(value), normalizeCompanyIdentity(value)])
    .filter(Boolean);
  if (!names.length) return [];
  return dedupeAssignments(monitors.filter(monitor => {
    const exact = normalizeName(monitor.name);
    const identity = normalizeCompanyIdentity(monitor.name);
    return names.includes(exact) || names.includes(identity);
  }));
}

function dedupeAssignments(monitors: TheirStackMonitor[]) {
  const seen = new Set<string>();
  return monitors.filter(monitor => {
    // Peraton intentionally exists under two different keys, so the key is part
    // of the identity. Accidental legal-suffix variants within the same key collapse.
    const key = `${monitor.envKey}|${normalizeCompanyIdentity(monitor.name) || normalizeName(monitor.name)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeCompanyIdentity(value: unknown) {
  return normalizeName(value)
    .replace(/\b(?:incorporated|inc|corporation|corp|company|co|limited|ltd|llc|plc|holdings?|group)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
