require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const { Client } = require('pg');
const MONITORS = require('../config/theirstack-monitors.json');

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required to sync TheirStack monitored employers.');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: sslConfig(process.env.DATABASE_URL) });
  await client.connect();

  try {
    const rows = uniqueEntities(MONITORS);
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

function uniqueEntities(monitors) {
  const seen = new Set();
  const rows = [];
  for (const monitor of Array.isArray(monitors) ? monitors : []) {
    if (!monitor?.name || !monitor?.envKey || !monitor?.portal) continue;
    const canonical = normalizeName(monitor.name);
    // Peraton deliberately has two API-key assignments but the dashboard still
    // needs only one entity record. The TypeScript connector retains both key
    // assignments when it queries that entity.
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    rows.push(monitor);
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
