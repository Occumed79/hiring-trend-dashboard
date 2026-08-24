const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const monitors = JSON.parse(fs.readFileSync('config/theirstack-monitors.json', 'utf8'));
const monitorSource = fs.readFileSync('lib/ingest/theirStackMonitors.ts', 'utf8');
const connectorSource = fs.readFileSync('lib/ingest/theirStack.ts', 'utf8');
const syncSource = fs.readFileSync('scripts/sync-theirstack-monitors.js', 'utf8');
const sweepSource = fs.readFileSync('lib/ingest/theirStackCompanySweep.ts', 'utf8');
const refreshSource = fs.readFileSync('lib/ingest/theirStackEntityRefresh.ts', 'utf8');

test('all five TheirStack key slots retain the bootstrap assignment counts', () => {
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

test('bootstrap monitor examples are preserved for outage and first-deploy fallback', () => {
  const names = new Set(monitors.map(row => row.name));
  for (const employer of ['Northrop Grumman','Peraton','Amentum','State of Maine','Federal Aviation Administration','U.S. Customs and Border Pro']) {
    assert.ok(names.has(employer), `missing ${employer}`);
  }
});

test('live monitor sync reads supported TheirStack list metadata and list membership APIs', () => {
  assert.match(syncSource, /\/v0\/company_lists/);
  assert.match(syncSource, /\$\{LISTS_URL\}\/\$\{listId\}\/companies/);
  assert.match(syncSource, /REVEALED_COMPANIES/);
  assert.match(syncSource, /EXPORT_SNAPSHOT/);
  assert.match(syncSource, /selectMonitorList/);
  assert.match(syncSource, /overlapCount/);
});

test('live monitor assignments are persisted in Neon with per-workspace sync state', () => {
  assert.match(syncSource, /theirstack_monitor_assignments/);
  assert.match(syncSource, /theirstack_monitor_sync_state/);
  assert.match(syncSource, /is_active=false/);
  assert.match(syncSource, /source:\s*'live_list'/);
});

test('runtime prefers live saved-list assignments and safely falls back to bootstrap config', () => {
  assert.match(monitorSource, /loadTheirStackMonitors/);
  assert.match(monitorSource, /theirstack_monitor_assignments/);
  assert.match(monitorSource, /return live\.length \? dedupeAssignments\(live\) : uniqueTheirStackMonitors\(\)/);
  assert.match(monitorSource, /catch \{[\s\S]*return uniqueTheirStackMonitors\(\)/);
  assert.match(sweepSource, /await loadTheirStackMonitors\(\)/);
  assert.match(refreshSource, /await monitorsForEntityLive\(entity\)/);
});

test('intentional cross-key duplicate employers remain valid bootstrap assignments', () => {
  const peraton = monitors.filter(row => row.name === 'Peraton');
  assert.deepEqual(new Set(peraton.map(row => row.envKey)), new Set(['THEIRSTACK_API_KEY_2','THEIRSTACK_API_KEY_3']));
  const maryland = monitors.filter(row => row.name === 'State of Maryland' && row.envKey === 'THEIRSTACK_API_KEY_4');
  assert.equal(maryland.length, 1);
});

test('TheirStack legacy connector remains exact-company and open-job only', () => {
  assert.match(connectorSource, /company_name_or:\s*\[employerName\]/);
  assert.match(connectorSource, /company_name_case_insensitive_or:\s*\[employerName\]/);
  assert.match(connectorSource, /is_closed:\s*false/);
  assert.match(connectorSource, /Authorization:\s*`Bearer \$\{apiKey\}`/);
  assert.match(connectorSource, /jobapi:theirstack/);
});

test('new live-list employers are inserted or reactivated without deleting historical entities when removed from a list', () => {
  assert.match(syncSource, /INSERT INTO entities/);
  assert.match(syncSource, /UPDATE entities SET is_active=true/);
  assert.doesNotMatch(syncSource, /UPDATE entities SET is_active=false/);
  assert.doesNotMatch(syncSource, /DELETE FROM entities/);
});
