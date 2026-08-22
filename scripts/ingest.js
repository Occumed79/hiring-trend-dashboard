/**
 * Daily ingestion cron runner.
 * Synchronizes the fixed TheirStack monitor registry first, then refreshes active
 * entities one at a time so a single slow or broken provider cannot abort the run.
 */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const { spawnSync } = require('child_process');

const CRON_SECRET = process.env.CRON_SECRET;
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const ENTITY_TIMEOUT_MS = Number(process.env.INGEST_ENTITY_TIMEOUT_MS || 90000);
const SUPPLEMENTAL_TIMEOUT_MS = Number(process.env.INGEST_SUPPLEMENTAL_TIMEOUT_MS || 120000);
const PORTALS = ['current_clients', 'prospects', 'private_companies', 'federal_agencies', 'state_agencies', 'counties_and_cities'];

async function run() {
  console.log(`[${new Date().toISOString()}] Starting resilient entity-by-entity ingest...`);
  if (!CRON_SECRET) {
    console.error('CRON_SECRET is not set. Refusing to call protected ingest endpoints without authentication.');
    process.exit(1);
  }

  syncTheirStackMonitors();

  const entities = await loadEntities();
  console.log(`Found ${entities.length} active entities.`);
  const results = [];

  for (let index = 0; index < entities.length; index++) {
    const entity = entities[index];
    const started = Date.now();
    process.stdout.write(`[${index + 1}/${entities.length}] ${entity.name} ... `);
    try {
      const result = await ingestEntity(entity.id);
      const row = result?.results?.[0] || result;
      const supplemental = await ingestSupplementalEntity(entity.id);
      results.push({ id: entity.id, name: entity.name, ok: true, result: row, supplemental });
      console.log(
        `OK (${Math.round((Date.now() - started) / 1000)}s, ${row?.total || 0} core active, ` +
        `${row?.new || 0} core new, ${supplemental?.total || 0} supplemental, ${supplemental?.new || 0} supplemental new)`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ id: entity.id, name: entity.name, ok: false, error: message });
      console.log(`FAILED (${Math.round((Date.now() - started) / 1000)}s): ${message}`);
    }
  }

  const failed = results.filter(row => !row.ok);
  console.log(`[${new Date().toISOString()}] Ingest complete: ${results.length - failed.length} succeeded, ${failed.length} failed.`);
  if (failed.length) {
    console.error('Failed entities:', failed.map(row => `${row.name}: ${row.error}`).join(' | '));
    process.exitCode = 1;
  }
}

function syncTheirStackMonitors() {
  const hasAnyKey = ['THEIRSTACK_API_KEY','THEIRSTACK_API_KEY_2','THEIRSTACK_API_KEY_3','THEIRSTACK_API_KEY_4','THEIRSTACK_API_KEY_5']
    .some(name => String(process.env[name] || '').trim());
  if (!hasAnyKey) {
    console.log('TheirStack keys are not configured; monitor registry sync skipped.');
    return;
  }

  console.log('Synchronizing TheirStack monitored employers into the entity registry...');
  const result = spawnSync(process.execPath, ['scripts/sync-theirstack-monitors.js'], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`TheirStack monitor sync exited with status ${result.status}`);
  }
}

async function loadEntities() {
  const map = new Map();
  for (const portal of PORTALS) {
    const response = await fetch(`${APP_URL}/api/entities?portal=${encodeURIComponent(portal)}`, { signal: AbortSignal.timeout(30000) });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Could not enumerate ${portal}: HTTP ${response.status}`);
    for (const entity of Array.isArray(payload) ? payload : []) map.set(entity.id, entity);
  }
  return Array.from(map.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function ingestEntity(entityId) {
  return callIngestEndpoint('/api/ingest', entityId, ENTITY_TIMEOUT_MS, { reconcile: true });
}

async function ingestSupplementalEntity(entityId) {
  return callIngestEndpoint('/api/ingest/theirstack', entityId, SUPPLEMENTAL_TIMEOUT_MS, {});
}

async function callIngestEndpoint(path, entityId, timeoutMs, extraBody) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${APP_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON_SECRET },
      body: JSON.stringify({ entity_id: entityId, ...extraBody }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${JSON.stringify(payload)}`);
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`${path} timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

run().catch(error => {
  console.error('Fatal cron error:', error);
  process.exit(1);
});
