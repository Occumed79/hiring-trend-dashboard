const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

test('Algolia uses separate search and write credentials without requiring admin credentials', () => {
  const source = read('lib/search/algolia.ts');
  const env = read('.env.example');
  const render = read('render.yaml');
  assert.match(source, /ALGOLIA_APP_ID/);
  assert.match(source, /ALGOLIA_SEARCH_API_KEY/);
  assert.match(source, /ALGOLIA_WRITE_API_KEY/);
  assert.doesNotMatch(source, /ALGOLIA_ADMIN_API_KEY/);
  assert.doesNotMatch(env, /^ALGOLIA_ADMIN_API_KEY=/m);
  assert.doesNotMatch(render, /key: ALGOLIA_ADMIN_API_KEY/);
});

test('Algolia indexes active jobs, deletes closed jobs, and carries occupational-health signals', () => {
  const source = read('lib/search/algolia.ts');
  assert.match(source, /action: 'updateObject'/);
  assert.match(source, /action: 'deleteObject'/);
  assert.match(source, /occupational_health_score/);
  assert.match(source, /occupational_health_signals/);
  assert.match(source, /respirator fit testing pulmonary/);
  assert.match(source, /hearing conservation audiogram/);
});

test('supplemental ingest syncs Algolia after Clarifai enrichment and keeps Algolia out of evidence source coverage', () => {
  const source = read('lib/ingest/runSupplementalIngest.ts');
  const clarifaiIndex = source.indexOf('enrichEntityOccupationalHealth(entity.id');
  const algoliaIndex = source.indexOf('syncEntityToAlgolia(entity.id)');
  assert.ok(clarifaiIndex >= 0 && algoliaIndex > clarifaiIndex);
  assert.match(source, /algolia,/);
  assert.doesNotMatch(source, /source:\s*['"]algolia/);
});

test('global search has a dedicated workspace and API route', () => {
  const page = read('app/page.tsx');
  const sidebar = read('components/Sidebar.tsx');
  const view = read('components/GlobalJobSearch.tsx');
  const route = read('app/api/search/jobs/route.ts');
  assert.match(page, /GlobalJobSearch/);
  assert.match(sidebar, /Global Search/);
  assert.match(view, /Search the intelligence layer, not just job titles/);
  assert.match(route, /searchAlgoliaJobs/);
});

test('Render gives web search+write access but cron only write access', () => {
  const render = read('render.yaml');
  const searchKeys = render.match(/key: ALGOLIA_SEARCH_API_KEY/g) || [];
  const writeKeys = render.match(/key: ALGOLIA_WRITE_API_KEY/g) || [];
  const appIds = render.match(/key: ALGOLIA_APP_ID/g) || [];
  assert.equal(searchKeys.length, 1);
  assert.equal(writeKeys.length, 2);
  assert.equal(appIds.length, 2);
});

test('stopping entity tracking purges its Algolia records', () => {
  const route = read('app/api/entities/[id]/route.ts');
  assert.match(route, /purgeEntityFromAlgolia/);
});
