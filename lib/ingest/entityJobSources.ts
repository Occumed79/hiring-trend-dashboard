import { query } from '@/db/client';
import { readDirectoryEntriesForEntity, type DirectoryEntry } from './sourceDirectories';
import { discoverHiringSurfaces, type DiscoveredHiringSource } from './sourceDiscovery';
import { fetchJobsForConfiguredSource, type ConfiguredJobSource } from './connectorRegistry';
import { fetchSitemapJobs } from './sitemapJobs';
import { filterAllJobsForEntityEvidence } from './jobIdentity';
import type { CoverageCheck } from './neogovFeed';

export type EntityJobSource = ConfiguredJobSource & {
  source_class: 'authoritative' | 'verified' | 'supplemental';
  lineage_root: string;
  state_code?: string | null;
  discovery_method?: string | null;
  is_verified?: boolean;
  metadata?: Record<string, any>;
  last_verified_at?: string | null;
  last_seen_at?: string | null;
};

const DISCOVERY_STALE_DAYS = positiveInt(process.env.SOURCE_DISCOVERY_STALE_DAYS, 14);
const SOURCE_CONCURRENCY = clamp(positiveInt(process.env.ENTITY_SOURCE_CONCURRENCY, 4), 1, 8);
const DISCOVERY_MARKER_KEY = 'discovery:surface-scan';

export async function prepareEntityJobSources(entity: any, detected?: any | null): Promise<EntityJobSource[]> {
  if (!entity?.id) return [];
  const existingBeforeSeeds = await readEntityJobSources(entity.id);
  const runDiscovery = shouldDiscover(existingBeforeSeeds);
  const seeds: EntityJobSource[] = [];

  const primary = sourceFromEntity(entity, 'stored-primary');
  if (primary) seeds.push(primary);
  const detectedSource = detected ? sourceFromEntity({ ...entity, career_page_url: detected.career_page_url, ats_provider: detected.ats_provider, ats_board_id: detected.ats_board_id }, 'resolver-detected') : null;
  if (detectedSource) seeds.push(detectedSource);

  const directory = await readDirectoryEntriesForEntity(entity);
  for (const entry of directory) {
    const source = sourceFromDirectory(entry, entity);
    if (source) seeds.push(source);
  }

  for (const source of dedupeSources(seeds)) await upsertEntitySource(entity.id, source);

  if (runDiscovery) {
    const discoverySeeds = [
      entity,
      ...directory.filter(row => row.jobs_url).slice(0, 6).map(row => ({ ...entity, career_page_url: row.jobs_url })),
    ];
    for (const seed of discoverySeeds) {
      const discovered = await discoverHiringSurfaces(seed).catch(() => []);
      for (const source of discovered) await upsertEntitySource(entity.id, source);
    }
    await upsertEntitySource(entity.id, discoveryMarker());
  }

  return readEntityJobSources(entity.id);
}

export async function fetchEntitySourceGraphJobs(entity: any, sources?: EntityJobSource[]): Promise<{ jobs: any[]; checks: CoverageCheck[]; used: string[]; skipped: string[]; offTargetRejected: number }> {
  const rows = sources || await readEntityJobSources(entity.id);
  const candidates = rows.filter(row => row.source_type !== 'identity' && !sameAsPrimary(row, entity));
  const results = await mapWithConcurrency(candidates, SOURCE_CONCURRENCY, source => fetchOne(entity, source));
  return {
    jobs: results.flatMap(result => result.jobs),
    checks: results.map(result => result.check),
    used: Array.from(new Set(results.flatMap(result => result.used))),
    skipped: Array.from(new Set(results.flatMap(result => result.skipped))),
    offTargetRejected: results.reduce((sum, result) => sum + result.offTargetRejected, 0),
  };
}

export async function readEntityJobSources(entityId: string): Promise<EntityJobSource[]> {
  try {
    return await query(
      `SELECT source_key, source_type, source_class, lineage_root, source_url, ats_provider, board_id,
              state_code, discovery_method, is_verified, metadata, last_verified_at, last_seen_at
       FROM entity_job_sources
       WHERE entity_id = $1 AND is_active = true
       ORDER BY CASE source_class WHEN 'authoritative' THEN 1 WHEN 'verified' THEN 2 ELSE 3 END,
                source_key`,
      [entityId],
    ) as EntityJobSource[];
  } catch {
    return [];
  }
}

async function fetchOne(entity: any, source: EntityJobSource) {
  try {
    let jobs: any[] = [];
    let used: string[] = [];
    let skipped: string[] = [];
    if (source.source_type === 'sitemap' && source.source_url) {
      jobs = await fetchSitemapJobs(source.source_url, entity.name);
      if (jobs.length) used = [source.source_key]; else skipped = [`${source.source_key} (0 structured JobPosting rows)`];
    } else {
      const result = await fetchJobsForConfiguredSource(entity, source);
      jobs = result.jobs; used = result.used; skipped = result.skipped;
    }

    const shared = source.metadata?.shared_inventory === true;
    const requiresEmployerVerification = shared || !source.is_verified;
    let rejected = 0;
    if (requiresEmployerVerification && jobs.length) {
      const filtered = filterAllJobsForEntityEvidence(jobs, entity);
      jobs = filtered.jobs;
      rejected = filtered.rejected;
      if (rejected) skipped.push(`${source.source_key} (${rejected} off-target or unverified rows rejected)`);
    }

    jobs = jobs.map(job => ({
      ...job,
      raw_data: {
        ...(job.raw_data || {}),
        source_graph_key: source.source_key,
        source_graph_lineage: source.lineage_root,
        source_graph_class: source.source_class,
        source_graph_verified_for_entity: Boolean(source.is_verified || source.source_class === 'authoritative' || requiresEmployerVerification),
        source_graph_shared_inventory: shared,
        source_graph_required_employer_verification: requiresEmployerVerification,
      },
    }));

    const success = jobs.length > 0;
    await markSourceChecked(entity.id, source.source_key, success);
    return {
      jobs,
      used,
      skipped,
      offTargetRejected: rejected,
      check: {
        source: source.source_key,
        source_class: source.source_class,
        status: success ? 'success' : 'zero',
        jobs_found: jobs.length,
        authoritative_zero: false,
        details: {
          source_key: source.source_key,
          lineage_root: source.lineage_root,
          source_url: source.source_url || null,
          source_type: source.source_type,
          ats_provider: source.ats_provider || null,
          organization_name: source.metadata?.organization_name || null,
          shared_inventory: shared,
          employer_verification_required: requiresEmployerVerification,
          off_target_rejected: rejected,
        },
      } as CoverageCheck,
    };
  } catch (error) {
    await markSourceChecked(entity.id, source.source_key, false).catch(() => {});
    return {
      jobs: [], used: [], skipped: [`${source.source_key} (${message(error)})`], offTargetRejected: 0,
      check: {
        source: source.source_key,
        source_class: source.source_class,
        status: 'error',
        jobs_found: 0,
        authoritative_zero: false,
        details: { source_key: source.source_key, lineage_root: source.lineage_root, source_url: source.source_url || null, source_type: source.source_type, error: message(error) },
      } as CoverageCheck,
    };
  }
}

async function upsertEntitySource(entityId: string, source: EntityJobSource | DiscoveredHiringSource) {
  await query(
    `INSERT INTO entity_job_sources (
       entity_id, source_key, source_type, source_class, lineage_root, source_url, ats_provider, board_id,
       state_code, discovery_method, is_verified, metadata, is_active, last_seen_at, last_verified_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,true,NOW(),CASE WHEN $11 THEN NOW() ELSE NULL END,NOW())
     ON CONFLICT (entity_id, source_key) DO UPDATE SET
       source_type=EXCLUDED.source_type,
       source_class=CASE WHEN entity_job_sources.source_class='authoritative' THEN 'authoritative' ELSE EXCLUDED.source_class END,
       lineage_root=EXCLUDED.lineage_root,
       source_url=COALESCE(EXCLUDED.source_url,entity_job_sources.source_url),
       ats_provider=COALESCE(EXCLUDED.ats_provider,entity_job_sources.ats_provider),
       board_id=COALESCE(EXCLUDED.board_id,entity_job_sources.board_id),
       state_code=COALESCE(EXCLUDED.state_code,entity_job_sources.state_code),
       discovery_method=COALESCE(EXCLUDED.discovery_method,entity_job_sources.discovery_method),
       is_verified=entity_job_sources.is_verified OR EXCLUDED.is_verified,
       metadata=entity_job_sources.metadata || EXCLUDED.metadata,
       is_active=true,last_seen_at=NOW(),
       last_verified_at=CASE WHEN EXCLUDED.is_verified THEN NOW() ELSE entity_job_sources.last_verified_at END,
       updated_at=NOW()`,
    [entityId,source.source_key,source.source_type,source.source_class,source.lineage_root,source.source_url||null,source.ats_provider||null,source.board_id||null,(source as any).state_code||null,(source as any).discovery_method||null,Boolean((source as any).is_verified || source.source_class==='authoritative'),JSON.stringify(source.metadata||{})],
  ).catch(() => {});
}

function discoveryMarker(): EntityJobSource {
  return {
    source_key: DISCOVERY_MARKER_KEY,
    source_type: 'identity',
    source_class: 'supplemental',
    lineage_root: 'coverage:source-discovery',
    source_url: null,
    ats_provider: null,
    board_id: null,
    discovery_method: 'surface-scan',
    is_verified: true,
    metadata: { last_scan_at: new Date().toISOString(), purpose: 'source discovery freshness marker' },
  };
}
function sourceFromEntity(entity:any,method:string):EntityJobSource|null {
  const url=normalizeUrl(entity?.career_page_url); const provider=clean(entity?.ats_provider); const board=clean(entity?.ats_board_id);
  if(!url&&!provider&&!board)return null;
  const key=`primary:${provider||'career'}:${hashString(`${provider||''}|${board||''}|${url||''}`)}`;
  return {source_key:key,source_type:provider&&provider!=='unknown'&&provider!=='other'?'ats':'career_page',source_class:'authoritative',lineage_root:provider&&board?`ats:${provider}:${board}`:`official-domain:${hostKey(url)}`,source_url:url,ats_provider:provider&&provider!=='unknown'?provider:null,board_id:board,state_code:entity?.government_state||null,discovery_method:method,is_verified:true,metadata:{primary:true,shared_inventory:false,organization_name:entity?.name||null}};
}
function sourceFromDirectory(entry:DirectoryEntry,entity:any):EntityJobSource|null {
  const association = entry.entry_type==='municipal_league' || entry.entry_type==='county_association';
  const chosen = association ? entry.jobs_url : (entry.jobs_url || entry.source_url);
  const url=normalizeUrl(chosen); if(!url)return null;
  const shared = Boolean(entry.metadata?.shared_inventory)
    || association
    || entry.entry_type==='state_jobs'
    || (entry.entry_type==='federal_exception' && entry.lineage_root==='intelligence-community');
  return {source_key:`directory:${entry.directory_key}:${entry.entry_key}`,source_type:'career_page',source_class:entry.source_class,lineage_root:entry.lineage_root,source_url:url,ats_provider:null,board_id:null,state_code:entry.state_code,discovery_method:`directory:${entry.directory_key}`,is_verified:true,metadata:{directory_key:entry.directory_key,entry_key:entry.entry_key,entry_type:entry.entry_type,organization_name:entry.organization_name,shared_inventory:shared,...(entry.metadata||{})}};
}
function shouldDiscover(rows:EntityJobSource[]){const marker=rows.find(row=>row.source_key===DISCOVERY_MARKER_KEY);const scannedAt=marker?.metadata?.last_scan_at?new Date(marker.metadata.last_scan_at).getTime():0;return !scannedAt||!Number.isFinite(scannedAt)||Date.now()-scannedAt>DISCOVERY_STALE_DAYS*86400000;}
function sameAsPrimary(source:EntityJobSource,entity:any){const provider=clean(entity?.ats_provider),board=clean(entity?.ats_board_id),url=normalizeUrl(entity?.career_page_url);if(provider&&board&&clean(source.ats_provider)===provider&&clean(source.board_id)===board)return true;if(url&&source.source_url&&normalizeUrl(source.source_url)===url&&source.metadata?.primary===true)return true;return false;}
async function markSourceChecked(entityId:string,key:string,success:boolean){await query(`UPDATE entity_job_sources SET last_seen_at=NOW(),last_verified_at=CASE WHEN $3 THEN NOW() ELSE last_verified_at END,updated_at=NOW() WHERE entity_id=$1 AND source_key=$2`,[entityId,key,success]);}
function dedupeSources<T extends {source_key:string}>(rows:T[]){const seen=new Set<string>();return rows.filter(row=>{if(seen.has(row.source_key))return false;seen.add(row.source_key);return true;});}
function normalizeUrl(value:unknown){try{const url=new URL(String(value||'').trim());url.hash='';return ['http:','https:'].includes(url.protocol)?url.toString():null;}catch{return null;}}
function hostKey(value:string|null){try{return new URL(value||'').hostname.toLowerCase().replace(/^www\./,'');}catch{return 'unknown';}}
function clean(value:unknown){const text=String(value||'').trim().toLowerCase();return text||null;}
function hashString(value:string){let hash=2166136261;for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(36);}
function positiveInt(value:unknown,fallback:number){const n=Number(value);return Number.isFinite(n)&&n>0?Math.floor(n):fallback;}
function clamp(value:number,min:number,max:number){return Math.max(min,Math.min(max,value));}
function message(error:unknown){return error instanceof Error?error.message:String(error);}
async function mapWithConcurrency<T,R>(items:T[],limit:number,worker:(item:T)=>Promise<R>):Promise<R[]>{if(!items.length)return[];const results=new Array<R>(items.length);let next=0;async function run(){while(true){const i=next++;if(i>=items.length)return;results[i]=await worker(items[i]);}}await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>run()));return results;}