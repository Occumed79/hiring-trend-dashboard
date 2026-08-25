const APP_URL = String(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://hiring-trend-dashboard-mt68.onrender.com').replace(/\/$/, '');
const CONCURRENCY = clamp(Number(process.env.BOOTSTRAP_CONCURRENCY || 2), 1, 4);
const ONLY_EMPTY = !['0', 'false', 'no', 'off'].includes(String(process.env.BOOTSTRAP_ONLY_EMPTY || 'true').toLowerCase());
const REQUEST_TIMEOUT_MS = clamp(Number(process.env.BOOTSTRAP_REQUEST_TIMEOUT_MS || 180000), 30000, 300000);
const READY_TIMEOUT_MS = clamp(Number(process.env.BOOTSTRAP_READY_TIMEOUT_MS || 1200000), 60000, 1800000);
const PORTALS = ['current_clients', 'prospects', 'private_companies', 'federal_agencies', 'state_agencies', 'counties_and_cities'];

async function run() {
  console.log(`TheirStack profile bootstrap target: ${APP_URL}`);
  const entities = await loadEntities();
  const trackerProfiles = entities
    .filter(entity => String(entity.category || '').includes('theirstack-monitor'))
    .filter(entity => !ONLY_EMPTY || Number(entity.open_jobs || 0) === 0)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  console.log(`Found ${entities.length} active profiles; ${trackerProfiles.length} tracker profile(s) selected for hydration${ONLY_EMPTY ? ' because they currently have zero open jobs' : ''}.`);
  if (!trackerProfiles.length) return;

  await waitForBootstrapRoute(trackerProfiles[0].id);

  const results = await mapWithConcurrency(trackerProfiles, CONCURRENCY, async (entity, index) => {
    const started = Date.now();
    process.stdout.write(`[${index + 1}/${trackerProfiles.length}] ${entity.name} ... `);
    try {
      const payload = await bootstrapEntity(entity.id);
      const core = payload?.core?.results?.[0] || payload?.core || {};
      const supplemental = payload?.supplemental?.results?.[0] || payload?.supplemental || {};
      const coreTotal = Number(core?.total || 0);
      const supplementalTotal = Number(supplemental?.total || 0);
      console.log(`OK (${Math.round((Date.now() - started) / 1000)}s; ${coreTotal} core + ${supplementalTotal} supplemental)`);
      return { id: entity.id, name: entity.name, ok: true, core: coreTotal, supplemental: supplementalTotal };
    } catch (error) {
      const message = errorMessage(error);
      console.log(`FAILED (${Math.round((Date.now() - started) / 1000)}s): ${message}`);
      return { id: entity.id, name: entity.name, ok: false, error: message };
    }
  });

  const failed = results.filter(row => !row.ok);
  const populated = results.filter(row => row.ok && (row.core + row.supplemental) > 0);
  const zero = results.filter(row => row.ok && (row.core + row.supplemental) === 0);
  console.log(`Bootstrap finished: ${results.length - failed.length}/${results.length} requests completed, ${populated.length} returned jobs, ${zero.length} returned verified/observed zero, ${failed.length} request failure(s).`);
  if (failed.length) {
    console.warn(`Failures: ${failed.map(row => `${row.name}: ${row.error}`).join(' | ')}`);
  }
}

async function loadEntities() {
  const byId = new Map();
  for (const portal of PORTALS) {
    const response = await fetch(`${APP_URL}/api/entities?portal=${encodeURIComponent(portal)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Could not enumerate ${portal}: HTTP ${response.status}`);
    const rows = await response.json().catch(() => []);
    for (const row of Array.isArray(rows) ? rows : []) byId.set(row.id, row);
  }
  return Array.from(byId.values());
}

async function waitForBootstrapRoute(entityId) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const response = await fetch(`${APP_URL}/api/entities/${encodeURIComponent(entityId)}/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reconcile: true }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.bootstrap_protocol === 'theirstack-profile-v1') {
        console.log(`Bootstrap route is live after ${attempt} readiness attempt(s).`);
        return;
      }
      if (response.status !== 404) {
        throw new Error(`bootstrap readiness returned HTTP ${response.status}: ${JSON.stringify(payload)}`);
      }
    } catch (error) {
      if (Date.now() + 15000 >= deadline) throw error;
    }
    console.log(`Bootstrap route is not on the deployed Render build yet; retrying in 15s...`);
    await sleep(15000);
  }
  throw new Error(`Timed out waiting for ${APP_URL} to deploy the tracker bootstrap route.`);
}

async function bootstrapEntity(entityId) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(`${APP_URL}/api/entities/${encodeURIComponent(entityId)}/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reconcile: true }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload)}`);
      if (payload?.bootstrap_protocol !== 'theirstack-profile-v1') throw new Error('Unexpected bootstrap response protocol.');
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(5000);
    }
  }
  throw lastError || new Error('Profile bootstrap failed.');
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runner() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runner()));
  return results;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)); }
function errorMessage(error) { return error instanceof Error ? error.message : String(error); }

run().catch(error => {
  console.error(`Tracker profile bootstrap failed: ${errorMessage(error)}`);
  process.exit(1);
});
