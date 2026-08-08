import { NextRequest } from 'next/server';
import { query } from '@/db/client';
import { normalizeJobUrl } from '@/lib/benchmark/benchmarkRules';

export async function GET(req: NextRequest) {
  const entityId = req.nextUrl.searchParams.get('entity_id');
  try {
    const rows = entityId
      ? await query(
          `SELECT t.*,e.name AS entity_name,e.portal::text AS portal
           FROM benchmark_truth_snapshots t JOIN entities e ON e.id=t.entity_id
           WHERE t.entity_id=$1 ORDER BY t.captured_at DESC,t.id DESC LIMIT 50`, [entityId])
      : await query(
          `SELECT t.*,e.name AS entity_name,e.portal::text AS portal
           FROM benchmark_truth_snapshots t JOIN entities e ON e.id=t.entity_id
           ORDER BY t.captured_at DESC,t.id DESC LIMIT 100`);
    return Response.json(rows);
  } catch (error) {
    return Response.json({ error:error instanceof Error?error.message:'Could not load truth snapshots.' }, { status:500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const entityId = clean(body?.entity_id);
    if (!entityId) return Response.json({ error:'entity_id is required.' }, { status:400 });
    const entity = await query(`SELECT id,name,portal::text AS portal FROM entities WHERE id=$1 AND is_active=true LIMIT 1`, [entityId]);
    if (!entity.length) return Response.json({ error:'Tracked entity not found.' }, { status:404 });

    const officialCount = nullableCount(body?.official_job_count);
    const jobUrls = normalizeUrls(body?.job_urls);
    const sampledJobUrls = normalizeUrls(body?.sampled_job_urls);
    if (officialCount === null && !jobUrls.length && !sampledJobUrls.length) {
      return Response.json({ error:'Provide an official job count, complete job_urls, or sampled_job_urls.' }, { status:400 });
    }
    const sourceUrl = normalizeJobUrl(body?.source_url) || clean(body?.source_url);
    const rows = await query(
      `INSERT INTO benchmark_truth_snapshots(entity_id,source_url,source_label,official_job_count,job_urls,sampled_job_urls,captured_by,notes,metadata)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9::jsonb)
       RETURNING *`,
      [entityId,sourceUrl,clean(body?.source_label),officialCount,JSON.stringify(jobUrls),JSON.stringify(sampledJobUrls),clean(body?.captured_by)||'manual',clean(body?.notes),JSON.stringify(body?.metadata||{})],
    );
    return Response.json({ ...rows[0], entity_name:entity[0].name, portal:entity[0].portal }, { status:201 });
  } catch (error) {
    return Response.json({ error:error instanceof Error?error.message:'Could not save truth snapshot.' }, { status:500 });
  }
}

function normalizeUrls(value: unknown) {
  const rows = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n|,/g) : [];
  return Array.from(new Set(rows.map(normalizeJobUrl).filter(Boolean))) as string[];
}
function nullableCount(value: unknown) { if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isInteger(n)&&n>=0?n:null; }
function clean(value: unknown){const text=String(value||'').trim();return text||null;}
