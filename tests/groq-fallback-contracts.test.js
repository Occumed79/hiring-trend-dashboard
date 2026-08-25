const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }

const source = read('lib/ai/jobIntelligenceAi.ts');

test('job intelligence uses both configured Groq credential slots before external fallbacks', () => {
  assert.match(source, /GROQ_API_KEY/);
  assert.match(source, /GROQ_API_KEY_2/);
  assert.match(source, /Groq #1/);
  assert.match(source, /Groq #2/);
  assert.match(source, /https:\/\/api\.groq\.com\/openai\/v1/);
  assert.match(source, /openai\/gpt-oss-20b/);
});

test('Cerebras Fireworks and OpenRouter are active job-intelligence fallback providers', () => {
  assert.match(source, /CEREBRAS_API_KEY/);
  assert.match(source, /https:\/\/api\.cerebras\.ai\/v1/);
  assert.match(source, /FIREWORKS_AI_API_KEY/);
  assert.match(source, /https:\/\/api\.fireworks\.ai\/inference\/v1/);
  assert.match(source, /OPEN_ROUTER_API_KEY/);
  assert.match(source, /OPENROUTER_API_KEY/);
  assert.match(source, /https:\/\/openrouter\.ai\/api\/v1/);
  assert.match(source, /\/chat\/completions/);
});

test('provider failures fall through the pool instead of stopping discovery or taxonomy', () => {
  assert.match(source, /requestJsonWithPool/);
  assert.match(source, /for \(const provider of providers\)/);
  assert.match(source, /failures\.push/);
  assert.match(source, /rotateProviders/);
});

test('AI provider output persists only job taxonomy metadata', () => {
  assert.match(source, /job_location_category/);
  assert.match(source, /job_taxonomy_ai_provider/);
  assert.match(source, /job_taxonomy_ai_model/);
  assert.match(source, /role_category/);
  assert.doesNotMatch(source, /occupational_health_ai|clarifai_oh|opportunity_score/);
});

test('global search exposes role and location taxonomy without OH scoring', () => {
  const ui = read('components/GlobalJobSearch.tsx');
  const algolia = read('lib/search/algolia.ts');
  assert.match(ui, /functional role category/);
  assert.match(ui, /normalized job location/);
  assert.doesNotMatch(ui, /OH score|occupational-health|respirator fit testing|hearing conservation/i);
  assert.match(algolia, /location_category/);
  assert.doesNotMatch(algolia, /occupational_health_score|occupational_health_signals/);
});
