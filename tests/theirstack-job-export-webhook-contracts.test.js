const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }

test('one-time TheirStack export receiver requires a dedicated secret', () => {
  const route = read('app/api/ingest/theirstack/export/route.ts');
  assert.match(route, /THEIRSTACK_EXPORT_WEBHOOK_SECRET/);
  assert.match(route, /x-theirstack-export-secret/);
  assert.match(route, /searchParams\.get\('token'\)/);
  assert.match(route, /Unauthorized/);
});

test('TheirStack app export imports into a dedicated non-jobapi lifecycle source', () => {
  const source = read('lib/ingest/theirStackExportWebhook.ts');
  assert.match(source, /const SOURCE = 'theirstack_export'/);
  assert.match(source, /theirStack_delivery: 'app_job_export_webhook'/i);
  assert.match(source, /source_graph_class: 'supplemental'/);
  assert.match(source, /hasExistingActiveUrl/);
  assert.match(source, /duplicate_skipped/);
});

test('export receiver is bounded and never performs destructive closure reconciliation', () => {
  const source = read('lib/ingest/theirStackExportWebhook.ts');
  assert.match(source, /MAX_ROWS = 10000/);
  assert.doesNotMatch(source, /UPDATE jobs SET is_active = false/i);
  assert.doesNotMatch(source, /reconcileTheirStackInventory/);
  assert.doesNotMatch(source, /retireMissing/);
});

test('export receipt captures only a small redacted payload sample for schema discovery', () => {
  const source = read('lib/ingest/theirStackExportWebhook.ts');
  assert.match(source, /rows\.slice\(0, 3\)\.map\(sanitizeSampleRow\)/);
  assert.match(source, /\[redacted\]/);
  assert.match(source, /theirStack_export_receipts/i);
  assert.doesNotMatch(source, /payload_raw|raw_payload|full_payload/i);
});

test('successful export updates snapshots and Algolia without invoking AI enrichment inline', () => {
  const source = read('lib/ingest/theirStackExportWebhook.ts');
  assert.match(source, /buildHiringSnapshot/);
  assert.match(source, /syncEntityToAlgolia/);
  assert.doesNotMatch(source, /enrichEntityOccupationalHealth/);
});
