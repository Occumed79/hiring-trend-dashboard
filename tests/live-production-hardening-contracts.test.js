const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const reliabilityRules = fs.readFileSync('lib/ingest/sourceReliabilityRules.js', 'utf8');
const sourceDiscovery = fs.readFileSync('lib/ingest/sourceDiscovery.ts', 'utf8');
const coverage = fs.readFileSync('lib/ingest/coverageAssessment.ts', 'utf8');
const locationSignals = fs.readFileSync('lib/geo/locationSignals.ts', 'utf8');
const upsert = fs.readFileSync('lib/ingest/upsertJob.ts', 'utf8');
const mapRoute = fs.readFileSync('app/api/map/route.ts', 'utf8');
const marker = fs.readFileSync('components/map/hiringMarker.ts', 'utf8');
const worldMap = fs.readFileSync('components/map/WorldMap.tsx', 'utf8');
const luminous = fs.readFileSync('app/luminous.css', 'utf8');
const metrics = fs.readFileSync('lib/metrics.ts', 'utf8');
const trend = fs.readFileSync('components/charts/TrendCard.tsx', 'utf8');
const portalMetrics = fs.readFileSync('app/api/portal-metrics/route.ts', 'utf8');
const runtimeEnv = fs.readFileSync('lib/runtimeEnv.ts', 'utf8');
const ingestRoute = fs.readFileSync('app/api/entities/[id]/ingest/route.ts', 'utf8');
const datasets = fs.readFileSync('lib/ingest/theirStackDatasets.ts', 'utf8');

test('bounded sitemap discovery is verified evidence, not authoritative inventory', () => {
  assert.match(sourceDiscovery, /source_type:'sitemap'[\s\S]*source_class:'verified'/);
  assert.match(sourceDiscovery, /enumeration_complete:false/);
  assert.match(reliabilityRules, /isComparableHealthy/);
  assert.match(reliabilityRules, /authoritative_zero === true/);
});

test('coverage can recognize a healthy connector inventory even when source graph labels differ', () => {
  assert.match(coverage, /primary_observed_inventory_fallback/);
  assert.match(coverage, /observedAuthoritative/);
  assert.match(coverage, /Number\(check\?\.jobs_found \|\| 0\) > 0/);
});

test('location normalization rejects concatenated ATS location lists and resolves US state conflicts', () => {
  assert.match(locationSignals, /isLocationBlob/);
  assert.match(locationSignals, /commas >= 5/);
  assert.match(upsert, /US_STATE_CODES/);
  assert.match(upsert, /if \(state && US_STATE_CODES\.has\(state\)\) return 'US'/);
  assert.match(upsert, /normalized_country_reconciled/);
});

test('production maps default to trusted city precision with no HQ fallback bubbles', () => {
  assert.match(mapRoute, /include_fallback'\) === 'true'/);
  assert.match(mapRoute, /map_precision: 'city'/);
  assert.match(mapRoute, /if \(!city \|\| \/\^remote\$\/i\.test\(city\)\)/);
  assert.match(marker, /hiring-map-city-dot/);
  assert.doesNotMatch(marker, /hiring-map-pin/);
});

test('map falls back automatically when ArcGIS tiles error', () => {
  assert.match(worldMap, /tileerror/);
  assert.match(worldMap, /getFallbackHiringBasemap/);
  assert.match(worldMap, /invalidateSize/);
});

test('card glass no longer runs pointer-triggered sweep animations', () => {
  assert.doesNotMatch(luminous, /animation:\s*glassSweep/);
  assert.doesNotMatch(luminous, /animation:\s*auroraRotate/);
});

test('trend cards do not invent zero percent when requested history does not exist', () => {
  assert.match(metrics, /computeTrend/);
  assert.match(metrics, /value: null as number \| null/);
  assert.match(trend, /Building history/);
  assert.match(trend, /metrics\.trend30Label/);
});

test('portal metrics explicitly bypass response caching', () => {
  assert.match(portalMetrics, /dynamic = 'force-dynamic'/);
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
  assert.match(datasets, /theirStack_dataset_access/);
  assert.match(ingestRoute, /theirStack_dataset/);
});
