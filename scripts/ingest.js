/**
 * Daily ingestion cron runner
 * Run via: node scripts/ingest.js
 * Or trigger via the /api/ingest endpoint with the cron secret
 */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const CRON_SECRET = process.env.CRON_SECRET;
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const TIMEOUT_MS = Number(process.env.INGEST_CRON_TIMEOUT_MS || 120000);

async function run() {
  console.log(`[${new Date().toISOString()}] Starting full ingest...`);

  if (!CRON_SECRET) {
    console.error('CRON_SECRET is not set. Refusing to call /api/ingest without authentication.');
    process.exit(1);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${APP_URL}/api/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': CRON_SECRET,
      },
      body: JSON.stringify({}),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`Ingest endpoint returned HTTP ${res.status}: ${JSON.stringify(data)}`);
    }

    console.log('Ingest complete:', data);
  } catch (err) {
    const message = err && err.name === 'AbortError'
      ? `Ingest timed out after ${TIMEOUT_MS}ms`
      : err;
    console.error('Ingest error:', message);
    process.exit(1);
  } finally {
    clearTimeout(timeout);
  }
}

run();
