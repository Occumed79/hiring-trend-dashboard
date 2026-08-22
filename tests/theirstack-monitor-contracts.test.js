const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const monitorSource = fs.readFileSync('lib/ingest/theirStackMonitors.ts', 'utf8');
const connectorSource = fs.readFileSync('lib/ingest/theirStack.ts', 'utf8');
const syncSource = fs.readFileSync('scripts/sync-theirstack-monitors.js', 'utf8');

test('all five TheirStack key slots are mapped', () => {
  for (const key of ['THEIRSTACK_API_KEY','THEIRSTACK_API_KEY_2','THEIRSTACK_API_KEY_3','THEIRSTACK_API_KEY_4','THEIRSTACK_API_KEY_5']) {
    assert.match(monitorSource, new RegExp(key));
    assert.match(syncSource, new RegExp(key));
  }
});

test('supplied monitor examples are preserved', () => {
  for (const employer of ['Northrop Grumman','Peraton','Amentum','State of Maine','Federal Aviation Administration']) {
    assert.ok(monitorSource.includes(employer), `missing ${employer}`);
    assert.ok(syncSource.includes(employer), `sync script missing ${employer}`);
  }
});

test('TheirStack connector requests open jobs with precise company-name filtering', () => {
  assert.match(connectorSource, /company_name_case_insensitive_or:\s*\[employerName\]/);
  assert.match(connectorSource, /is_closed:\s*false/);
  assert.match(connectorSource, /Authorization:\s*`Bearer \$\{apiKey\}`/);
  assert.match(connectorSource, /jobapi:theirstack/);
});

test('monitor sync deduplicates cross-key employers before inserting entities', () => {
  assert.match(syncSource, /if \(seen\.has\(canonical\)\) continue/);
  assert.match(syncSource, /LOWER\(TRIM\(name\)\) = LOWER\(TRIM\(\$1\)\)/);
});
