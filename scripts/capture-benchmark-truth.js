try { const dotenv=require('dotenv'); dotenv.config({path:'.env.local'}); dotenv.config(); } catch(err){ if(err?.code!=='MODULE_NOT_FOUND')throw err; }
const {Client}=require('pg');
const {auditOfficialSource}=require('../lib/benchmark/officialSourceAuditor');

const COHORT_KEY=String(process.env.BENCHMARK_COHORT_KEY||'default').trim()||'default';
const CONCURRENCY=clampInt(process.env.BENCHMARK_AUDIT_CONCURRENCY,4,1,8);
const AUDIT_RETENTION_DAYS=clampInt(process.env.BENCHMARK_AUDIT_RETENTION_DAYS,90,7,3650);

async function main(){
  const connectionString=process.env.DATABASE_URL;if(!connectionString)throw new Error('DATABASE_URL is required.');
  const client=new Client({connectionString,ssl:connectionString.includes('sslmode=require')?{rejectUnauthorized:false}:undefined});await client.connect();
  try{
    const entities=await client.query(`SELECT e.id,e.name,e.portal::text AS portal,e.ats_provider,e.ats_board_id,e.career_page_url,e.aliases FROM benchmark_cohort_members m JOIN entities e ON e.id=m.entity_id WHERE m.cohort_key=$1 AND m.is_active=true AND e.is_active=true ORDER BY e.portal,e.name`,[COHORT_KEY]);
    let truthCreated=0,audited=0,unsupported=0,failed=0;
    await mapWithConcurrency(entities.rows,CONCURRENCY,async entity=>{
      const sources=await readSources(client,entity);
      const collapsed=collapseSources(sources);
      if(!collapsed.length){unsupported++;return;}
      const results=[];
      for(const source of collapsed){
        const result=await auditOfficialSource(entity,source);results.push({source,result});audited++;
        if(result.status==='unsupported')unsupported++;if(result.status==='error')failed++;
        await persistAudit(client,entity.id,source,result);
      }
      const eligible=results.filter(({result})=>result.complete&&result.officialCount!==null);
      if(!eligible.length)return;
      const allSourcesAudited=eligible.length===collapsed.length;
      const allUrlComplete=allSourcesAudited&&eligible.every(({result})=>result.officialCount===0||result.jobUrls.length===result.officialCount);
      if(allUrlComplete){
        const urls=Array.from(new Set(eligible.flatMap(({result})=>result.jobUrls)));
        await saveTruth(client,entity,eligible,urls.length,urls,'auto-official-auditor','Independent complete URL inventories from all dedicated authoritative source nodes.');truthCreated++;return;
      }
      if(collapsed.length===1&&eligible.length===1){
        const result=eligible[0].result;
        await saveTruth(client,entity,eligible,result.officialCount,[],'auto-official-auditor-count','Independent complete official inventory count; posting-level precision/recall not claimed.');truthCreated++;
      }
    });
    await client.query(`DELETE FROM benchmark_source_audits WHERE audited_at < NOW() - ($1::int * INTERVAL '1 day')`,[AUDIT_RETENTION_DAYS]).catch(()=>{});
    console.log(`Official benchmark audit complete: ${audited} sources audited, ${truthCreated} fresh truth snapshots, ${unsupported} unsupported, ${failed} errors.`);
  }finally{await client.end();}
}

async function readSources(client,entity){
  const rows=await client.query(`SELECT source_key,source_type,source_class,lineage_root,source_url,ats_provider,board_id,is_verified,metadata,last_verified_at FROM entity_job_sources WHERE entity_id=$1 AND is_active=true AND source_class='authoritative' AND source_type IN ('ats','career_page') AND (is_verified=true OR metadata->>'primary'='true') ORDER BY (metadata->>'primary'='true') DESC,last_verified_at DESC NULLS LAST,source_key`,[entity.id]);
  if(rows.rows.length)return rows.rows;
  if(entity.career_page_url||entity.ats_provider||entity.ats_board_id)return[{source_key:'synthetic-primary',source_type:'ats',source_class:'authoritative',lineage_root:`ats:${entity.ats_provider||'career'}:${entity.ats_board_id||entity.id}`,source_url:entity.career_page_url,ats_provider:entity.ats_provider,board_id:entity.ats_board_id,is_verified:true,metadata:{primary:true,shared_inventory:false}}];
  return[];
}
function collapseSources(rows){const map=new Map();for(const row of rows){if(row?.metadata?.shared_inventory===true)continue;const key=String(row.lineage_root||`${row.ats_provider||''}|${row.board_id||''}|${row.source_url||''}`);const current=map.get(key);if(!current||score(row)>score(current))map.set(key,row);}return Array.from(map.values());}
function score(row){return(row?.metadata?.primary===true?10:0)+(row?.is_verified?4:0)+(row?.board_id?2:0)+(row?.source_url?1:0);}
async function persistAudit(client,entityId,source,result){const truthEligible=Boolean(result.complete&&result.officialCount!==null);await client.query(`INSERT INTO benchmark_source_audits(entity_id,source_key,source_label,source_url,ats_provider,status,complete,official_job_count,job_urls,truth_eligible,details,audited_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,NOW())`,[entityId,source.source_key,result.sourceLabel||null,result.sourceUrl||source.source_url||null,source.ats_provider||null,result.status,Boolean(result.complete),result.officialCount,JSON.stringify(result.jobUrls||[]),truthEligible,JSON.stringify({...result.metadata,lineage_root:source.lineage_root})]);}
async function saveTruth(client,entity,eligible,count,urls,capturedBy,notes){const sources=eligible.map(({source,result})=>({source_key:source.source_key,lineage_root:source.lineage_root,ats_provider:source.ats_provider||null,source_url:result.sourceUrl||source.source_url||null,official_count:result.officialCount}));const primary=eligible[0]?.result;await client.query(`INSERT INTO benchmark_truth_snapshots(entity_id,source_url,source_label,official_job_count,job_urls,sampled_job_urls,captured_by,notes,metadata) VALUES($1,$2,$3,$4,$5::jsonb,'[]'::jsonb,$6,$7,$8::jsonb)`,[entity.id,primary?.sourceUrl||entity.career_page_url||null,eligible.length===1?primary?.sourceLabel||'Independent official auditor':`${eligible.length} independent official inventories`,count,JSON.stringify(urls),capturedBy,notes,JSON.stringify({automatic:true,portal:entity.portal,sources,complete_url_truth:urls.length===count})]);}
async function mapWithConcurrency(items,limit,worker){let next=0;async function run(){while(true){const i=next++;if(i>=items.length)return;await worker(items[i]);}}await Promise.all(Array.from({length:Math.min(limit,items.length||1)},()=>run()));}
function clampInt(value,fallback,min,max){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):fallback;}
main().catch(error=>{console.error('Official benchmark truth capture failed:',error);process.exitCode=1;});
