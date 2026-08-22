const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('lib/ingest/keenable.ts', 'utf8');

test('Keenable uses authenticated search endpoint and normalized discovery source', () => {
  assert.match(source, /https:\/\/api\.keenable\.ai\/v1\/search/);
  assert.match(source, /'X-API-Key': apiKey/);
  assert.match(source, /web:keenable/);
  assert.match(source, /normalized_apply_url/);
});
