const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('TheirStack OpenAPI notes preserve the integration constraints we rely on', () => {
  const notes = fs.readFileSync('docs/theirstack-openapi-notes.md', 'utf8');
  assert.match(notes, /1 API credit per returned job/);
  assert.match(notes, /last 5 jobs/);
  assert.match(notes, /GET \/v1\/datasets/);
  assert.match(notes, /is_accessible/);
  assert.match(notes, /EXPORT_SNAPSHOT/);
  assert.match(notes, /company details only, not jobs/);
  assert.match(notes, /job_export_key_or/);
});
