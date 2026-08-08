import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/client';
import { resolveCompany } from '@/lib/ingest/companyResolver';
import { isGovernmentPortal, resolveGovernmentEntity } from '@/lib/ingest/governmentResolver';
import { governmentRegistryMetadata, registryAliases, resolveGovernmentRegistryMatch } from '@/lib/ingest/governmentRegistry';
import { runUniversalIngest } from '@/lib/ingest/runUniversalIngest';
import { filterVerifiedJobs, isNewThisWeek } from '@/lib/verifiedJobs';

const VALID_PORTALS = new Set(['current_clients','prospects','private_companies','federal_agencies','state_agencies','counties_and_cities']);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const portal = searchParams.get('portal');
    if (portal && !VALID_PORTALS.has(portal)) return NextResponse.json({ error: 'Invalid portal' }, { status: 400 });

    const params: any[] = [];
    let sql = `SELECT * FROM entities WHERE is_active = true`;
    if (portal) { params.push(portal); sql += ` AND portal = $${params.length}`; }
    sql += ` ORDER BY name ASC`;
    const entities = await query(sql, params);
    if (!entities.length) return NextResponse.json([]);

    const ids = entities.map((row: any) => row.id);
    const rawJobs = await query(
      `SELECT id, entity_id, title, department, role_category, location, city, state, country, lat, lng,
              source, external_id, posted_at, created_at, updated_at, is_remote, is_overseas, raw_data
       FROM jobs WHERE is_active = true AND entity_id = ANY($1::uuid[])`,
      [ids],
    );
    const jobs = filterVerifiedJobs(rawJobs);
    const byEntity = new Map<string, any[]>();
    for (const job of jobs) {
      const bucket = byEntity.get(job.entity_id) || [];
      bucket.push(job);
      byEntity.set(job.entity_id, bucket);
    }

    return NextResponse.json(entities.map((entity: any) => {
      const entityJobs = byEntity.get(entity.id) || [];
      return { ...entity, open_jobs: entityJobs.length, new_this_week: entityJobs.filter((job) => isNewThisWeek(job)).length };
    }));
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    const { portal, career_page_url, ats_provider, ats_board_id, industry, category } = body as any;
    const name = String((body as any).name || '').trim();
    const aliases = Array.isArray((body as any).aliases) ? (body as any).aliases.map((alias: unknown) => String(alias).trim()).filter(Boolean) : [];
    const requestedRegistryId = String((body as any).government_registry_id || '').trim();
    if (!name || !portal) return NextResponse.json({ error: 'name and portal required' }, { status: 400 });
    if (!VALID_PORTALS.has(portal)) return NextResponse.json({ error: 'Invalid portal' }, { status: 400 });

    const duplicate = await query(`SELECT * FROM entities WHERE is_active = true AND portal = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2)) LIMIT 1`, [portal, name]);
    if (duplicate.length) return NextResponse.json({ ...duplicate[0], duplicate: true }, { status: 200 });

    let registry: any = null;
    if (portal === 'state_agencies' || portal === 'counties_and_cities') {
      if (requestedRegistryId) {
        const exact = await query(
          `SELECT census_government_id, name, canonical_name, government_type, state_fips, state_code, state_name,
                  county_fips, county_name, place_fips, website, 100 AS score
           FROM government_registry WHERE census_government_id = $1 AND is_active = true LIMIT 1`,
          [requestedRegistryId],
        ).catch(() => []);
        registry = exact[0] || null;
      }
      if (!registry) registry = await resolveGovernmentRegistryMatch(name, portal);
    }
    const registryMeta = governmentRegistryMetadata(registry);
    const registryName = registry?.name || name;

    const needsResolve = !career_page_url || !ats_provider || ats_provider === 'unknown' || !ats_board_id;
    const resolved = needsResolve
      ? isGovernmentPortal(portal)
        ? await resolveGovernmentEntity(registryName, portal, career_page_url || null)
        : await resolveCompany(name, career_page_url || null)
      : null;
    const finalAliases = Array.from(new Set([
      ...aliases,
      ...registryAliases(registry),
      ...(registry && registry.name.toLowerCase() !== name.toLowerCase() ? [name] : []),
      ...(resolved?.aliases || []),
    ]));
    const finalCareerUrl = career_page_url || resolved?.career_page_url || null;
    const finalAtsProvider = ats_provider && ats_provider !== 'unknown' ? ats_provider : resolved?.ats_provider || 'unknown';
    const finalBoardId = ats_board_id || resolved?.ats_board_id || null;

    const rows = await query(
      `INSERT INTO entities (
         name, aliases, portal, career_page_url, ats_provider, ats_board_id, industry, category,
         government_registry_id, government_type, government_state, government_fips
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        name, finalAliases, portal, finalCareerUrl, finalAtsProvider, finalBoardId, industry || null, category || null,
        registryMeta.government_registry_id, registryMeta.government_type, registryMeta.government_state, registryMeta.government_fips,
      ]
    );
    void runUniversalIngest(rows[0].id).catch((error) => console.error(`Background ingest failed for entity ${rows[0].id}:`, error));
    return NextResponse.json({ ...rows[0], resolution: resolved, government_registry: registry }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

function getErrorMessage(error: unknown) { return error instanceof Error ? error.message : 'Unexpected server error'; }
