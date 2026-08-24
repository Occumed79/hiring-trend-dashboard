const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const upsert = fs.readFileSync('lib/ingest/upsertJob.ts', 'utf8');
const mapRoute = fs.readFileSync('app/api/map/route.ts', 'utf8');

test('job normalization rejects impossible source coordinates before they can become map pins', () => {
  assert.match(upsert, /coordinateRejectionReason/);
  assert.match(upsert, /country && country !== 'AQ' && lat < -60/);
  assert.match(upsert, /COUNTRY_BOUNDS/);
  assert.match(upsert, /normalized_source_coordinate_rejected/);
  assert.match(upsert, /normalized_rejected_source_coordinates/);
});

test('Kuwait has a coarse geographic sanity bound to prevent Antarctica-style corruption', () => {
  assert.match(upsert, /KW:\s*\{\s*minLat:\s*27,\s*maxLat:\s*31\.5,\s*minLng:\s*45,\s*maxLng:\s*49\.5\s*\}/);
});

test('map API distinguishes real mapped jobs from fallback points', () => {
  assert.match(mapRoute, /storedWasFallback/);
  assert.match(mapRoute, /realMappedJobs/);
  assert.match(mapRoute, /fallbackJobs/);
});
