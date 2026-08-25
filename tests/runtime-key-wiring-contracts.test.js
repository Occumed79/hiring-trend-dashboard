const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const env = fs.readFileSync('lib/runtimeEnv.ts', 'utf8');
const adzuna = fs.readFileSync('lib/ingest/adzuna.ts', 'utf8');
const tinyfish = fs.readFileSync('lib/ingest/tinyFishSearch.ts', 'utf8');
const langsearch = fs.readFileSync('lib/ingest/langSearch.ts', 'utf8');
const ai = fs.readFileSync('lib/ai/jobIntelligenceAi.ts', 'utf8');
const route = fs.readFileSync('app/api/entities/[id]/ingest/route.ts', 'utf8');
const panel = fs.readFileSync('components/portal/IntegrationStatusPanel.tsx', 'utf8');
const supplemental = fs.readFileSync('lib/ingest/runSupplementalIngest.ts', 'utf8');

test('runtime environment aliases cover active Render-style key spellings', () => {
  for (const name of [
    'ADZUNA_APP_ID_2','ADZUNA_APP_KEY_2','ADZUNA_APP_ID_3','ADZUNA_APP_KEY_3',
    'ALGOLIA_API_KEY','ALGOLIA_APP_ID','ALGOLIA_APPLICATION_ID','CEREBRAS_API_KEY','FIREWORKS_AI_API_KEY','GEOAPIFY_API_KEY',
    'GROQ_API_KEY','GROQ_API_KEY_2','LANGSEARCH-API-KEY','LANGSEARCH-API-KEY-2',
    'MAPTILER_API_KEY','OPEN_ROUTER_API_KEY','TINYFISH_API_KEY','SAM_API_KEY','NLX_API_KEY',
  ]) assert.match(env, new RegExp(name.replace(/[-]/g, '\\-')));
  assert.match(env, /normalizeEnvName/);
});

test('all three Adzuna credential pairs are operational fallback slots', () => {
  assert.match(adzuna, /ADZUNA_APP_ID_2/);
  assert.match(adzuna, /ADZUNA_APP_KEY_2/);
  assert.match(adzuna, /ADZUNA_APP_ID_3/);
  assert.match(adzuna, /ADZUNA_APP_KEY_3/);
  assert.match(adzuna, /for \(const credential of credentials\)/);
  assert.match(adzuna, /successful[\s\S]*zero-result response[\s\S]*stops the chain/i);
});

test('TinyFish Search is strict official or ATS job-detail discovery', () => {
  assert.match(tinyfish, /https:\/\/api\.search\.tinyfish\.ai/);
  assert.match(tinyfish, /'X-API-Key'/);
  assert.match(tinyfish, /TINYFISH_API_KEY/);
  assert.match(tinyfish, /official-or-ats-detail-v2/);
  assert.match(tinyfish, /trustedEmployerOrAtsHost/);
  assert.match(tinyfish, /isGenericTinyFishTitle/);
  assert.match(supplemental, /fetchTinyFishJobs/);
});

test('LangSearch runtime status and connector consume the same alias registry', () => {
  assert.match(langsearch, /firstRuntimeEnv\(RUNTIME_ENV\.langSearch\)/);
  assert.match(langsearch, /firstRuntimeEnv\(RUNTIME_ENV\.langSearch2\)/);
  assert.match(env, /LANGSEARCH_API_KEY_1/);
  assert.match(env, /LANGSEARCH_KEY_2/);
});

test('AI job intelligence uses Groq Cerebras Fireworks and OpenRouter without Clarifai dependency', () => {
  for (const name of ['GROQ_API_KEY','GROQ_API_KEY_2','CEREBRAS_API_KEY','FIREWORKS_AI_API_KEY','OPEN_ROUTER_API_KEY']) {
    assert.match(ai, new RegExp(name));
  }
  assert.doesNotMatch(ai, /CLARIFAI_PAT|api\.clarifai\.com/);
  assert.match(ai, /buildDiscoveryAssist/);
  assert.match(ai, /enrichEntityJobTaxonomy/);
});

test('integration panel separates actual job connectors from map and identity wiring', () => {
  for (const id of ['maptiler','adzuna','tinyfish','geoapify','job_intelligence_ai','langsearch','nlx','careeronestop','sam_identity','usaspending_identity']) assert.match(panel, new RegExp(id));
  assert.doesNotMatch(panel, /Clarifai/);
  assert.match(panel, /National Labor Exchange/);
  assert.match(route, /USAspending recipient identity is a no-key identity service/);
  assert.match(route, /SAM\.gov identity enrichment is not wired/);
  assert.match(route, /direct National Labor Exchange connector can run/);
});

test('Algolia status requires the application ID and explains when only a key is visible', () => {
  assert.match(route, /ALGOLIA_API_KEY/);
  assert.match(route, /algoliaAppId/);
  assert.match(route, /application ID cannot be derived from an API key/);
});
