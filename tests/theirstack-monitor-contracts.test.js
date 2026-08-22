const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const monitors = JSON.parse(fs.readFileSync('config/theirstack-monitors.json', 'utf8'));
const monitorSource = fs.readFileSync('lib/ingest/theirStackMonitors.ts', 'utf8');
const connectorSource = fs.readFileSync('lib/ingest/theirStack.ts', 'utf8');
const syncSource = fs.readFileSync('scripts/sync-theirstack-monitors.js', 'utf8');

test('all five TheirStack key slots contain the supplied assignment counts', () => {
  const expected = {
    THEIRSTACK_API_KEY: 12,
    THEIRSTACK_API_KEY_2: 16,
    THEIRSTACK_API_KEY_3: 18,
    THEIRSTACK_API_KEY_4: 34,
    THEIRSTACK_API_KEY_5: 22,
  };
  assert.equal(monitors.length, 102);
  for (const [key, count] of Object.entries(expected)) {
    assert.equal(monitors.filter(row => row.envKey === key).length, count, `${key} assignment count changed`);
  }
  assert.equal(new Set(monitors.map(row => row.name.toLowerCase())).size, 101, 'expected one cross-key duplicate employer');
});

test('supplied monitor examples are preserved in the central registry', () => {
  const names = new Set(monitors.map(row => row.name));
  for (const employer of ['Northrop Grumman','Peraton','Amentum','State of Maine','Federal Aviation Administration','U.S. Customs and Border Pro']) {
    assert.ok(names.has(employer), `missing ${employer}`);
  }
});

test('intentional and accidental duplicates are handled correctly', () => {
  const peraton = monitors.filter(row => row.name === 'Peraton');
  assert.deepEqual(new Set(peraton.map(row => row.envKey)), new Set(['THEIRSTACK_API_KEY_2','THEIRSTACK_API_KEY_3']));
  const maryland = monitors.filter(row => row.name === 'State of Maryland' && row.envKey === 'THEIRSTACK_API_KEY_4');
  assert.equal(maryland.length, 1);
});

test('runtime and sync both use the central monitor registry', () => {
  assert.match(monitorSource, /config\/theirstack-monitors\.json/);
  assert.match(syncSource, /config\/theirstack-monitors\.json/);
});

test('TheirStack connector requests only open jobs with precise company-name filtering', () => {
  assert.match(connectorSource, /company_name_or:\s*\[employerName\]/);
  assert.match(connectorSource, /company_name_case_insensitive_or:\s*\[employerName\]/);
  assert.match(connectorSource, /is_closed:\s*false/);
  assert.match(connectorSource, /Authorization:\s*`Bearer \$\{apiKey\}`/);
  assert.match(connectorSource, /jobapi:theirstack/);
});

test('entity sync deduplicates cross-key employers before inserting entities', () => {
  assert.match(syncSource, /if \(seen\.has\(canonical\)\) continue/);
  assert.match(syncSource, /LOWER\(TRIM\(name\)\) = LOWER\(TRIM\(\$1\)\)/);
});
