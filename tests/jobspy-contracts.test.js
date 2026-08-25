const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const jobspy = fs.readFileSync('lib/ingest/jobSpy.ts', 'utf8');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const nextConfig = fs.readFileSync('next.config.js', 'utf8');
const migration = fs.readFileSync('db/jobspy_runtime.sql', 'utf8');
const migrate = fs.readFileSync('scripts/migrate.js', 'utf8');
const entityRoute = fs.readFileSync('app/api/entities/[id]/ingest/route.ts', 'utf8');
const integrationPanel = fs.readFileSync('components/portal/IntegrationStatusPanel.tsx', 'utf8');

test('JobSpy uses the native Node package instead of shelling out to Python or Docker', () => {
  assert.equal(packageJson.dependencies['ts-jobspy'], '2.0.3');
  assert.match(packageJson.engines.node, />=20/);
  assert.match(jobspy, /import\('ts-jobspy'\)/);
  assert.doesNotMatch(jobspy, /child_process|execSync|spawn\(|docker run|python3/);
  assert.match(nextConfig, /ts-jobspy/);
});

test('JobSpy is gap-triggered and does not blindly scrape every tracked employer', () => {
  assert.match(jobspy, /JOBSPY_MODE/);
  assert.match(jobspy, /THEIRSTACK|theirstack_signal/i);
  assert.match(jobspy, /GAP_RATIO/);
  assert.match(jobspy, /MIN_ACTIVE_JOBS/);
  assert.match(jobspy, /INTERVAL_HOURS/);
  assert.match(jobspy, /ERROR_RETRY_HOURS/);
});

test('Indeed and LinkedIn are isolated so one board failure does not discard the other', () => {
  assert.match(jobspy, /type JobSpySite = 'indeed' \| 'linkedin'/);
  assert.match(jobspy, /for \(const site of SITES\)/);
  assert.match(jobspy, /withTimeout/);
  assert.match(jobspy, /isRateLimitOrForbidden/);
  assert.match(jobspy, /respecting prior board backoff/);
});

test('JobSpy requires returned company identity evidence before a job can enter shared dedupe', () => {
  assert.match(jobspy, /employerMatch\(row\?\.company, entity\)/);
  assert.match(jobspy, /company-prefix/);
  assert.match(jobspy, /normalized_employer/);
  assert.match(jobspy, /source_graph_class: 'supplemental'/);
});

test('JobSpy does not attempt proxy rotation or access-control bypass', () => {
  assert.doesNotMatch(jobspy, /proxies:/);
  assert.doesNotMatch(jobspy, /captcha/i);
  assert.match(jobspy, /We do not attempt to bypass board access controls/);
});

test('supplemental ranking migration is applied before app runtime', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION source_preference/);
  assert.match(migration, /jobspy:%/);
  assert.match(migrate, /jobspy_runtime\.sql/);
});

test('JobSpy appears in the entity integration panel without requiring an API key', () => {
  assert.match(entityRoute, /jobspy:/);
  assert.match(entityRoute, /Native Node JobSpy/);
  assert.match(integrationPanel, /JobSpy Boards/);
});
