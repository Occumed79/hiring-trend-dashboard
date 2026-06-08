/**
 * One-time migration: rename portal enum value
 * city_municipal_agencies -> counties_and_cities
 *
 * Run once after deploying this update:
 *   node scripts/migrate-portal-rename.js
 */
require('dotenv').config({ path: '.env.local' });
const { neon } = require('@neondatabase/serverless');

async function run() {
  const sql = neon(process.env.DATABASE_URL);
  console.log('Renaming portal enum value...');
  try {
    // Postgres doesn't support renaming enum values directly before 10,
    // but ALTER TYPE ... RENAME VALUE is supported in Postgres 10+
    await sql`ALTER TYPE portal_type RENAME VALUE 'city_municipal_agencies' TO 'counties_and_cities'`;
    console.log('✅ Renamed city_municipal_agencies -> counties_and_cities');
  } catch (err) {
    if (String(err).includes('does not exist')) {
      console.log('ℹ️  Old value not found — already migrated or fresh install, nothing to do.');
    } else {
      console.error('❌ Error:', err);
      process.exit(1);
    }
  }
}

run();
