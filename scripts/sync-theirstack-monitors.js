require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const { Client } = require('pg');
const STATIC_MONITORS = require('../config/theirstack-monitors.json');

const KEY_SLOTS = [
  'THEIRSTACK_API_KEY',
  'THEIRSTACK_API_KEY_2',
  'THEIRSTACK_API_KEY_3',
  'THEIRSTACK_API_KEY_4',
  'THEIRSTACK_API_KEY_5',
];
const LISTS_URL = 'https://api.theirstack.com/v0/company_lists';
const PAGE_SIZE = 100;
const MAX_PAGES = 25;
const TIMEOUT_MS = positiveInt(process.env.THEIRSTACK_TIMEOUT_MS, 15000);

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required to sync TheirStack monitored employers.');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: sslConfig(process.env.DATABASE_URL) });
  await client.connect();

  try {
    await ensureTables(client);
    const entityRows = await client.query(`SELECT id, name, aliases, portal, is_active FROM entities ORDER BY created_at ASC`);
    const entityIndex = buildEntityIndex(entityRows.rows);

    let inserted = 0;
    let existing = 0;
    let reactivated = 0;
    let liveWorkspaces = 0;
    let fallbackWorkspaces = 0;

    for (const envKey of KEY_SLOTS) {
      const apiKey = String(process.env[envKey] || '').trim();
      const bootstrap = STATIC_MONITORS.filter(row => row.envKey === envKey);
      if (!apiKey) {
        await persistAssignments(client, envKey, bootstrap.map(row => ({ ...row, source: 'config_fallback', listId: null, listName: null })), {
          status: 'missing_key', listId: null, listName: null, overlap: 0, liveCount: 0, error: 'API key missing',
        });
        fallbackWorkspaces++;
        continue;
      }

      try {
        const lists = await fetchJson(apiKey, LISTS_URL);
        const candidates = [];
        for (const list of Array.isArray(lists) ? lists : []) {
          if (!isEligibleList(list)) continue;
          const members = await fetchListCompanies(apiKey, Number(list.id));
          candidates.push({ list, members, overlap: overlapCount(members, bootstrap) });
        }

        const selected = selectMonitorList(candidates, envKey, bootstrap);
        const liveNames = selected ? selected.members.map(member => clean(member?.company_name || member?.company_object?.name)).filter(Boolean) : [];
        const useLive = Boolean(selected && liveNames.length);
        const assignments = useLive
          ? liveNames.map(name => ({
              name,
              envKey,
              portal: resolvePortal(name, selected.list?.name, bootstrap, entityIndex),
              source: 'live_list',
              listId: Number(selected.list.id),
              listName: clean(selected.list.name),
            }))
          : bootstrap.map(row => ({ ...row, source: 'config_fallback', listId: null, listName: null }));

        const unique = uniqueAssignments(assignments);
        await persistAssignments(client, envKey, unique, {
          status: useLive ? 'success' : 'fallback',
          listId: useLive ? Number(selected.list.id) : null,
          listName: useLive ? clean(selected.list.name) : null,
          overlap: useLive ? selected.overlap : 0,
          liveCount: useLive ? unique.length : 0,
          error: useLive ? null : 'No safe live saved-list match found; bootstrap registry retained.',
        });

        for (const monitor of unique) {
          const result = await ensureEntity(client, monitor, entityIndex);
          inserted += result.inserted;
          existing += result.existing;
          reactivated += result.reactivated;
        }

        if (useLive) {
          liveWorkspaces++;
          console.log(`${envKey}: live list "${selected.list.name}" (${selected.list.id}) -> ${unique.length} monitored employers; bootstrap overlap ${selected.overlap}/${bootstrap.length}.`);
        } else {
          fallbackWorkspaces++;
          console.warn(`${envKey}: no safe live list match; using ${unique.length} bootstrap assignments.`);
        }
      } catch (error) {
        const message = errorMessage(error);
        const fallback = bootstrap.map(row => ({ ...row, source: 'config_fallback', listId: null, listName: null }));
        await persistAssignments(client, envKey, fallback, {
          status: 'error_fallback', listId: null, listName: null, overlap: 0, liveCount: 0, error: message,
        });
        for (const monitor of uniqueAssignments(fallback)) {
          const result = await ensureEntity(client, monitor, entityIndex);
          inserted += result.inserted;
          existing += result.existing;
          reactivated += result.reactivated;
        }
        fallbackWorkspaces++;
        console.warn(`${envKey}: live list sync failed (${message}); bootstrap assignments retained.`);
      }
    }

    console.log(
      `TheirStack monitor sync complete: ${liveWorkspaces} live workspace(s), ${fallbackWorkspaces} fallback workspace(s), ` +
      `${inserted} inserted, ${existing} matched existing entities, ${reactivated} reactivated.`
    );
  } finally {
    await client.end();
  }
}

async function ensureTables(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS theirstack_monitor_assignments (
    env_key TEXT NOT NULL,
    company_name TEXT NOT NULL,
    portal TEXT NOT NULL,
    list_id BIGINT,
    list_name TEXT,
    source TEXT NOT NULL DEFAULT 'config_fallback',
    is_active BOOLEAN NOT NULL DEFAULT true,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (env_key, company_name)
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_theirstack_monitor_assignments_active ON theirstack_monitor_assignments (is_active, env_key)`);
  await client.query(`CREATE TABLE IF NOT EXISTS theirstack_monitor_sync_state (
    env_key TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    list_id BIGINT,
    list_name TEXT,
    bootstrap_overlap INTEGER NOT NULL DEFAULT 0,
    live_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

async function persistAssignments(client, envKey, assignments, state) {
  await client.query('BEGIN');
  try {
    await client.query(`UPDATE theirstack_monitor_assignments SET is_active=false, updated_at=NOW() WHERE env_key=$1`, [envKey]);
    for (const monitor of uniqueAssignments(assignments)) {
      await client.query(
        `INSERT INTO theirstack_monitor_assignments
           (env_key, company_name, portal, list_id, list_name, source, is_active, first_seen_at, last_seen_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,true,NOW(),NOW(),NOW())
         ON CONFLICT (env_key, company_name) DO UPDATE SET
           portal=EXCLUDED.portal, list_id=EXCLUDED.list_id, list_name=EXCLUDED.list_name,
           source=EXCLUDED.source, is_active=true, last_seen_at=NOW(), updated_at=NOW()`,
        [envKey, monitor.name, monitor.portal, monitor.listId ?? null, monitor.listName ?? null, monitor.source || 'config_fallback'],
      );
    }
    await client.query(
      `INSERT INTO theirstack_monitor_sync_state
         (env_key,status,list_id,list_name,bootstrap_overlap,live_count,last_error,last_synced_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
       ON CONFLICT (env_key) DO UPDATE SET
         status=EXCLUDED.status,list_id=EXCLUDED.list_id,list_name=EXCLUDED.list_name,
         bootstrap_overlap=EXCLUDED.bootstrap_overlap,live_count=EXCLUDED.live_count,
         last_error=EXCLUDED.last_error,last_synced_at=NOW(),updated_at=NOW()`,
      [envKey, state.status, state.listId, state.listName, state.overlap || 0, state.liveCount || 0, state.error ? String(state.error).slice(0, 2000) : null],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function ensureEntity(client, monitor, entityIndex) {
  const canonical = normalizeName(monitor.name);
  const existing = entityIndex.get(canonical);
  if (existing) {
    let reactivated = 0;
    if (existing.is_active === false) {
      await client.query(`UPDATE entities SET is_active=true, updated_at=NOW() WHERE id=$1`, [existing.id]);
      existing.is_active = true;
      reactivated = 1;
      console.log(`Reactivated TheirStack monitor: ${monitor.name}`);
    }
    return { inserted: 0, existing: 1, reactivated };
  }

  const rows = await client.query(
    `INSERT INTO entities (name, aliases, portal, ats_provider, category, is_active)
     VALUES ($1,$2::text[],$3::portal_type,'unknown'::ats_provider,$4,true)
     RETURNING id,name,aliases,portal,is_active`,
    [monitor.name, [], monitor.portal, `theirstack-monitor:${monitor.envKey}${monitor.listId ? `:list-${monitor.listId}` : ''}`],
  );
  const row = rows.rows[0];
  entityIndex.set(canonical, row);
  console.log(`Added TheirStack monitor: ${monitor.name} -> ${monitor.portal} (${monitor.envKey})`);
  return { inserted: 1, existing: 0, reactivated: 0 };
}

function selectMonitorList(candidates, envKey, bootstrap) {
  if (!candidates.length) return null;
  const override = explicitListId(envKey);
  if (override) return candidates.find(row => Number(row.list?.id) === override) || null;

  const sorted = [...candidates].sort((a, b) => {
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    const aRatio = a.members.length ? a.overlap / a.members.length : 0;
    const bRatio = b.members.length ? b.overlap / b.members.length : 0;
    if (bRatio !== aRatio) return bRatio - aRatio;
    return Number(b.list?.companies_count || b.members.length) - Number(a.list?.companies_count || a.members.length);
  });
  const best = sorted[0];
  if (!best || best.overlap <= 0) return null;
  const bootstrapRatio = bootstrap.length ? best.overlap / bootstrap.length : 0;
  const memberRatio = best.members.length ? best.overlap / best.members.length : 0;
  // Strong overlap protects us from accidentally adopting broad system/history lists.
  if (best.overlap >= 3 || bootstrapRatio >= 0.25 || memberRatio >= 0.5) return best;
  return null;
}

function explicitListId(envKey) {
  const suffix = envKey === 'THEIRSTACK_API_KEY' ? '' : envKey.replace('THEIRSTACK_API_KEY', '');
  const value = Number(process.env[`THEIRSTACK_MONITOR_LIST_ID${suffix}`]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function isEligibleList(list) {
  if (!list || !Number.isFinite(Number(list.id))) return false;
  const type = String(list.type || '').toUpperCase();
  if (type === 'REVEALED_COMPANIES' || type === 'EXPORT_SNAPSHOT') return false;
  return Number(list.companies_count || 0) > 0;
}

async function fetchListCompanies(apiKey, listId) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${LISTS_URL}/${listId}/companies`);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('page', String(page));
    url.searchParams.set('order_by', 'name');
    url.searchParams.set('order_direction', 'asc');
    const payload = await fetchJson(apiKey, url.toString());
    const pageRows = Array.isArray(payload) ? payload : [];
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchJson(apiKey, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.description || payload?.error?.title || `HTTP ${response.status}`);
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`timeout after ${TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function overlapCount(members, bootstrap) {
  const expected = new Set(bootstrap.map(row => normalizeName(row.name)).filter(Boolean));
  const observed = new Set(members.map(row => normalizeName(row?.company_name || row?.company_object?.name)).filter(Boolean));
  let overlap = 0;
  for (const name of expected) if (observed.has(name)) overlap++;
  return overlap;
}

function resolvePortal(name, listName, bootstrap, entityIndex) {
  const canonical = normalizeName(name);
  const staticMatch = bootstrap.find(row => normalizeName(row.name) === canonical);
  if (staticMatch?.portal) return staticMatch.portal;
  const existing = entityIndex.get(canonical);
  if (existing?.portal) return existing.portal;
  return inferPortal(`${name} ${listName || ''}`);
}

function inferPortal(value) {
  const text = normalizeName(value);
  if (/\b(?:federal|united states|us department|u s department|bureau of prisons|customs and border|federal aviation administration)\b/.test(text)) return 'federal_agencies';
  if (/\bstate of\b/.test(text) || /\bdepartment of transportation\b/.test(text) || /\bdepartment of public safety\b/.test(text)) return 'state_agencies';
  if (/\b(?:city of|county of| county|parish|borough|municipality|transit|regional park district|special district)\b/.test(text)) return 'counties_and_cities';
  return 'private_companies';
}

function buildEntityIndex(rows) {
  const map = new Map();
  for (const row of rows) {
    for (const value of [row.name, ...(Array.isArray(row.aliases) ? row.aliases : [])]) {
      const key = normalizeName(value);
      if (key && !map.has(key)) map.set(key, row);
    }
  }
  return map;
}

function uniqueAssignments(monitors) {
  const seen = new Set();
  return (Array.isArray(monitors) ? monitors : []).filter(monitor => {
    if (!monitor?.name || !monitor?.envKey || !monitor?.portal) return false;
    const key = `${monitor.envKey}|${normalizeName(monitor.name)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clean(value) { const text = String(value || '').replace(/\s+/g, ' ').trim(); return text || null; }
function normalizeName(value) { return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function positiveInt(value, fallback) { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback; }
function errorMessage(error) { return error instanceof Error ? error.message : String(error); }
function sslConfig(connectionString) { try { const url = new URL(connectionString); if ((url.searchParams.get('sslmode') || '').toLowerCase() === 'disable') return undefined; } catch {} return { rejectUnauthorized: false }; }

run().catch(error => {
  console.error('TheirStack monitor sync failed:', errorMessage(error));
  process.exit(1);
});
