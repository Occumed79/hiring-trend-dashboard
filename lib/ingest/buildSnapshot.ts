import { query } from '@/db/client';

export async function buildHiringSnapshot(entityId: string) {
  const today = new Date().toISOString().split('T')[0];
  const d7 = new Date(Date.now() - 7 * 86400000).toISOString();

  const [totals, newJobs, roleCounts, closed] = await Promise.all([
    query(`SELECT COUNT(*) as total FROM jobs WHERE entity_id = $1 AND is_active = true`, [entityId]),
    query(`SELECT COUNT(*) as cnt FROM jobs WHERE entity_id = $1 AND (posted_at >= $2 OR created_at >= $2)`, [entityId, d7]),
    query(`SELECT role_category, COUNT(*) as cnt FROM jobs WHERE entity_id = $1 AND is_active = true GROUP BY role_category`, [entityId]),
    query(`SELECT COUNT(*) as cnt FROM jobs WHERE entity_id = $1 AND is_active = false`, [entityId]),
  ]);

  const roleMap: Record<string, number> = {};
  for (const row of roleCounts) roleMap[row.role_category] = Number(row.cnt);

  await query(
    `INSERT INTO hiring_snapshots (entity_id, snapshot_date, total_active, new_this_week, closed_count,
      security_count, logistics_count, medical_count, admin_count, aviation_count,
      engineering_count, remote_count, overseas_count, other_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (entity_id, snapshot_date) DO UPDATE SET
       total_active = EXCLUDED.total_active,
       new_this_week = EXCLUDED.new_this_week,
       closed_count = EXCLUDED.closed_count,
       security_count = EXCLUDED.security_count,
       logistics_count = EXCLUDED.logistics_count,
       medical_count = EXCLUDED.medical_count,
       admin_count = EXCLUDED.admin_count,
       aviation_count = EXCLUDED.aviation_count,
       engineering_count = EXCLUDED.engineering_count,
       remote_count = EXCLUDED.remote_count,
       overseas_count = EXCLUDED.overseas_count,
       other_count = EXCLUDED.other_count`,
    [entityId, today,
     Number(totals[0]?.total || 0), Number(newJobs[0]?.cnt || 0), Number(closed[0]?.cnt || 0),
     roleMap.security || 0, roleMap.logistics || 0, roleMap.medical || 0, roleMap.admin || 0,
     roleMap.aviation || 0, roleMap.engineering || 0, roleMap.remote || 0,
     roleMap.overseas || 0, roleMap.other || 0]
  );
}
