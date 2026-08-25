const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const env = fs.readFileSync('lib/runtimeEnv.ts', 'utf8');
const adzuna = fs.readFileSync('lib/ingest/adzuna.ts', 'utf8');
const tinyfish = fs.readFileSync('lib/ingest/tinyFishSearch.ts', 'utf8');
const ai = fs.readFileSync('lib/ai/jobIntelligenceAi.ts', 'utf8');
const route = fs.readFileSync('app/api/entities/[id]/ingest/route.ts', 'utf8');
const panel = fs.readFileSync('components/portal/IntegrationStatusPanel.tsx', 'utf8');
const supplemental = fs.readFileSync('lib/ingest/runSupplementalIngest.ts', 'utf8');

test('runtime environment aliases cover the exact Render key names in use', () => {
  for (const name of [
    'ADZUNA_APP_ID_2','ADZUNA_APP_KEY_2','ADZUNA_APP_ID_3','ADZUNA_APP_KEY_3',
    'ALGOLIA_API_KEY','CEREBRAS_API_KEY','FIREWORKS_AI_API_KEY','GEOAPIFY_API_KEY',
    'GROQ_API_KEY','GROQ_API_KEY_2','LANGSEARCH-API-KEY','LANGSEARCH-API-KEY-2',
    'OPEN_ROUTER_API_KEY','TINYFISH_API_KEY',
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

test('TinyFish Search is a real supplemental ingest source and accepts discovery expansion', () => {
  assert.match(tinyfish, /https:\/\/api\.search\.tinyfish\.ai/);
  assert.match(tinyfish, /'X-API-Key'/);
  assert.match(tinyfish, /TINYFISH_API_KEY/);
  assert.match(tinyfish, /web:tinyfish/);
  assert.match(tinyfish, /discovery_queries/);
  assert.match(tinyfish, /employerEvidence/);
  assert.match(supplemental, /fetchTinyFishJobs/);
});

test('AI job intelligence uses Groq Cerebras Fireworks and OpenRouter without Clarifai dependency', () => {
  for (const name of ['GROQ_API_KEY','GROQ_API_KEY_2','CEREBRAS_API_KEY','FIREWORKS_AI_API_KEY','OPEN_ROUTER_API_KEY']) {
    assert.match(ai, new RegExp(name));
  }
  assert.doesNotMatch(ai, /CLARIFAI_PAT|api\.clarifai\.com/);
  assert.match(ai, /buildDiscoveryAssist/);
  assert.match(ai, /enrichEntityJobTaxonomy/);
});

test('integration panel exposes job intelligence and does not advertise Clarifai or direct NLX', () => {
  for (const id of ['adzuna','tinyfish','geoapify','job_intelligence_ai','langsearch','careeronestop']) assert.match(panel, new RegExp(id));
  assert.doesNotMatch(panel, /Clarifai/);
  assert.doesNotMatch(panel, /National Labor Exchange/);
  assert.match(route, /configuredAdzunaPairs/);
  assert.match(route, /configuredAiProviders/);
  assert.match(route, /CareerOneStop is the active NLx-resilience mirror/);
});

test('Algolia status continues to require the application ID in addition to ALGOLIA_API_KEY', () => {
  assert.match(route, /ALGOLIA_API_KEY/);
  assert.match(route, /ALGOLIA_APP_ID/);
  assert.match(route, /Algolia still needs ALGOLIA_APP_ID/);
});
