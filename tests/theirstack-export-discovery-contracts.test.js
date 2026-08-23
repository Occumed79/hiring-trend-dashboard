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

test('discovery checks supported bulk dataset access and company-list export artifacts', () => {
  const source = read('lib/ingest/theirStackExportDiscovery.ts');
  assert.match(source, /https:\/\/api\.theirstack\.com\/v1\/datasets/);
  assert.match(source, /https:\/\/api\.theirstack\.com\/v0\/company_lists/);
  assert.match(source, /is_accessible/);
  assert.match(source, /accessible_jobs_dataset_workspaces/);
  assert.match(source, /EXPORT_SNAPSHOT/);
  assert.match(source, /dataset_url_present/);
  assert.match(source, /dataset_prefix_present/);
  assert.doesNotMatch(source, /dataset_url:\s*option\?\.dataset_url/);
});

test('company-search shortcut is documented conservatively and not treated as bulk jobs', () => {
  const source = read('lib/ingest/theirStackExportDiscovery.ts');
  assert.match(source, /company_search_jobs_found_per_company:\s*5/);
  assert.match(source, /company_list_export_scope:\s*'companies_only'/);
  assert.match(source, /job_search_credit_rule:\s*'1 API credit per returned job'/);
  assert.match(source, /bulk_jobs_path:\s*'\/v1\/datasets when jobs dataset is_accessible=true'/);
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

test('optional bulk probes cannot make the whole workspace discovery fail', () => {
  const source = read('lib/ingest/theirStackExportDiscovery.ts');
  assert.match(source, /fetchOptionalJson/);
  assert.match(source, /dataset_probe_error/);
  assert.match(source, /company_list_probe_error/);
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
