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
  assert.match(cron, /\/api\/ingest\/theirstack\/company-sweep/);
  assert.doesNotMatch(cron, /fetch\(`\$\{APP_URL\}\/api\/ingest\/theirstack`,/);
});

test('supplemental source health does not shadow the main ingest log', () => {
  assert.match(supplemental, /persistSourceCoverage/);
  assert.doesNotMatch(supplemental, /INSERT INTO ingest_log/);
});

test('JobSpy participates in shared dedupe with AI-assisted queries while failures stay isolated', () => {
  assert.match(supplemental, /buildDiscoveryAssist/);
  assert.match(supplemental, /discovery_queries/);
  assert.match(supplemental, /fetchJobSpyJobs\(discoveryEntity\)\.catch/);
  assert.match(supplemental, /Promise\.all/);
  assert.match(supplemental, /\.\.\.jobSpy\.jobs/);
  assert.match(supplemental, /inventory_complete:\s*false/);
});

test('TinyFish and Keenable receive the same conservative discovery expansion', () => {
  assert.match(supplemental, /fetchKeenableJobs\(discoveryEntity\)/);
  assert.match(supplemental, /fetchTinyFishJobs\(discoveryEntity\)/);
  assert.match(supplemental, /employerFiltered = filterAllJobsForEntityEvidence/);
});

test('supplemental duplicate URLs defer to higher-preference or canonical sources', () => {
  assert.match(supplemental, /retireSupplementalUrlDuplicates/);
  assert.match(supplemental, /supplemental\.source = ANY\(\$2::text\[\]\)/);
  assert.match(supplemental, /source_preference\(preferred\.source\) > source_preference\(supplemental\.source\)/);
  assert.match(supplemental, /NOT \(preferred\.source = ANY\(\$2::text\[\]\)\)/);
});
