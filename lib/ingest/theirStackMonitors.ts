import monitorData from '../../config/theirstack-monitors.json';

export type TheirStackPortal = 'current_clients' | 'prospects' | 'private_companies' | 'federal_agencies' | 'state_agencies' | 'counties_and_cities';
export type TheirStackEnvKey = 'THEIRSTACK_API_KEY' | 'THEIRSTACK_API_KEY_2' | 'THEIRSTACK_API_KEY_3' | 'THEIRSTACK_API_KEY_4' | 'THEIRSTACK_API_KEY_5';

export type TheirStackMonitor = {
  name: string;
  envKey: TheirStackEnvKey;
  portal: TheirStackPortal;
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

// config/theirstack-monitors.json is the one authoritative key-to-employer map.
export const THEIRSTACK_MONITORS: TheirStackMonitor[] = monitorData.map((row) => {
  const envKey = String(row.envKey) as TheirStackEnvKey;
  const portal = String(row.portal) as TheirStackPortal;
  const name = String(row.name || '').trim();
  if (!name || !VALID_KEYS.has(envKey) || !VALID_PORTALS.has(portal)) {
    throw new Error(`Invalid TheirStack monitor registry row: ${JSON.stringify(row)}`);
  }
  return { name, envKey, portal };
});

export function monitorsForEntity(entity: { name?: string | null; aliases?: string[] | null }) {
  const names = [entity?.name, ...(Array.isArray(entity?.aliases) ? entity.aliases : [])]
    .map(normalizeName)
    .filter(Boolean);
  if (!names.length) return [];
  return dedupeAssignments(THEIRSTACK_MONITORS.filter(monitor => names.includes(normalizeName(monitor.name))));
}

export function uniqueTheirStackMonitors() {
  return dedupeAssignments(THEIRSTACK_MONITORS);
}

function dedupeAssignments(monitors: TheirStackMonitor[]) {
  const seen = new Set<string>();
  return monitors.filter(monitor => {
    // Peraton intentionally exists under two different keys, so the key is part
    // of the identity. Accidental duplicates within the same key collapse here.
    const key = `${monitor.envKey}|${normalizeName(monitor.name)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeName(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
