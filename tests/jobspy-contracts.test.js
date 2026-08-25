const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const jobspy = fs.readFileSync('lib/ingest/jobSpy.ts', 'utf8');
const indeedOnly = fs.readFileSync('lib/ingest/jobSpyIndeed.ts', 'utf8');
const supplemental = fs.readFileSync('lib/ingest/runSupplementalIngest.ts', 'utf8');
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

test('active Hiring Insights flow forces JobSpy to Indeed only and removes LinkedIn results', () => {
  assert.match(indeedOnly, /process\.env\.JOBSPY_SITES = 'indeed'/);
  assert.match(indeedOnly, /source.*jobspy:indeed/);
  assert.match(indeedOnly, /site.*indeed/);
  assert.match(supplemental, /from '\.\/jobSpyIndeed'/);
  assert.match(supplemental, /JOBSPY_SOURCES = \['jobspy:indeed'\]/);
  assert.match(supplemental, /DELETE FROM entity_source_coverage WHERE entity_id = \$1 AND source = 'jobspy:linkedin'/);
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

test('JobSpy location parsing treats US state abbreviations as states before country parsing', () => {
  const stateCheck = jobspy.indexOf("US_STATE_CODES.has(last.toUpperCase())");
  const countryCheck = jobspy.indexOf('const country = normalizeCountry(last)');
  assert.ok(stateCheck >= 0 && countryCheck > stateCheck);
  assert.match(jobspy, /country: 'US'/);
  assert.match(jobspy, /return map\[text\] \|\| null/);
  assert.doesNotMatch(jobspy, /return \/\^\[a-z\]\{2\}\$\/i\.test\(text\)/);
});

test('supplemental ranking migration is applied before app runtime', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION source_preference/);
  assert.match(migration, /jobspy:%/);
  assert.match(migrate, /jobspy_runtime\.sql/);
});

test('JobSpy appears as Indeed-only in the entity integration panel without requiring an API key', () => {
  assert.match(entityRoute, /Native Node JobSpy/);
  assert.match(entityRoute, /Indeed only/);
  assert.match(entityRoute, /LinkedIn removed/);
  assert.match(integrationPanel, /JobSpy Indeed/);
});
