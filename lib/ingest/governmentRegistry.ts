import { query } from '@/db/client';

type GovernmentPortal = 'state_agencies' | 'counties_and_cities';

export type GovernmentRegistryMatch = {
  census_government_id: string;
  name: string;
  canonical_name: string;
  government_type: string | null;
  state_fips: string | null;
  state_code: string | null;
  state_name: string | null;
  county_fips: string | null;
  county_name: string | null;
  place_fips: string | null;
  website: string | null;
  score: number;
};

export async function enrichEntityFromGovernmentRegistry(entity: any) {
  if (!entity || !['state_agencies','counties_and_cities'].includes(String(entity.portal || ''))) return entity;
  if (entity.government_registry_id && entity.government_type) return entity;

  const match = await resolveGovernmentRegistryMatch(entity.name, entity.portal);
  if (!match) return entity;
  const metadata = governmentRegistryMetadata(match);
  const aliases = Array.from(new Set([...(Array.isArray(entity.aliases) ? entity.aliases : []), ...registryAliases(match)]));
  try {
    await query(
      `UPDATE entities
       SET government_registry_id = $2, government_type = $3, government_state = $4,
           government_fips = $5, aliases = $6, updated_at = NOW()
       WHERE id = $1`,
      [entity.id, metadata.government_registry_id, metadata.government_type, metadata.government_state, metadata.government_fips, aliases],
    );
  } catch (error) {
    console.warn('Could not persist government registry enrichment:', error instanceof Error ? error.message : error);
  }
  return { ...entity, ...metadata, aliases, government_registry_match: match };
}

export async function resolveGovernmentRegistryMatch(name: string, portal: GovernmentPortal): Promise<GovernmentRegistryMatch | null> {
  const canonical = canonicalGovernmentName(name);
  if (!canonical) return null;
  const significant = canonical.split(' ').filter(token => token.length >= 3 && !STOP_WORDS.has(token));
  if (!significant.length) return null;

  try {
    const params: any[] = [`%${significant[0]}%`];
    let sql = `
      SELECT census_government_id, name, canonical_name, government_type, state_fips, state_code,
             state_name, county_fips, county_name, place_fips, website
      FROM government_registry
      WHERE is_active = true AND canonical_name ILIKE $1
    `;
    if (portal === 'counties_and_cities') {
      params.push(['county','municipality','township']);
      sql += ` AND government_type = ANY($2::text[])`;
    } else {
      params.push(['state','county','municipality','township','special_district']);
      sql += ` AND government_type = ANY($2::text[])`;
    }
    sql += ` LIMIT 250`;

    const rows = await query(sql, params);
    const stateHint = extractStateHint(name);
    const typeHint = extractTypeHint(name, portal);
    const scored = rows
      .map((row: any) => ({ ...row, score: scoreMatch(canonical, row, stateHint, typeHint) }))
      .filter((row: any) => row.score >= minimumScore(portal, typeHint))
      .sort((a: any, b: any) => b.score - a.score || String(a.name).length - String(b.name).length);

    if (!scored.length) return null;
    if (scored.length > 1 && scored[0].score === scored[1].score && scored[0].state_code !== scored[1].state_code) return null;
    return scored[0] as GovernmentRegistryMatch;
  } catch (error) {
    // Migration may not have reached a local development database yet. Registry
    // resolution is enrichment; source discovery still works without it.
    console.warn('Government registry lookup unavailable:', error instanceof Error ? error.message : error);
    return null;
  }
}

export function registryAliases(match: GovernmentRegistryMatch | null): string[] {
  if (!match) return [];
  const aliases = new Set<string>([match.name]);
  const base = canonicalGovernmentName(match.name);
  if (match.government_type === 'county') {
    aliases.add(`${base.replace(/ county$/, '')} County`);
    if (match.state_code) aliases.add(`${base.replace(/ county$/, '')} County, ${match.state_code}`);
  }
  if (match.government_type === 'municipality') {
    const stripped = base.replace(/^(city|town|village|borough) of /, '').replace(/ (city|town|village|borough)$/, '');
    aliases.add(stripped);
    aliases.add(`City of ${titleCase(stripped)}`);
    if (match.state_code) aliases.add(`${titleCase(stripped)}, ${match.state_code}`);
  }
  if (match.state_name) aliases.add(match.state_name);
  return Array.from(aliases).map(value => value.trim()).filter(Boolean);
}

export function governmentRegistryMetadata(match: GovernmentRegistryMatch | null) {
  if (!match) return {
    government_registry_id: null,
    government_type: null,
    government_state: null,
    government_fips: null,
  };
  return {
    government_registry_id: match.census_government_id,
    government_type: match.government_type,
    government_state: match.state_code || match.state_name || null,
    government_fips: governmentGeographicFips(match),
  };
}

export function governmentGeographicFips(match: Pick<GovernmentRegistryMatch, 'government_type'|'state_fips'|'county_fips'|'place_fips'> | null) {
  if (!match?.state_fips) return null;
  const type = normalizeType(match.government_type);
  if (type === 'state') return match.state_fips;
  if (type === 'county' && match.county_fips) return `${match.state_fips}${match.county_fips}`;
  if (type === 'municipality' && match.place_fips) return `${match.state_fips}${match.place_fips}`;
  // Township/county-subdivision and special-district GEOIDs require identifiers
  // not represented by the generic county/place fields in this registry mirror.
  // Do not manufacture a plausible-looking but wrong geographic FIPS.
  return null;
}

function scoreMatch(input: string, row: any, stateHint: string | null, typeHint: string | null) {
  const candidate = canonicalGovernmentName(row.canonical_name || row.name);
  let score = 0;
  if (candidate === input) score += 100;
  else {
    const inputTokens = tokenSet(input);
    const candidateTokens = tokenSet(candidate);
    const overlap = Array.from(inputTokens).filter(token => candidateTokens.has(token)).length;
    const union = new Set([...Array.from(inputTokens), ...Array.from(candidateTokens)]).size || 1;
    score += Math.round((overlap / union) * 80);
    if (candidate.includes(input) || input.includes(candidate)) score += 15;
  }
  if (stateHint) {
    const state = String(row.state_code || row.state_name || '').toLowerCase();
    if (stateHint.toLowerCase() === state || state.includes(stateHint.toLowerCase())) score += 20;
    else score -= 15;
  }
  if (typeHint) {
    if (normalizeType(row.government_type) === typeHint) score += 15;
    else score -= 8;
  }
  return score;
}

function minimumScore(portal: GovernmentPortal, typeHint: string | null) {
  if (portal === 'counties_and_cities' && typeHint) return 65;
  return 75;
}
function canonicalGovernmentName(value: unknown) {
  return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(the|government of)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokenSet(value: string) { return new Set(value.split(' ').filter(token => token.length >= 2 && !STOP_WORDS.has(token))); }
function normalizeType(value: unknown) { return String(value || '').toLowerCase().replace(/\s+/g, '_'); }
function extractTypeHint(value: string, portal: GovernmentPortal) {
  const lower = value.toLowerCase();
  if (/\bcounty\b/.test(lower)) return 'county';
  if (/\b(city|municipality|village|borough)\b/.test(lower)) return 'municipality';
  if (/\btown(ship)?\b/.test(lower)) return 'township';
  if (/\bstate\b/.test(lower) && portal === 'state_agencies') return 'state';
  return null;
}
function extractStateHint(value: string) {
  const match = value.match(/(?:,|\s)\s*([A-Z]{2})\b/);
  if (match?.[1]) return match[1];
  const lower = value.toLowerCase();
  for (const [name, code] of Object.entries(STATE_NAMES)) if (lower.includes(name)) return code;
  return null;
}
function titleCase(value: string) { return value.replace(/\b\w/g, char => char.toUpperCase()); }
const STOP_WORDS = new Set(['of','the','and','government','state','city','county','town','township','municipality']);
const STATE_NAMES: Record<string,string> = {
  alabama:'AL',alaska:'AK',arizona:'AZ',arkansas:'AR',california:'CA',colorado:'CO',connecticut:'CT',delaware:'DE',florida:'FL',georgia:'GA',hawaii:'HI',idaho:'ID',illinois:'IL',indiana:'IN',iowa:'IA',kansas:'KS',kentucky:'KY',louisiana:'LA',maine:'ME',maryland:'MD',massachusetts:'MA',michigan:'MI',minnesota:'MN',mississippi:'MS',missouri:'MO',montana:'MT',nebraska:'NE',nevada:'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND',ohio:'OH',oklahoma:'OK',oregon:'OR',pennsylvania:'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD',tennessee:'TN',texas:'TX',utah:'UT',vermont:'VT',virginia:'VA',washington:'WA','west virginia':'WV',wisconsin:'WI',wyoming:'WY','district of columbia':'DC','puerto rico':'PR',guam:'GU'
};
