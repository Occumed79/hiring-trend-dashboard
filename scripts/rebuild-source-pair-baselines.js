try {
  const dotenv = require('dotenv');
  dotenv.config({ path: '.env.local' });
  dotenv.config();
} catch (err) { if (err?.code !== 'MODULE_NOT_FOUND') throw err; }

const { Client } = require('pg');
const WINDOW_DAYS = clampInt(process.env.SOURCE_PAIR_BASELINE_DAYS, 30, 7, 180);
const MIN_SAMPLES = clampInt(process.env.SOURCE_PAIR_MIN_SAMPLES, 5, 2, 100);

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const client = new Client({ connectionString, ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized:false } : undefined });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT DISTINCT ON (entity_id, date_trunc('day',checked_at), source)
              entity_id, date_trunc('day',checked_at) AS day, source, lineage_root, jobs_found, checked_at
       FROM entity_source_coverage_history
       WHERE checked_at >= NOW() - ($1::int * INTERVAL '1 day')
         AND status IN ('success','zero')
         AND source_class IN ('authoritative','verified')
         AND source NOT LIKE 'identity:%'
         AND source NOT LIKE 'registry:%'
         AND source NOT LIKE 'coverage:%'
         AND source <> 'web:langsearch'
       ORDER BY entity_id, date_trunc('day',checked_at), source, checked_at DESC`,
      [WINDOW_DAYS],
    );
    const groups = new Map();
    for (const row of result.rows) {
      const key = `${row.entity_id}|${new Date(row.day).toISOString().slice(0,10)}`;
      const list = groups.get(key) || [];
      list.push(row); groups.set(key,list);
    }

    const observations = new Map();
    for (const rows of groups.values()) {
      const byLineage = collapseLineages(rows);
      for (let i=0;i<byLineage.length;i++) for (let j=i+1;j<byLineage.length;j++) {
        let left=byLineage[i], right=byLineage[j];
        if (String(left.source).localeCompare(String(right.source)) > 0) [left,right]=[right,left];
        const a=Math.max(0,Number(left.jobs_found||0)), b=Math.max(0,Number(right.jobs_found||0));
        if (a===0 && b===0) continue;
        const key=`${left.source}|${right.source}`;
        const list=observations.get(key)||[];
        list.push({ ratio: b === 0 ? null : a / b, symmetricRatio: Math.min(a,b)/Math.max(a,b), delta:Math.abs(a-b) });
        observations.set(key,list);
      }
    }

    let persisted=0;
    for (const [key,rows] of observations) {
      if (rows.length < MIN_SAMPLES) continue;
      const [sourceA,sourceB]=key.split('|');
      const directional=rows.map(row=>row.ratio).filter(Number.isFinite).sort((a,b)=>a-b);
      const symmetric=rows.map(row=>row.symmetricRatio).filter(Number.isFinite).sort((a,b)=>a-b);
      const deltas=rows.map(row=>row.delta).sort((a,b)=>a-b);
      await client.query(
        `INSERT INTO source_pair_baselines(source_a,source_b,sample_count,median_ratio,p10_ratio,p90_ratio,median_abs_delta,window_days,metadata,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW())
         ON CONFLICT (source_a,source_b) DO UPDATE SET
           sample_count=EXCLUDED.sample_count,median_ratio=EXCLUDED.median_ratio,p10_ratio=EXCLUDED.p10_ratio,
           p90_ratio=EXCLUDED.p90_ratio,median_abs_delta=EXCLUDED.median_abs_delta,window_days=EXCLUDED.window_days,
           metadata=EXCLUDED.metadata,updated_at=NOW()`,
        [sourceA,sourceB,rows.length,percentile(directional,0.5),percentile(directional,0.1),percentile(directional,0.9),percentile(deltas,0.5),WINDOW_DAYS,
         JSON.stringify({ symmetric_median:percentile(symmetric,0.5), symmetric_p10:percentile(symmetric,0.1), symmetric_p90:percentile(symmetric,0.9) })],
      );
      persisted++;
    }
    console.log(`Source-pair baseline rebuild complete: ${persisted} pairs from ${result.rows.length} healthy daily observations.`);
  } finally { await client.end(); }
}

function collapseLineages(rows){const map=new Map();for(const row of rows){const lineage=normalizeLineage(row.lineage_root||row.source);const current=map.get(lineage);if(!current||Number(row.jobs_found||0)>Number(current.jobs_found||0))map.set(lineage,row);}return Array.from(map.values());}
function normalizeLineage(value){const raw=String(value||'').toLowerCase();if(raw==='careeronestop' || raw.includes('nlx_mirror'))return'nlx';return raw;}
function percentile(values,p){if(!values.length)return null;const index=(values.length-1)*p;const lower=Math.floor(index),upper=Math.ceil(index);if(lower===upper)return round(values[lower]);const weight=index-lower;return round(values[lower]*(1-weight)+values[upper]*weight);}
function round(value){return Number.isFinite(value)?Math.round(value*1e6)/1e6:null;}
function clampInt(value,fallback,min,max){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):fallback;}

main().catch(error=>{console.error('Source-pair baseline rebuild failed:',error);process.exitCode=1;});
