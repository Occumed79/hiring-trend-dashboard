try {
  const dotenv = require('dotenv');
  dotenv.config({ path: '.env.local' });
  dotenv.config();
} catch (err) {
  if (err?.code !== 'MODULE_NOT_FOUND') throw err;
}

const zlib = require('zlib');
const { Client } = require('pg');

const DEFAULT_SOURCE = 'https://www2.census.gov/programs-surveys/gus/datasets/2025/gov_units_2025.zip';
const SOURCE_YEAR = Number(process.env.CENSUS_GOVERNMENT_REGISTRY_YEAR || 2025);
const SOURCE_URL = process.env.CENSUS_GOVERNMENT_REGISTRY_URL || DEFAULT_SOURCE;
const STALE_DAYS = clamp(Number(process.env.CENSUS_GOVERNMENT_REGISTRY_STALE_DAYS || 30), 1, 365);
const BATCH_SIZE = clamp(Number(process.env.CENSUS_GOVERNMENT_REGISTRY_BATCH_SIZE || 250), 25, 1000);
const MAX_REGISTRY_FILE_BYTES = clamp(Number(process.env.CENSUS_GOVERNMENT_REGISTRY_MAX_BYTES || 128 * 1024 * 1024), 1024 * 1024, 512 * 1024 * 1024);

const STATE_BY_FIPS = {
  '01':['AL','Alabama'],'02':['AK','Alaska'],'04':['AZ','Arizona'],'05':['AR','Arkansas'],'06':['CA','California'],
  '08':['CO','Colorado'],'09':['CT','Connecticut'],'10':['DE','Delaware'],'11':['DC','District of Columbia'],'12':['FL','Florida'],
  '13':['GA','Georgia'],'15':['HI','Hawaii'],'16':['ID','Idaho'],'17':['IL','Illinois'],'18':['IN','Indiana'],'19':['IA','Iowa'],
  '20':['KS','Kansas'],'21':['KY','Kentucky'],'22':['LA','Louisiana'],'23':['ME','Maine'],'24':['MD','Maryland'],'25':['MA','Massachusetts'],
  '26':['MI','Michigan'],'27':['MN','Minnesota'],'28':['MS','Mississippi'],'29':['MO','Missouri'],'30':['MT','Montana'],'31':['NE','Nebraska'],
  '32':['NV','Nevada'],'33':['NH','New Hampshire'],'34':['NJ','New Jersey'],'35':['NM','New Mexico'],'36':['NY','New York'],'37':['NC','North Carolina'],
  '38':['ND','North Dakota'],'39':['OH','Ohio'],'40':['OK','Oklahoma'],'41':['OR','Oregon'],'42':['PA','Pennsylvania'],'44':['RI','Rhode Island'],
  '45':['SC','South Carolina'],'46':['SD','South Dakota'],'47':['TN','Tennessee'],'48':['TX','Texas'],'49':['UT','Utah'],'50':['VT','Vermont'],
  '51':['VA','Virginia'],'53':['WA','Washington'],'54':['WV','West Virginia'],'55':['WI','Wisconsin'],'56':['WY','Wyoming'],
  '60':['AS','American Samoa'],'66':['GU','Guam'],'69':['MP','Northern Mariana Islands'],'72':['PR','Puerto Rico'],'78':['VI','U.S. Virgin Islands'],
};

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required to sync the Census government registry.');
  const client = new Client({ connectionString, ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });
  await client.connect();
  try {
    if (process.argv.includes('--if-stale') && !(await shouldRefresh(client))) {
      console.log('Census government registry is fresh; skipping sync.');
      return;
    }

    console.log(`Downloading Census ${SOURCE_YEAR} Government Units Listing...`);
    const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(45000), headers: { 'user-agent': 'OccuMedHiringTrendDashboard/1.0' } });
    if (!response.ok) throw new Error(`Census registry download failed: HTTP ${response.status}`);
    const archive = Buffer.from(await response.arrayBuffer());
    const extracted = extractLargestRegistryFile(archive);
    const text = extracted.data.toString('utf8').replace(/^\uFEFF/, '');
    console.log(`Using ${extracted.name} from Census archive (${extracted.data.length.toLocaleString()} bytes).`);

    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length < 2) throw new Error('Census registry file contained no data rows.');
    const delimiter = detectDelimiter(lines[0]);
    const headers = parseDelimitedLine(lines[0], delimiter).map(normalizeHeader);
    const rowsById = new Map();
    let skipped = 0;
    let duplicateIds = 0;

    for (let index = 1; index < lines.length; index++) {
      const values = parseDelimitedLine(lines[index], delimiter);
      const raw = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? '']));
      const normalized = normalizeGovernment(raw);
      if (!normalized) { skipped++; continue; }
      if (rowsById.has(normalized.id)) {
        duplicateIds++;
        continue;
      }
      rowsById.set(normalized.id, normalized);
    }

    const rows = Array.from(rowsById.values());
    if (rows.length < 1000) throw new Error(`Refusing suspicious Census registry import: only ${rows.length} normalized rows.`);
    console.log(`Parsed ${rows.length.toLocaleString()} unique government units (${skipped.toLocaleString()} rows skipped, ${duplicateIds.toLocaleString()} duplicate IDs collapsed).`);

    await client.query('BEGIN');
    // The table is an annual Census mirror. Retire all prior active rows before
    // activating the new release so a government removed/renamed between years
    // cannot remain selectable forever under an older source_year.
    await client.query('UPDATE government_registry SET is_active = false WHERE is_active = true');
    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
      const batch = rows.slice(offset, offset + BATCH_SIZE);
      await upsertBatch(client, batch);
      if (offset % 5000 === 0) console.log(`Upserted ${Math.min(offset + batch.length, rows.length).toLocaleString()} / ${rows.length.toLocaleString()}...`);
    }
    await client.query('COMMIT');
    console.log(`Census government registry sync complete: ${rows.length.toLocaleString()} active units.`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function shouldRefresh(client) {
  try {
    const result = await client.query(`SELECT COUNT(*)::int AS cnt, MAX(updated_at) AS last_sync FROM government_registry WHERE source_year = $1 AND is_active = true`, [SOURCE_YEAR]);
    const count = Number(result.rows[0]?.cnt || 0);
    const last = result.rows[0]?.last_sync ? new Date(result.rows[0].last_sync).getTime() : 0;
    return count < 1000 || !last || Date.now() - last > STALE_DAYS * 86400000;
  } catch {
    return true;
  }
}

async function upsertBatch(client, rows) {
  const columns = ['census_government_id','name','canonical_name','government_type','state_fips','state_code','state_name','county_fips','county_name','place_fips','website','source_year','source_url','raw_data','is_active','updated_at'];
  const params = [];
  const values = rows.map((row, rowIndex) => {
    const data = [row.id,row.name,row.canonical,row.type,row.stateFips,row.stateCode,row.stateName,row.countyFips,row.countyName,row.placeFips,row.website,SOURCE_YEAR,SOURCE_URL,JSON.stringify(row.raw),true,new Date().toISOString()];
    params.push(...data);
    const start = rowIndex * columns.length;
    return `(${columns.map((_, i) => `$${start + i + 1}`).join(',')})`;
  });
  await client.query(`
    INSERT INTO government_registry (${columns.join(',')}) VALUES ${values.join(',')}
    ON CONFLICT (census_government_id) DO UPDATE SET
      name = EXCLUDED.name,
      canonical_name = EXCLUDED.canonical_name,
      government_type = EXCLUDED.government_type,
      state_fips = EXCLUDED.state_fips,
      state_code = EXCLUDED.state_code,
      state_name = EXCLUDED.state_name,
      county_fips = EXCLUDED.county_fips,
      county_name = EXCLUDED.county_name,
      place_fips = EXCLUDED.place_fips,
      website = COALESCE(EXCLUDED.website, government_registry.website),
      source_year = EXCLUDED.source_year,
      source_url = EXCLUDED.source_url,
      raw_data = EXCLUDED.raw_data,
      is_active = true,
      updated_at = EXCLUDED.updated_at
  `, params);
}

function extractLargestRegistryFile(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error('Census registry ZIP is empty or invalid.');
  const eocd = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (totalEntries === 0 || totalEntries === 0xffff || centralOffset === 0xffffffff) throw new Error('Unsupported or empty Census ZIP archive.');

  const candidates = [];
  let cursor = centralOffset;
  for (let index = 0; index < totalEntries; index++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Malformed Census ZIP central directory.');
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.length) throw new Error('Malformed Census ZIP filename entry.');
    const name = buffer.subarray(nameStart, nameEnd).toString('utf8');
    if (!name.endsWith('/') && /\.(?:csv|txt)$/i.test(name)) {
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) throw new Error('ZIP64 Census registry archives are not supported.');
      if (uncompressedSize > MAX_REGISTRY_FILE_BYTES) throw new Error(`Census registry file ${name} exceeds the configured extraction limit.`);
      candidates.push({ name, flags, method, compressedSize, uncompressedSize, localOffset });
    }
    cursor = nameEnd + extraLength + commentLength;
  }

  const entry = candidates.sort((a, b) => b.uncompressedSize - a.uncompressedSize)[0];
  if (!entry) throw new Error('Census registry ZIP did not contain a CSV/TXT data file.');
  if (entry.flags & 0x1) throw new Error('Encrypted Census ZIP entries are not supported.');
  if (entry.localOffset + 30 > buffer.length || buffer.readUInt32LE(entry.localOffset) !== 0x04034b50) throw new Error('Malformed Census ZIP local entry.');
  const localNameLength = buffer.readUInt16LE(entry.localOffset + 26);
  const localExtraLength = buffer.readUInt16LE(entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + localNameLength + localExtraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataStart < 0 || dataEnd > buffer.length) throw new Error('Census ZIP entry data is truncated.');
  const compressed = buffer.subarray(dataStart, dataEnd);
  const data = entry.method === 0
    ? Buffer.from(compressed)
    : entry.method === 8
      ? zlib.inflateRawSync(compressed, { maxOutputLength: MAX_REGISTRY_FILE_BYTES })
      : (() => { throw new Error(`Unsupported Census ZIP compression method ${entry.method}.`); })();
  if (data.length !== entry.uncompressedSize) throw new Error(`Census ZIP entry size mismatch for ${entry.name}.`);
  return { name: entry.name, data };
}

function findEndOfCentralDirectory(buffer) {
  const min = Math.max(0, buffer.length - 65557);
  for (let cursor = buffer.length - 22; cursor >= min; cursor--) {
    if (buffer.readUInt32LE(cursor) === 0x06054b50) return cursor;
  }
  throw new Error('Census registry ZIP is missing its end-of-central-directory record.');
}

function normalizeGovernment(raw) {
  const name = pick(raw, ['GOVNAME','GOVERNMENTNAME','UNITNAME','NAME','GOVTNAME']);
  if (!name) return null;
  const stateFips = leftPad(pick(raw, ['STATE','STATEFIPS','STATEFP','STATECODE','FIPSTATE','FSTATE']), 2);
  const stateMeta = STATE_BY_FIPS[stateFips] || [];
  const stateCode = pick(raw, ['STAB','STUSAB','STATEABBR','STATEABBREVIATION']) || stateMeta[0] || null;
  const stateName = pick(raw, ['STNAME','STATENAME']) || stateMeta[1] || null;
  const countyFips = leftPad(pick(raw, ['COUNTY','COUNTYFIPS','COUNTYFP','FIPCOUNTY','FCOUNTY']), 3);
  const placeFips = leftPad(pick(raw, ['PLACE','PLACEFIPS','PLACEFP','FPLACE']), 5);
  const typeRaw = pick(raw, ['GOVTYPE','GOVERNMENTTYPE','UNITTYPE','TYPE','GOVTYPECODE']);
  const website = normalizeUrl(pick(raw, ['WEBSITE','WEBURL','URL','WEB','HOMEPAGE']));
  const sourceId = pick(raw, ['GOVID','GOVERNMENTID','GOV_ID','UNITID','GOVTID','GOVIDNU','ID']);
  const id = sourceId || `fallback-${SOURCE_YEAR}-${hashString([name,stateFips,countyFips,placeFips,typeRaw,website].map(value => value || '').join('|'))}`;
  return {
    id: String(id).trim(),
    name: String(name).trim(),
    canonical: canonicalName(name),
    type: normalizeGovernmentType(typeRaw, name),
    stateFips: stateFips || null,
    stateCode: stateCode ? String(stateCode).trim().toUpperCase() : null,
    stateName: stateName ? String(stateName).trim() : null,
    countyFips: countyFips || null,
    countyName: nullable(pick(raw, ['COUNTYNAME','CNTYNAME'])),
    placeFips: placeFips || null,
    website,
    raw,
  };
}

function normalizeGovernmentType(value, name) {
  const raw = String(value || '').trim().toLowerCase();
  const numeric = {
    '0':'state',
    '1':'county',
    '2':'municipality',
    '3':'township',
    '4':'special_district',
    '5':'school_district',
    '6':'federal',
    '7':'tribal',
  };
  if (numeric[raw]) return numeric[raw];
  if (/county/.test(raw) || /county\b/i.test(name)) return 'county';
  if (/municip|city|borough|village/.test(raw) || /\b(city|village|borough)\b/i.test(name)) return 'municipality';
  if (/township|\btown\b/.test(raw) || /\btownship\b/i.test(name)) return 'township';
  if (/school/.test(raw)) return 'school_district';
  if (/special|district/.test(raw)) return 'special_district';
  if (/state/.test(raw)) return 'state';
  return raw || 'other';
}

function detectDelimiter(header) {
  const candidates = [',','|','\t',';'];
  return candidates.sort((a,b) => countOutsideQuotes(header,b) - countOutsideQuotes(header,a))[0];
}
function countOutsideQuotes(line, delimiter) {
  let quoted = false, count = 0;
  for (let i=0;i<line.length;i++) { if (line[i] === '"') quoted = !quoted; else if (!quoted && line[i] === delimiter) count++; }
  return count;
}
function parseDelimitedLine(line, delimiter) {
  const out = []; let value = ''; let quoted = false;
  for (let i=0;i<line.length;i++) {
    const char = line[i];
    if (char === '"') { if (quoted && line[i+1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (char === delimiter && !quoted) { out.push(value); value = ''; }
    else value += char;
  }
  out.push(value); return out.map((entry) => entry.trim());
}
function normalizeHeader(value) { return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, ''); }
function pick(row, keys) { for (const key of keys) { const value = row[normalizeHeader(key)]; if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim(); } return null; }
function nullable(value) { return value && String(value).trim() ? String(value).trim() : null; }
function canonicalName(value) { return String(value || '').toLowerCase().replace(/&/g,' and ').replace(/\b(the|government of|state of|city of|county of)\b/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim(); }
function leftPad(value, length) { if (value === null || value === undefined || value === '') return ''; const text = String(value).trim(); return /^\d+$/.test(text) ? text.padStart(length,'0') : text; }
function normalizeUrl(value) { if (!value) return null; try { const url = new URL(String(value).trim().match(/^https?:/i) ? String(value).trim() : `https://${String(value).trim()}`); return url.toString(); } catch { return null; } }
function hashString(value) { let hash = 2166136261; for (let i=0;i<value.length;i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash,16777619); } return (hash >>> 0).toString(36); }
function clamp(value, min, max) { return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), min), max) : min; }

main().catch((error) => { console.error(error); process.exitCode = 1; });
