const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

test('Groq is the automatic OH fallback behind Clarifai', () => {
  const source = read('lib/ai/clarifaiOccupationalHealth.ts');
  assert.match(source, /GROQ_API_KEY/);
  assert.match(source, /https:\/\/api\.groq\.com\/openai\/v1/);
  assert.match(source, /openai\/gpt-oss-20b/);
  assert.match(source, /Authorization: provider === 'clarifai' \? `Key \$\{apiKey\}` : `Bearer \$\{apiKey\}`/);
  assert.match(source, /analyzeJobWithFallback/);
  assert.match(source, /provider: 'groq'/);
  assert.match(source, /primary: 'clarifai'/);
  assert.match(source, /fallback: 'groq'/);
});

test('missing Clarifai credential routes enrichment to Groq instead of skipping when Groq is configured', () => {
  const source = read('lib/ai/clarifaiOccupationalHealth.ts');
  assert.match(source, /process\.env\.CLARIFAI_PAT \|\| process\.env\.CLARIFAI_API_KEY/);
  assert.match(source, /process\.env\.GROQ_API_KEY \|\| process\.env\.GROQ_API_KEY_2/);
  assert.match(source, /if \(!clarifaiPat && !groqApiKey\)/);
  assert.doesNotMatch(source, /if \(!pat\) return \{ status: 'skipped'/);
  assert.match(source, /clarifaiCircuitOpen: !clarifaiPat/);
  assert.match(source, /Clarifai credential missing/);
});

test('Clarifai availability failures open a circuit and bounded Groq fallback prevents runaway free-tier usage', () => {
  const source = read('lib/ai/clarifaiOccupationalHealth.ts');
  assert.match(source, /isProviderAvailabilityError/);
  assert.match(source, /http \(401\|403\|408\|429\|5\\d\\d\)/);
  assert.match(source, /GROQ_MAX_FALLBACKS_PER_RUN/);
  assert.match(source, /groqAttempts >= GROQ_MAX_FALLBACKS_PER_RUN/);
  assert.match(source, /pending: Math\.max\(0, candidates\.length - attempted\)/);
});

test('the same cached OH schema records the provider and remains compatible with metrics and Algolia', () => {
  const source = read('lib/ai/clarifaiOccupationalHealth.ts');
  const metrics = read('lib/metrics.ts');
  const algolia = read('lib/search/algolia.ts');
  assert.match(source, /clarifai_oh: analysis\.result/);
  assert.match(source, /clarifai_oh_provider: analysis\.provider/);
  assert.match(source, /occupational_health_ai_provider: analysis\.provider/);
  assert.match(metrics, /raw_data\?\.clarifai_oh/);
  assert.match(algolia, /raw_data\?\.clarifai_oh/);
});

test('Render declares Groq for both manual web refreshes and scheduled cron ingestion', () => {
  const render = read('render.yaml');
  const keys = render.match(/key: GROQ_API_KEY/g) || [];
  const models = render.match(/key: GROQ_MODEL/g) || [];
  assert.equal(keys.length, 2);
  assert.equal(models.length, 2);
});

test('OH UI identifies Clarifai primary and Groq fallback without changing role classification', () => {
  const roleBreakdown = read('components/charts/RoleBreakdown.tsx');
  assert.match(roleBreakdown, /Role Breakdown/);
  assert.match(roleBreakdown, /Occupational Health Signals/);
  assert.match(roleBreakdown, /Clarifai primary \/ Groq fallback/);
  assert.match(roleBreakdown, /No occupational-health enrichment has been persisted/);
});
