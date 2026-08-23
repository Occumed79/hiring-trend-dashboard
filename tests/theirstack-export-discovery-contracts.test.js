const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

test('TheirStack export discovery reads supported request history and credit balance endpoints', () => {
  const source = read('lib/ingest/theirStackExportDiscovery.ts');
  assert.match(source, /https:\/\/api\.theirstack\.com\/v0\/requests\//);
  assert.match(source, /https:\/\/api\.theirstack\.com\/v0\/billing\/credit-balance/);
  assert.match(source, /origin.*app/);
  assert.match(source, /api_credits/);
  assert.match(source, /ui_credits/);
  assert.match(source, /num_returned_jobs/);
});

test('discovery scans all five configured TheirStack key slots without exposing credentials', () => {
  const source = read('lib/ingest/theirStackExportDiscovery.ts');
  for (const key of [
    'THEIRSTACK_API_KEY',
    'THEIRSTACK_API_KEY_2',
    'THEIRSTACK_API_KEY_3',
    'THEIRSTACK_API_KEY_4',
    'THEIRSTACK_API_KEY_5',
  ]) assert.match(source, new RegExp(key));
  assert.match(source, /sanitizeBody/);
  assert.match(source, /redactUrl/);
  assert.doesNotMatch(source, /apiKey:\s*apiKey/);
});

test('discovery recognizes app exports and materialized job export batches but never replays them', () => {
  const source = read('lib/ingest/theirStackExportDiscovery.ts');
  assert.match(source, /isExportLikeRequest/);
  assert.match(source, /job_export_key_or/);
  assert.match(source, /mode: 'read_only_discovery'/);
  assert.doesNotMatch(source, /method:\s*'POST'.*export/i);
});

test('export discovery endpoint is protected by the existing cron secret', () => {
  const route = read('app/api/ingest/theirstack/export-discovery/route.ts');
  assert.match(route, /x-cron-secret/);
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /discoverTheirStackAppExports/);
});

test('probe command can invoke the protected discovery endpoint from the deployed cron environment', () => {
  const script = read('scripts/probe-theirstack-exports.js');
  const pkg = JSON.parse(read('package.json'));
  assert.match(script, /NEXT_PUBLIC_APP_URL/);
  assert.match(script, /x-cron-secret/);
  assert.match(script, /export-discovery/);
  assert.equal(pkg.scripts['probe:theirstack-exports'], 'node scripts/probe-theirstack-exports.js');
});

test('daily ingest runs export discovery automatically but discovery failure cannot block hiring ingestion', () => {
  const ingest = read('scripts/ingest.js');
  const syncIndex = ingest.indexOf('syncTheirStackMonitors();');
  const probeIndex = ingest.indexOf('probeTheirStackExports();');
  const loadIndex = ingest.indexOf('const entities = await loadEntities();');
  assert.ok(syncIndex >= 0 && probeIndex > syncIndex && loadIndex > probeIndex);
  assert.match(ingest, /scripts\/probe-theirstack-exports\.js/);
  assert.match(ingest, /Discovery is diagnostic only; never block actual hiring ingestion/);
});
