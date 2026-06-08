import { query } from '@/db/client';

export async function getEntityMetrics(entityId: string) {
  // Today's snapshot
  const today = new Date().toISOString().split('T')[0];
  const d7 = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const d60 = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0];
  const d90 = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];

  const [current, snap7, snap30, snap60, snap90] = await Promise.all([
    query(`SELECT COUNT(*) as total FROM jobs WHERE entity_id = $1 AND is_active = true`, [entityId]),
    query(`SELECT COUNT(*) as cnt FROM jobs WHERE entity_id = $1 AND posted_at >= $2`, [entityId, d7]),
    query(`SELECT total_active FROM hiring_snapshots WHERE entity_id = $1 AND snapshot_date = $2`, [entityId, d30]),
    query(`SELECT total_active FROM hiring_snapshots WHERE entity_id = $1 AND snapshot_date = $2`, [entityId, d60]),
    query(`SELECT total_active FROM hiring_snapshots WHERE entity_id = $1 AND snapshot_date = $2`, [entityId, d90]),
  ]);

  const totalNow = Number(current[0]?.total || 0);
  const newThisWeek = Number(snap7[0]?.cnt || 0);
  const total30 = Number(snap30[0]?.total_active || 0);
  const total60 = Number(snap60[0]?.total_active || 0);
  const total90 = Number(snap90[0]?.total_active || 0);

  return {
    totalActive: totalNow,
    newThisWeek,
    trend30: total30 ? Math.round(((totalNow - total30) / total30) * 100) : 0,
    trend60: total60 ? Math.round(((totalNow - total60) / total60) * 100) : 0,
    trend90: total90 ? Math.round(((totalNow - total90) / total90) * 100) : 0,
  };
}

export async function getEntityRoleBreakdown(entityId: string) {
  const rows = await query(
    `SELECT role_category, COUNT(*) as cnt 
     FROM jobs WHERE entity_id = $1 AND is_active = true 
     GROUP BY role_category`,
    [entityId]
  );
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.role_category] = Number(row.cnt);
  }
  return result;
}

export async function getEntityMapData(entityId: string) {
  const rows = await query(
    `SELECT city, state, country, lat, lng, COUNT(*) as cnt
     FROM jobs
     WHERE entity_id = $1 AND is_active = true AND lat IS NOT NULL AND lng IS NOT NULL
     GROUP BY city, state, country, lat, lng`,
    [entityId]
  );
  return rows.map((r: any) => ({
    city: r.city,
    state: r.state,
    country: r.country,
    lat: Number(r.lat),
    lng: Number(r.lng),
    count: Number(r.cnt),
  }));
}
