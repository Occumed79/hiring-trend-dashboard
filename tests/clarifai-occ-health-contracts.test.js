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

test('metrics and profile UI expose role categories plus country breakdown and no OH signal panel', () => {
  const metrics = read('lib/metrics.ts');
  const route = read('app/api/entities/[id]/metrics/route.ts');
  const roleBreakdown = read('components/charts/RoleBreakdown.tsx');
  assert.match(metrics, /getEntityRoleBreakdown/);
  assert.match(metrics, /getEntityCountryBreakdown/);
  assert.match(route, /__countries/);
  assert.match(roleBreakdown, /Role Categories/);
  assert.match(roleBreakdown, /Country Breakdown/);
  assert.doesNotMatch(roleBreakdown, /Overseas \/ international|Occupational Health Signals|OH score|hearing conservation|respirator/i);
});

test('world map follows the MapTiler Dataviz point-cloud reference and keeps normal zoom controls', () => {
  const map = read('components/map/WorldMap.tsx');
  const basemap = read('components/map/maptilerBasemap.ts');
  const route = read('app/api/map/route.ts');
  assert.match(map, /CircleMarker/);
  assert.match(map, /radius=\{2\.7\}/);
  assert.match(map, /scrollWheelZoom=\{true\}/);
  assert.match(map, /doubleClickZoom=\{true\}/);
  assert.match(map, /MapTiler/);
  assert.match(basemap, /DEFAULT_HIRING_MAP_STYLE: HiringMapStyleId = 'dataviz-dark'/);
  assert.match(basemap, /api\.maptiler\.com\/maps/);
  assert.match(route, /visualOffset/);
  assert.doesNotMatch(route, /const buckets = new Map/);
});

test('source coverage and integrations live in a sidebar workspace instead of the company profile', () => {
  const detail = read('components/portal/UniversalCompanyDetail.tsx');
  const sidebar = read('components/Sidebar.tsx');
  const page = read('app/page.tsx');
  assert.doesNotMatch(detail, /SourceCoveragePanel|IntegrationStatusPanel/);
  assert.match(sidebar, /Sources & Integrations/);
  assert.match(page, /SourcesIntegrationsView/);
});
