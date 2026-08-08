import { query } from '@/db/client';
import type { CoverageCheck } from './neogovFeed';
import { getIngestTimeout } from './http';

const STALE_DAYS = positiveInt(process.env.CONTRACTOR_IDENTITY_STALE_DAYS, 30);

export async function enrichEntityFromContractorIdentity(entity: any): Promise<{ entity: any; checks: CoverageCheck[] }> {
  if (!entity?.id || ['federal_agencies','state_agencies','counties_and_cities'].includes(String(entity?.portal || ''))) {
    return { entity, checks: [] };
  }

  const cached = await readIdentifiers(entity.id);
  const newest = cached.reduce((max, row) => Math.max(max, row.last_verified_at ? new Date(row.last_verified_at).getTime() : 0), 0);
  const stale = !newest || Date.now() - newest > STALE_DAYS * 86400000;
  let checks: CoverageCheck[] = [];
  if (stale) checks = await refreshIdentifiers(entity);

  const identifiers = stale ? await readIdentifiers(entity.id) : cached;
  const aliases = new Set<string>(Array.isArray(entity.aliases) ? entity.aliases.map(String) : []);
  for (const row of identifiers) {
    if (row.canonical_name && safeEquivalentName(entity.name, row.canonical_name)) aliases.add(row.canonical_name);
  }
  return { entity: { ...entity, aliases: Array.from(aliases), identity_identifiers: identifiers }, checks };
}

async function refreshIdentifiers(entity: any): Promise<CoverageCheck[]> {
  const checks: CoverageCheck[] = [];
  const usa = await fetchUsaSpendingIdentity(entity);
  checks.push(usa.check);
  for (const row of usa.identifiers) await persistIdentifier(entity.id, row);

  const sam = await fetchSamIdentity(entity);
  checks.push(sam.check);
  for (const row of sam.identifiers) await persistIdentifier(entity.id, row);
  return checks;
}

async function fetchUsaSpendingIdentity(entity: any): Promise<{ identifiers: Identifier[]; check: CoverageCheck }> {
  const endpoint = process.env.USASPENDING_RECIPIENT_API || 'https://api.usaspending.gov/api/v2/autocomplete/recipient/';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'OccuMedHiringTrendDashboard/1.0' },
      body: JSON.stringify({ search_text: entity.name, limit: 25 }),
      signal: AbortSignal.timeout(getIngestTimeout(12000)),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json().catch(() => null);
    const rows = flattenUsaSpendingCandidates(payload?.results);
    const best = rows.map((row:any)=>({row,score:identityScore(entity,recipientName(row))})).sort((a:any,b:any)=>b.score-a.score)[0];
    if (!best || best.score < 0.82) {
      return { identifiers: [], check: { source:'identity:usaspending', source_class:'verified', status:'zero', jobs_found:0, details:{ purpose:'contractor identity', candidates:rows.length, matched:false } } };
    }
    const name = recipientName(best.row) || entity.name;
    const identifiers: Identifier[] = [];
    identifiers.push({ type:'legal_name', value: comparable(name), canonical_name:name, source:'usaspending', metadata:{ recipient_id:recipientId(best.row), recipient_level:best.row.__recipient_level||null, score:best.score } });
    const uei = firstDefined(best.row,'uei','ueiSAM','recipient_uei','recipientUei','recipient_uei_sam');
    if (uei) identifiers.push({ type:'uei', value:String(uei), canonical_name:name, source:'usaspending', metadata:{ recipient_id:recipientId(best.row), recipient_level:best.row.__recipient_level||null } });
    const id = recipientId(best.row);
    if (id) identifiers.push({ type:'usaspending_recipient_id', value:String(id), canonical_name:name, source:'usaspending', metadata:{ recipient_level:best.row.__recipient_level||null } });
    return { identifiers, check:{ source:'identity:usaspending', source_class:'verified', status:'success', jobs_found:0, details:{ purpose:'contractor identity', matched_name:name, uei:uei||null, recipient_level:best.row.__recipient_level||null, match_score:best.score } } };
  } catch (error) {
    return { identifiers:[], check:{ source:'identity:usaspending', source_class:'verified', status:'error', jobs_found:0, details:{ purpose:'contractor identity', error:message(error) } } };
  }
}

async function fetchSamIdentity(entity: any): Promise<{ identifiers: Identifier[]; check: CoverageCheck }> {
  const apiKey = String(process.env.SAM_API_KEY || process.env.SAM_GOV_API_KEY || '').trim();
  if (!apiKey) return { identifiers:[], check:{ source:'identity:sam', source_class:'authoritative', status:'skipped', jobs_found:0, details:{ purpose:'contractor identity', reason:'SAM public API key not configured' } } };
  try {
    const base = process.env.SAM_ENTITY_API_BASE_URL || 'https://api.sam.gov/entity-information/v4/entities';
    const url = new URL(base);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('legalBusinessName', entity.name);
    url.searchParams.set('registrationStatus', 'A');
    url.searchParams.set('includeSections', 'entityRegistration,coreData');
    const response = await fetch(url.toString(), { headers:{Accept:'application/json','User-Agent':'OccuMedHiringTrendDashboard/1.0'}, signal:AbortSignal.timeout(getIngestTimeout(15000)) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json().catch(() => null);
    const rows = Array.isArray(payload?.entityData) ? payload.entityData : [];
    const ranked = rows.map((row:any)=>({row,name:row?.entityRegistration?.legalBusinessName||'',score:identityScore(entity,row?.entityRegistration?.legalBusinessName)})).sort((a:any,b:any)=>b.score-a.score);
    const best = ranked[0];
    if (!best || best.score < 0.82) return { identifiers:[], check:{source:'identity:sam',source_class:'authoritative',status:'zero',jobs_found:0,details:{purpose:'contractor identity',candidates:rows.length,matched:false}} };
    const registration = best.row?.entityRegistration || {};
    const corporate = best.row?.coreData?.corporateRelationships || best.row?.corporateRelationships || {};
    const highestOwner = corporate?.highestOwner || {};
    const immediateOwner = corporate?.immediateOwner || {};
    const identifiers: Identifier[] = [];
    if (registration.legalBusinessName) identifiers.push({type:'legal_name',value:comparable(registration.legalBusinessName),canonical_name:String(registration.legalBusinessName).trim(),source:'sam',metadata:{score:best.score,registration_status:registration.registrationStatus||null}});
    if (registration.dbaName) identifiers.push({type:'dba_name',value:comparable(registration.dbaName),canonical_name:String(registration.dbaName).trim(),source:'sam',metadata:{score:best.score}});
    if (registration.ueiSAM) identifiers.push({type:'uei',value:String(registration.ueiSAM),canonical_name:String(registration.legalBusinessName||entity.name),source:'sam',metadata:{registration_status:registration.registrationStatus||null}});
    if (registration.cageCode) identifiers.push({type:'cage',value:String(registration.cageCode),canonical_name:String(registration.legalBusinessName||entity.name),source:'sam',metadata:{}});
    for (const owner of [
      { type:'highest_owner', value:highestOwner },
      { type:'immediate_owner', value:immediateOwner },
    ]) {
      if (owner.value?.legalBusinessName) identifiers.push({ type:`${owner.type}_name`, value:comparable(owner.value.legalBusinessName), canonical_name:String(owner.value.legalBusinessName), source:'sam', metadata:{ relationship:owner.type, cage:owner.value.cageCode||null } });
      if (owner.value?.cageCode) identifiers.push({ type:`${owner.type}_cage`, value:String(owner.value.cageCode), canonical_name:owner.value?.legalBusinessName?String(owner.value.legalBusinessName):null, source:'sam', metadata:{ relationship:owner.type } });
    }
    return { identifiers, check:{source:'identity:sam',source_class:'authoritative',status:'success',jobs_found:0,details:{purpose:'contractor identity',matched_name:registration.legalBusinessName||null,dba_name:registration.dbaName||null,uei:registration.ueiSAM||null,cage:registration.cageCode||null,highest_owner:highestOwner?.legalBusinessName||null,immediate_owner:immediateOwner?.legalBusinessName||null,match_score:best.score}} };
  } catch (error) {
    return { identifiers:[], check:{source:'identity:sam',source_class:'authoritative',status:'error',jobs_found:0,details:{purpose:'contractor identity',error:message(error)}} };
  }
}

async function persistIdentifier(entityId:string,row:Identifier) {
  await query(`INSERT INTO entity_identifiers (entity_id,identifier_type,identifier_value,canonical_name,source,metadata,is_active,last_verified_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,true,NOW(),NOW())
    ON CONFLICT (entity_id,identifier_type,identifier_value,source) DO UPDATE SET canonical_name=EXCLUDED.canonical_name,metadata=EXCLUDED.metadata,is_active=true,last_verified_at=NOW(),updated_at=NOW()`,
    [entityId,row.type,row.value,row.canonical_name,row.source,JSON.stringify(row.metadata||{})]);
}
async function readIdentifiers(entityId:string) { try{return await query(`SELECT identifier_type,identifier_value,canonical_name,source,metadata,last_verified_at FROM entity_identifiers WHERE entity_id=$1 AND is_active=true ORDER BY identifier_type,source`,[entityId]);}catch{return [];} }

type Identifier={type:string;value:string;canonical_name:string|null;source:string;metadata:Record<string,any>};
function flattenUsaSpendingCandidates(results:any){if(Array.isArray(results))return results;const out:any[]=[];if(results&&typeof results==='object'){for(const [key,value] of Object.entries(results)){if(Array.isArray(value))for(const row of value)out.push({...row,__recipient_level:key});}}return out;}
function recipientName(row:any){const value=firstDefined(row,'recipient_name','name','legal_business_name','legalBusinessName');return value?String(value).trim():null;}
function recipientId(row:any){return firstDefined(row,'recipient_id','legal_entity_id','id','hash','recipient_hash');}
function identityScore(entity:any,candidate:unknown){const c=comparable(candidate);if(!c)return 0;const names=[entity?.name,...(Array.isArray(entity?.aliases)?entity.aliases:[])].map(comparable).filter(Boolean);let best=0;for(const n of names){if(c===n)best=Math.max(best,1);else if(stripSuffix(c)===stripSuffix(n))best=Math.max(best,.96);else{const overlap=tokenOverlap(c,n);if((c.includes(n)||n.includes(c))&&Math.min(c.length,n.length)>=6)best=Math.max(best,.88);best=Math.max(best,overlap*.9);}}return best;}
function safeEquivalentName(base:unknown,candidate:unknown){const a=comparable(base),b=comparable(candidate);if(!a||!b)return false;return a===b||stripSuffix(a)===stripSuffix(b)||((a.includes(b)||b.includes(a))&&Math.min(a.length,b.length)>=8&&tokenOverlap(a,b)>=.75);}
function stripSuffix(value:string){return value.replace(/\b(?:inc|incorporated|llc|ltd|limited|corp|corporation|company|co|holdings|group|lp|plc)\b/g,' ').replace(/\s+/g,' ').trim();}
function tokenOverlap(a:string,b:string){const aa=new Set(stripSuffix(a).split(' ').filter(t=>t.length>2));const bb=new Set(stripSuffix(b).split(' ').filter(t=>t.length>2));if(!aa.size||!bb.size)return 0;let common=0;aa.forEach(t=>{if(bb.has(t))common++;});return common/Math.min(aa.size,bb.size);}
function comparable(value:unknown){return String(value||'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();}
function firstDefined(obj:any,...paths:string[]){for(const path of paths){let value=obj;for(const part of path.split('.'))value=value?.[part];if(value!==undefined&&value!==null&&String(value).trim())return value;}return null;}
function positiveInt(value:unknown,fallback:number){const n=Number(value);return Number.isFinite(n)&&n>0?Math.floor(n):fallback;}
function message(error:unknown){return error instanceof Error?error.message:String(error);}
