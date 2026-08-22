require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const { Client } = require('pg');

const MONITORS = [
  ['THEIRSTACK_API_KEY','private_companies',['Northrop Grumman','Boeing','Safran','Parsons Corporation','Leonardo','General Atomics','United Launch Alliance (ULA)','Peckham, Inc.']],
  ['THEIRSTACK_API_KEY','state_agencies',['Texas Department of Transportation','Georgia Department of Transportation','Oregon Department of Transportation','Florida Department of Transportation']],
  ['THEIRSTACK_API_KEY_2','private_companies',['Peraton','American Bureau of Shipping']],
  ['THEIRSTACK_API_KEY_2','counties_and_cities',['Placer County','City of Sacramento','Sacramento County','COUNTY OF MENDOCINO','City of Riverside','Solano County','Fresno County','City of Redondo Beach','City of Torrance','East Bay Regional Park District','City of Davis','AC Transit','City of Culver City']],
  ['THEIRSTACK_API_KEY_2','state_agencies',['Colorado Department of Public Safety']],
  ['THEIRSTACK_API_KEY_3','private_companies',['Amentum','AECOM','Leidos','Serco','CACI International','Peraton','V2X Inc','BAE Systems','Weatherford','ASRC Federal','QinetiQ','Sierra Nevada Corporation','Constellis','Valiant Integrated Services','Versar Global Solutions','Dynamic Aviation','IDS International','BL Harbert International LLC']],
  ['THEIRSTACK_API_KEY_4','state_agencies',['State of Nevada','State of Rhode Island','State of Connecticut','State of Montana','State of Maryland','State of Oklahoma','State of New Jersey','State of Georgia','State of Texas','State of Arkansas','State of Louisiana','State of New Hampshire','State of Vermont','State of Oregon','State of Massachusetts','State of Maryland','State of Minnesota','State of Wyoming','State of Wisconsin','State of Delaware','State of Utah','State of Idaho','State of Michigan','State of Kansas','State of Alaska','State of Illinois','State of Ohio','State of Washington','State of Nebraska','State of Missouri','State of Florida','State of New Mexico','State of South Carolina','State of Colorado','State of Maine']],
  ['THEIRSTACK_API_KEY_5','private_companies',['UPS','Raytheon','Collins Aerospace','Kiewit','International Paper','Chevron','Georgia-Pacific','Quanta Services','United Airlines','Granite Construction','CEMEX','BNSF Railway','FedEx Logistics','Union Pacific Railroad','Union Pacific','J.G. Boswell Company','Dole Food Company']],
  ['THEIRSTACK_API_KEY_5','federal_agencies',['Federal Bureau of Prisons','U.S. Customs and Border Pro','Federal Aviation Administration','US Department of Homeland Security']],
  ['THEIRSTACK_API_KEY_5','counties_and_cities',['Central Florida Regional Transportation Authority (LYNX)']],
];

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required to sync TheirStack monitored employers.');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: sslConfig(process.env.DATABASE_URL) });
  await client.connect();

  try {
    const rows = flattenMonitors();
    let inserted = 0;
    let existing = 0;

    for (const monitor of rows) {
      const found = await client.query(
        `SELECT id FROM entities WHERE is_active = true AND LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1`,
        [monitor.name],
      );
      if (found.rowCount) {
        existing++;
        continue;
      }

      await client.query(
        `INSERT INTO entities (name, aliases, portal, ats_provider, category, is_active)
         VALUES ($1, $2::text[], $3::portal_type, 'unknown'::ats_provider, $4, true)`,
        [monitor.name, [], monitor.portal, `theirstack-monitor:${monitor.envKey}`],
      );
      inserted++;
      console.log(`Added TheirStack monitor: ${monitor.name} -> ${monitor.portal} (${monitor.envKey})`);
    }

    console.log(`TheirStack monitor sync complete: ${inserted} inserted, ${existing} already present, ${rows.length} unique monitored employers.`);
  } finally {
    await client.end();
  }
}

function flattenMonitors() {
  const seen = new Set();
  const rows = [];
  for (const [envKey, portal, names] of MONITORS) {
    for (const name of names) {
      const canonical = normalizeName(name);
      // The same employer may deliberately appear under multiple API keys (Peraton).
      // It should still exist only once in the dashboard entity registry.
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      rows.push({ name, portal, envKey });
    }
  }
  return rows;
}

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function sslConfig(connectionString) {
  try {
    const url = new URL(connectionString);
    const sslMode = (url.searchParams.get('sslmode') || '').toLowerCase();
    if (sslMode === 'disable') return undefined;
  } catch {}
  return { rejectUnauthorized: false };
}

run().catch(error => {
  console.error('TheirStack monitor sync failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
