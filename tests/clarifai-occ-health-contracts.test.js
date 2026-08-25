const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }

test('AI pool is used for job role and location taxonomy, not occupational-health inference', () => {
  const source = read('lib/ai/jobIntelligenceAi.ts');
  assert.match(source, /buildDiscoveryAssist/);
  assert.match(source, /enrichEntityJobTaxonomy/);
  assert.match(source, /engineering.*security.*aviation.*admin.*logistics.*medical.*other/s);
  assert.match(source, /remote.*domestic.*overseas.*unknown/s);
  assert.match(source, /Never infer occupational-health/);
  assert.doesNotMatch(source, /likely_hearing_conservation|likely_respirator_use|medical_surveillance|opportunity_score/);
});

test('supplemental ingest spends AI on discovery assist and taxonomy before Algolia sync', () => {
  const source = read('lib/ingest/runSupplementalIngest.ts');
  const assistIndex = source.indexOf('buildDiscoveryAssist(entity)');
  const taxonomyIndex = source.indexOf('enrichEntityJobTaxonomy(entity.id');
  const algoliaIndex = source.indexOf('syncEntityToAlgolia(entity.id)');
  assert.ok(assistIndex >= 0);
  assert.ok(taxonomyIndex > assistIndex);
  assert.ok(algoliaIndex > taxonomyIndex);
  assert.match(source, /discovery_queries/);
  assert.doesNotMatch(source, /enrichEntityOccupationalHealth|occupational_health:/);
});

test('metrics and profile UI expose role and location categories and no OH signal panel', () => {
  const metrics = read('lib/metrics.ts');
  const route = read('app/api/entities/[id]/metrics/route.ts');
  const roleBreakdown = read('components/charts/RoleBreakdown.tsx');
  assert.match(metrics, /getEntityRoleBreakdown/);
  assert.match(metrics, /getEntityLocationBreakdown/);
  assert.match(route, /__locations/);
  assert.match(roleBreakdown, /Role Categories/);
  assert.match(roleBreakdown, /Location Categories/);
  assert.doesNotMatch(roleBreakdown, /Occupational Health Signals|OH score|hearing conservation|respirator/i);
});

test('world map matches the clean point-reference design and is intentionally large', () => {
  const map = read('components/map/WorldMap.tsx');
  const basemap = read('components/map/arcgisBasemap.ts');
  assert.match(map, /CircleMarker/);
  assert.match(map, /radius=\{3\.25\}/);
  assert.match(map, /scrollWheelZoom=\{false\}/);
  assert.match(map, /doubleClickZoom=\{false\}/);
  assert.match(map, /min-h-\[980px\]/);
  assert.match(map, /minHeight: profileMode \? '82vh'/);
  assert.doesNotMatch(map, /createHiringMarkerIcon|DivIcon/);
  assert.match(basemap, /DEFAULT_HIRING_MAP_STYLE: HiringMapStyleId = 'streets'/);
});
