/**
 * Daily ingestion cron runner
 * Run via: node scripts/ingest.js
 * Or trigger via the /api/ingest endpoint with the cron secret
 */
require('dotenv').config({ path: '.env.local' });

const CRON_SECRET = process.env.CRON_SECRET;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

async function run() {
  console.log(`[${new Date().toISOString()}] Starting full ingest...`);
  try {
    const res = await fetch(`${APP_URL}/api/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': CRON_SECRET,
      },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    console.log('Ingest complete:', data);
  } catch (err) {
    console.error('Ingest error:', err);
    process.exit(1);
  }
}

run();
