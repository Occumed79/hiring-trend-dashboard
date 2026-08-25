const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }

const source = read('lib/ai/occupationalHealthAi.ts');

test('OH enrichment uses both configured Groq credential slots before external fallbacks', () => {
  assert.match(source, /GROQ_API_KEY/);
  assert.match(source, /GROQ_API_KEY_2/);
  assert.match(source, /Groq #1/);
  assert.match(source, /Groq #2/);
  assert.match(source, /https:\/\/api\.groq\.com\/openai\/v1/);
  assert.match(source, /openai\/gpt-oss-20b/);
});

test('Cerebras Fireworks and OpenRouter are active OpenAI-compatible fallback providers', () => {
  assert.match(source, /CEREBRAS_API_KEY/);
  assert.match(source, /https:\/\/api\.cerebras\.ai\/v1/);
  assert.match(source, /FIREWORKS_AI_API_KEY/);
  assert.match(source, /https:\/\/api\.fireworks\.ai\/inference\/v1/);
  assert.match(source, /OPEN_ROUTER_API_KEY/);
  assert.match(source, /OPENROUTER_API_KEY/);
  assert.match(source, /https:\/\/openrouter\.ai\/api\/v1/);
  assert.match(source, /\/chat\/completions/);
});

test('provider availability failures open a per-run circuit without stopping the remaining providers', () => {
  assert.match(source, /analyzeWithProviderPool/);
  assert.match(source, /circuitOpen/);
  assert.match(source, /isProviderAvailabilityError/);
  assert.match(source, /401\|403\|408\|429\|5\\d\\d/);
});

test('generic OH schema preserves legacy aliases while metrics prefer the generic field', () => {
  const metrics = read('lib/metrics.ts');
  assert.match(source, /occupational_health_ai: analysis\.result/);
  assert.match(source, /clarifai_oh: analysis\.result/);
  assert.match(metrics, /occupational_health_ai \|\| job\.raw_data\?\.clarifai_oh/);
  assert.match(metrics, /occupational_health_ai \|\| job\.raw_data\.clarifai_oh/);
});

test('OH UI describes a multi-provider layer and no longer advertises Clarifai', () => {
  const roleBreakdown = read('components/charts/RoleBreakdown.tsx');
  assert.match(roleBreakdown, /Multi-provider AI enrichment/);
  assert.doesNotMatch(roleBreakdown, /Clarifai primary/);
  assert.match(roleBreakdown, /No occupational-health enrichment has been persisted/);
});
