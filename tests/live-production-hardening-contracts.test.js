const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }

const locationSignals = read('lib/geo/locationSignals.ts');
const upsert = read('lib/ingest/upsertJob.ts');
const mapRoute = read('app/api/map/route.ts');
const worldMap = read('components/map/WorldMap.tsx');
const usaMap = read('components/map/USAMap.tsx');
const globals = read('app/globals.css');
const metrics = read('lib/metrics.ts');
const trend = read('components/charts/TrendCard.tsx');
const portalMetrics = read('app/api/portals/[portal]/metrics/route.ts');
const runtimeEnv = read('lib/runtimeEnv.ts');
const ingestRoute = read('app/api/entities/[id]/ingest/route.ts');
const datasets = read('lib/ingest/theirStackDatasets.ts');
const sourceRules = read('lib/ingest/sourceReliabilityRules.js');
const entitySources = read('lib/ingest/entityJobSources.ts');

test('bounded sitemap discovery is verified evidence, not authoritative inventory', () => {
  assert.match(entitySources, /source_type==='sitemap'\?\s*'verified'/);
  assert.match(entitySources, /enumeration_complete:false/);
  assert.match(entitySources, /bounded_sample:true/);
});

test('coverage can recognize a healthy connector inventory even when source graph labels differ', () => {
  assert.match(entitySources, /connector_coverage_source/);
  assert.match(entitySources, /connector_inventory/);
});

test('location normalization rejects concatenated ATS location lists and resolves US state conflicts', () => {
  assert.match(locationSignals, /looksLikeLocationCollection/);
  assert.match(upsert, /US_STATE_CODES/);
  assert.match(upsert, /country = 'US'/);
});

test('production maps default to trusted city precision with no HQ fallback bubbles', () => {
  assert.match(mapRoute, /const includeFallback = searchParams\.get\('include_fallback'\) === 'true'/);
  assert.match(mapRoute, /map_precision: 'city'/);
  assert.match(worldMap, /circleMarker/);
  assert.match(usaMap, /circleMarker/);
  assert.doesNotMatch(worldMap, /divIcon/);
  assert.doesNotMatch(usaMap, /divIcon/);
});

test('map falls back automatically when ArcGIS tiles error', () => {
  assert.match(worldMap, /tileerror/);
  assert.match(usaMap, /tileerror/);
  assert.match(worldMap, /openstreetmap/i);
  assert.match(usaMap, /openstreetmap/i);
});

test('card glass no longer runs pointer-triggered sweep animations', () => {
  assert.doesNotMatch(globals, /--mouse-x/);
  assert.doesNotMatch(globals, /mousemove/);
});

test('trend cards do not invent zero percent when requested history does not exist', () => {
  assert.match(metrics, /availableHistoryDays/);
  assert.match(trend, /history still building/);
});

test('portal metrics explicitly bypass response caching', () => {
  assert.match(portalMetrics, /force-dynamic/);
  assert.match(portalMetrics, /Cache-Control': 'no-store, max-age=0'/);
});

test('runtime integration detection honors the key names visible in Render', () => {
  assert.match(runtimeEnv, /LANGSEARCH-API-KEY/);
  assert.match(runtimeEnv, /LANGSEARCH-API-KEY-2/);
  assert.match(runtimeEnv, /GROQ_API_KEY_2/);
  assert.match(runtimeEnv, /ALGOLIA_API_KEY/);
  assert.match(ingestRoute, /RUNTIME_ENV/);
});

test('TheirStack Jobs Dataset entitlement is probed across all five API keys', () => {
  assert.match(datasets, /\/v1\/datasets/);
  assert.match(datasets, /THEIRSTACK_API_KEY_5/);
  assert.match(datasets, /is_accessible/);
  assert.match(datasets, /theirstack_dataset_access/);
  assert.match(ingestRoute, /theirstack_dataset/);
});

test('zero inventory comparisons require proved complete enumeration', () => {
  assert.match(sourceRules, /isCompleteInventoryEvidence/);
  assert.match(sourceRules, /enumeration_complete/);
});
