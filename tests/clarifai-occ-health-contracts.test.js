const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

test('Clarifai is an enrichment layer with cached job hashes and bounded runs', () => {
  const source = read('lib/ai/clarifaiOccupationalHealth.ts');
  assert.match(source, /CLARIFAI_PAT/);
  assert.match(source, /https:\/\/api\.clarifai\.com\/v2\/ext\/openai\/v1/);
  assert.match(source, /clarifai_oh_hash/);
  assert.match(source, /CLARIFAI_MAX_JOBS_PER_RUN/);
  assert.match(source, /likely_hearing_conservation/);
  assert.match(source, /likely_respirator_use/);
  assert.match(source, /likely_medical_surveillance/);
  assert.match(source, /opportunity_score/);
});

test('supplemental ingest enriches after source reconciliation and keeps Clarifai out of source coverage', () => {
  const source = read('lib/ingest/runSupplementalIngest.ts');
  const reconcileIndex = source.indexOf('retireSupplementalUrlDuplicates');
  const enrichIndex = source.indexOf('enrichEntityOccupationalHealth(entity.id');
  assert.ok(reconcileIndex >= 0 && enrichIndex > reconcileIndex);
  assert.match(source, /occupational_health: occupationalHealth/);
  assert.doesNotMatch(source, /source:\s*['"]clarifai/);
});

test('metrics and UI expose a separate occupational-health layer without replacing role classification', () => {
  const metrics = read('lib/metrics.ts');
  const route = read('app/api/entities/[id]/metrics/route.ts');
  const roleBreakdown = read('components/charts/RoleBreakdown.tsx');
  assert.match(metrics, /getEntityRoleBreakdown/);
  assert.match(metrics, /getEntityOccupationalHealthSignals/);
  assert.match(route, /__occupationalHealth/);
  assert.match(roleBreakdown, /Role Breakdown/);
  assert.match(roleBreakdown, /Occupational Health Signals/);
  assert.match(roleBreakdown, /separate from role classification/);
});

test('Render declares the PAT for both web and daily cron services', () => {
  const render = read('render.yaml');
  const matches = render.match(/key: CLARIFAI_PAT/g) || [];
  assert.equal(matches.length, 2);
});
