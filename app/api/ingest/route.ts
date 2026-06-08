import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/client';
import { fetchGreenhouseJobs } from '@/lib/ingest/greenhouse';
import { fetchLeverJobs } from '@/lib/ingest/lever';
import { fetchAdzunaJobs } from '@/lib/ingest/adzuna';
import { fetchUSAJobsPostings } from '@/lib/ingest/usajobs';
import { classifyRole } from '@/lib/roleClassifier';

export async function POST(req: NextRequest) {
  // Validate cron secret
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const entityId = body.entity_id;

  // Get entities to ingest
  let entities: any[];
  if (entityId) {
    entities = await query(`SELECT * FROM entities WHERE id = $1 AND is_active = true`, [entityId]);
  } else {
    entities = await query(`SELECT * FROM entities WHERE is_active = true`);
  }

  const results = [];
  for (const entity of entities) {
    const result = await ingestEntity(entity);
    results.push(result);
    await buildSnapshot(entity.id);
  }

  return NextResponse.json({ ingested: results.length, results });
}

async function ingestEntity(entity: any) {
  const jobs: any[] = [];

  // 1. ATS Sources
  if (entity.ats_provider === 'greenhouse' && entity.ats_board_id) {
    const ghJobs = await fetchGreenhouseJobs(entity.ats_board_id);
    jobs.push(...ghJobs);
  } else if (entity.ats_provider === 'lever' && entity.ats_board_id) {
    const lvJobs = await fetchLeverJobs(entity.ats_board_id);
    jobs.push(...lvJobs);
  }

  // 2. Adzuna (for all entities)
  const { jobs: azJobs } = await fetchAdzunaJobs(entity.name);
  jobs.push(...azJobs);

  // 3. USAJOBS for federal/government portals
  if (['federal_agencies', 'state_agencies', 'city_municipal_agencies'].includes(entity.portal)) {
    const { jobs: usaJobs } = await fetchUSAJobsPostings(entity.name);
    jobs.push(...usaJobs);
  }

  // Upsert jobs
  let newCount = 0;
  for (const job of jobs) {
    if (!job.external_id || !job.source) continue;
    const roleCategory = classifyRole(job.title, job.location);
    
    const existing = await query(
      `SELECT id FROM jobs WHERE entity_id = $1 AND external_id = $2 AND source = $3`,
      [entity.id, String(job.external_id), job.source]
    );

    if (!existing.length) {
      await query(
        `INSERT INTO jobs (entity_id, external_id, source, title, department, role_category, location, city, state, country, lat, lng, is_remote, is_overseas, posted_at, raw_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (entity_id, external_id, source) DO NOTHING`,
        [entity.id, String(job.external_id), job.source, job.title, job.department,
         roleCategory, job.location, job.city, job.state, job.country || 'US',
         job.lat, job.lng, job.is_remote || false, job.is_overseas || false,
         job.posted_at, JSON.stringify(job.raw_data || {})]
      );
      newCount++;
    }
  }

  // Log
  await query(
    `INSERT INTO ingest_log (entity_id, source, status, jobs_found, jobs_new)
     VALUES ($1, 'all', 'success', $2, $3)`,
    [entity.id, jobs.length, newCount]
  );

  return { entity: entity.name, total: jobs.length, new: newCount };
}

async function buildSnapshot(entityId: string) {
  const today = new Date().toISOString().split('T')[0];
  const d7 = new Date(Date.now() - 7 * 86400000).toISOString();

  const [totals, newJobs, roleCounts, closed] = await Promise.all([
    query(`SELECT COUNT(*) as total FROM jobs WHERE entity_id = $1 AND is_active = true`, [entityId]),
    query(`SELECT COUNT(*) as cnt FROM jobs WHERE entity_id = $1 AND posted_at >= $2`, [entityId, d7]),
    query(`SELECT role_category, COUNT(*) as cnt FROM jobs WHERE entity_id = $1 AND is_active = true GROUP BY role_category`, [entityId]),
    query(`SELECT COUNT(*) as cnt FROM jobs WHERE entity_id = $1 AND is_active = false`, [entityId]),
  ]);

  const roleMap: Record<string, number> = {};
  for (const r of roleCounts) roleMap[r.role_category] = Number(r.cnt);

  await query(
    `INSERT INTO hiring_snapshots (entity_id, snapshot_date, total_active, new_this_week, closed_count,
      security_count, logistics_count, medical_count, admin_count, aviation_count,
      engineering_count, remote_count, overseas_count, other_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (entity_id, snapshot_date) DO UPDATE SET
       total_active = EXCLUDED.total_active, new_this_week = EXCLUDED.new_this_week,
       closed_count = EXCLUDED.closed_count`,
    [entityId, today, Number(totals[0]?.total || 0), Number(newJobs[0]?.cnt || 0),
     Number(closed[0]?.cnt || 0),
     roleMap.security || 0, roleMap.logistics || 0, roleMap.medical || 0,
     roleMap.admin || 0, roleMap.aviation || 0, roleMap.engineering || 0,
     roleMap.remote || 0, roleMap.overseas || 0, roleMap.other || 0]
  );
}
