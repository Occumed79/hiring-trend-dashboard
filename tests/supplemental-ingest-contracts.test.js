const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const apiIngest = fs.readFileSync('app/api/ingest/route.ts', 'utf8');
const entityIngest = fs.readFileSync('app/api/entities/[id]/ingest/route.ts', 'utf8');
const supplemental = fs.readFileSync('lib/ingest/runSupplementalIngest.ts', 'utf8');
const cron = fs.readFileSync('scripts/ingest.js', 'utf8');

test('scheduled/API and manual refreshes both invoke shared supplemental ingestion', () => {
  assert.match(apiIngest, /runSupplementalIngest/);
  assert.match(entityIngest, /runSupplementalIngest/);
  assert.match(cron, /\/api\/ingest/);
  assert.doesNotMatch(cron, /\/api\/ingest\/theirstack/);
});

test('supplemental source health does not shadow the main ingest log', () => {
  assert.match(supplemental, /persistSourceCoverage/);
  assert.doesNotMatch(supplemental, /INSERT INTO ingest_log/);
});

test('supplemental duplicate URLs defer to canonical sources and TheirStack beats Keenable', () => {
  assert.match(supplemental, /retireSupplementalUrlDuplicates/);
  assert.match(supplemental, /preferred\.source NOT IN \(\$2, \$3\)/);
  assert.match(supplemental, /supplemental\.source = \$3 AND preferred\.source = \$2/);
});
