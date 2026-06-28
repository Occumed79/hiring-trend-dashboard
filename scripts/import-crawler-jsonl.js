#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const fs = require('fs');
const readline = require('readline');
const crypto = require('crypto');
const { Pool } = require('pg');

const args = parseArgs(process.argv.slice(2));
const file = args.file || args.f;
const entityId = args.entityId || args['entity-id'];

if (!file || !entityId) {
  console.error('Usage: node scripts/import-crawler-jsonl.js --entity-id=ENTITY_UUID --file=scrapers/output/company.jsonl');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  let processed = 0;
  let saved = 0;
  let skipped = 0;

  try {
    const entity = await getEntity(client, entityId);
    if (!entity) throw new Error(`No active entity found for id ${entityId}`);

    const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      processed++;
      const item = safeJson(line);
      if (!item) {
        skipped++;
        continue;
      }

      const job = normalizeJob(entity, item);
      if (!job.title || !job.external_id) {
        skipped++;
        continue;
      }
      await saveJob(client, entity.id, job);
      saved++;
    }

    await client.query(
      `INSERT INTO ingest_log (entity_id, source, status, jobs_found, jobs_new, error_message)
       VALUES ($1, 'crawler:career_page', $2, $3, $4, $5)`,
      [entity.id, saved ? 'success' : 'partial', processed, saved, skipped ? `${skipped} row(s) skipped` : null]
    );

    console.log(JSON.stringify({ entity: entity.name, processed, saved, skipped }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

async function getEntity(client, id) {
  const result = await client.query('SELECT id, name FROM entities WHERE id = $1 AND is_active = true', [id]);
  return result.rows[0] || null;
}

function normalizeJob(entity, item) {
  const title = clean(item.title) || 'Untitled role';
  const location = clean(item.location);
  const country = clean(item.country) || detectCountry(location) || 'US';
  const url = clean(item.url) || clean(item.job_url) || clean(item.apply_url);
  return {
    external_id: clean(item.external_id) || hashJob(entity.name, title, url, location),
    source: clean(item.source) || 'crawler:career_page',
    title,
    department: clean(item.department),
    location,
    city: clean(item.city) || splitCity(location),
    state: clean(item.state) || splitState(location),
    country,
    is_remote: Boolean(item.is_remote) || /remote/i.test(`${title} ${location || ''}`),
    is_overseas: Boolean(item.is_overseas) || String(country).toUpperCase() !== 'US',
    posted_at: parseDate(item.posted_at),
    raw_data: JSON.stringify({ ...(isPlainObject(item.raw_data) ? item.raw_data : {}), url, imported_from: 'crawler_jsonl' }),
  };
}

async function saveJob(client, entityId, job) {
  await client.query(
    `INSERT INTO jobs (entity_id, external_id, source, title, department, location, city, state, country, is_remote, is_overseas, posted_at, is_active, raw_data, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13::jsonb,NOW())
     ON CONFLICT (entity_id, external_id, source)
     DO UPDATE SET title = EXCLUDED.title, department = COALESCE(EXCLUDED.department, jobs.department), location = COALESCE(EXCLUDED.location, jobs.location), city = COALESCE(EXCLUDED.city, jobs.city), state = COALESCE(EXCLUDED.state, jobs.state), country = COALESCE(EXCLUDED.country, jobs.country), is_remote = EXCLUDED.is_remote, is_overseas = EXCLUDED.is_overseas, posted_at = COALESCE(EXCLUDED.posted_at, jobs.posted_at), is_active = true, raw_data = COALESCE(jobs.raw_data, '{}'::jsonb) || EXCLUDED.raw_data, updated_at = NOW()`,
    [entityId, job.external_id, job.source, job.title, job.department, job.location, job.city, job.state, job.country, job.is_remote, job.is_overseas, job.posted_at, job.raw_data]
  );
}

function parseArgs(argv) {
  return argv.reduce((acc, arg) => {
    if (!arg.startsWith('--')) return acc;
    const [key, value = true] = arg.slice(2).split('=');
    acc[key] = value;
    return acc;
  }, {});
}

function safeJson(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function splitCity(location) {
  if (!location || /^remote$/i.test(location)) return null;
  return location.split(',')[0]?.trim() || null;
}

function splitState(location) {
  if (!location || /^remote$/i.test(location)) return null;
  return location.split(',')[1]?.trim() || null;
}

function detectCountry(location) {
  if (!location) return null;
  if (/kuwait/i.test(location)) return 'KW';
  if (/qatar/i.test(location)) return 'QA';
  if (/bahrain/i.test(location)) return 'BH';
  if (/iraq/i.test(location)) return 'IQ';
  if (/germany/i.test(location)) return 'DE';
  if (/united kingdom|\buk\b/i.test(location)) return 'GB';
  if (/united states|usa|\b[A-Z]{2}\b/.test(location)) return 'US';
  return null;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function hashJob(entityName, title, url, location) {
  return `crawler-${crypto.createHash('sha1').update(`${entityName}|${title}|${url || ''}|${location || ''}`).digest('hex').slice(0, 24)}`;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
