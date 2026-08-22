export type TheirStackPortal = 'current_clients' | 'prospects' | 'private_companies' | 'federal_agencies' | 'state_agencies' | 'counties_and_cities';

export type TheirStackMonitor = {
  name: string;
  envKey: 'THEIRSTACK_API_KEY' | 'THEIRSTACK_API_KEY_2' | 'THEIRSTACK_API_KEY_3' | 'THEIRSTACK_API_KEY_4' | 'THEIRSTACK_API_KEY_5';
  portal: TheirStackPortal;
};

// Definitive monitor assignments supplied by the user. Keep the spelling here aligned
// with the company names saved in each TheirStack workspace so searches stay precise.
export const THEIRSTACK_MONITORS: TheirStackMonitor[] = [
  ...withKey('THEIRSTACK_API_KEY', 'private_companies', [
    'Northrop Grumman', 'Boeing', 'Safran', 'Parsons Corporation', 'Leonardo',
    'General Atomics', 'United Launch Alliance (ULA)', 'Peckham, Inc.',
  ]),
  ...withKey('THEIRSTACK_API_KEY', 'state_agencies', [
    'Texas Department of Transportation', 'Georgia Department of Transportation',
    'Oregon Department of Transportation', 'Florida Department of Transportation',
  ]),

  ...withKey('THEIRSTACK_API_KEY_2', 'private_companies', [
    'Peraton', 'American Bureau of Shipping',
  ]),
  ...withKey('THEIRSTACK_API_KEY_2', 'counties_and_cities', [
    'Placer County', 'City of Sacramento', 'Sacramento County', 'COUNTY OF MENDOCINO',
    'City of Riverside', 'Solano County', 'Fresno County', 'City of Redondo Beach',
    'City of Torrance', 'East Bay Regional Park District', 'City of Davis', 'AC Transit',
    'City of Culver City',
  ]),
  ...withKey('THEIRSTACK_API_KEY_2', 'state_agencies', [
    'Colorado Department of Public Safety',
  ]),

  ...withKey('THEIRSTACK_API_KEY_3', 'private_companies', [
    'Amentum', 'AECOM', 'Leidos', 'Serco', 'CACI International', 'Peraton', 'V2X Inc',
    'BAE Systems', 'Weatherford', 'ASRC Federal', 'QinetiQ', 'Sierra Nevada Corporation',
    'Constellis', 'Valiant Integrated Services', 'Versar Global Solutions', 'Dynamic Aviation',
    'IDS International', 'BL Harbert International LLC',
  ]),

  ...withKey('THEIRSTACK_API_KEY_4', 'state_agencies', [
    'State of Nevada', 'State of Rhode Island', 'State of Connecticut', 'State of Montana',
    'State of Maryland', 'State of Oklahoma', 'State of New Jersey', 'State of Georgia',
    'State of Texas', 'State of Arkansas', 'State of Louisiana', 'State of New Hampshire',
    'State of Vermont', 'State of Oregon', 'State of Massachusetts', 'State of Maryland',
    'State of Minnesota', 'State of Wyoming', 'State of Wisconsin', 'State of Delaware',
    'State of Utah', 'State of Idaho', 'State of Michigan', 'State of Kansas', 'State of Alaska',
    'State of Illinois', 'State of Ohio', 'State of Washington', 'State of Nebraska',
    'State of Missouri', 'State of Florida', 'State of New Mexico', 'State of South Carolina',
    'State of Colorado', 'State of Maine',
  ]),

  ...withKey('THEIRSTACK_API_KEY_5', 'private_companies', [
    'UPS', 'Raytheon', 'Collins Aerospace', 'Kiewit', 'International Paper', 'Chevron',
    'Georgia-Pacific', 'Quanta Services', 'United Airlines', 'Granite Construction', 'CEMEX',
    'BNSF Railway', 'FedEx Logistics', 'Union Pacific Railroad', 'Union Pacific',
    'J.G. Boswell Company', 'Dole Food Company',
  ]),
  ...withKey('THEIRSTACK_API_KEY_5', 'federal_agencies', [
    'Federal Bureau of Prisons', 'U.S. Customs and Border Pro', 'Federal Aviation Administration',
    'US Department of Homeland Security',
  ]),
  ...withKey('THEIRSTACK_API_KEY_5', 'counties_and_cities', [
    'Central Florida Regional Transportation Authority (LYNX)',
  ]),
];

export function monitorsForEntity(entity: { name?: string | null; aliases?: string[] | null }) {
  const names = [entity?.name, ...(Array.isArray(entity?.aliases) ? entity.aliases : [])]
    .map(normalizeName)
    .filter(Boolean);
  if (!names.length) return [];
  return dedupeMonitors(THEIRSTACK_MONITORS.filter(monitor => names.includes(normalizeName(monitor.name))));
}

export function uniqueTheirStackMonitors() {
  return dedupeMonitors(THEIRSTACK_MONITORS);
}

function withKey(envKey: TheirStackMonitor['envKey'], portal: TheirStackPortal, names: string[]): TheirStackMonitor[] {
  return names.map(name => ({ name, envKey, portal }));
}

function dedupeMonitors(monitors: TheirStackMonitor[]) {
  const seen = new Set<string>();
  return monitors.filter(monitor => {
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
