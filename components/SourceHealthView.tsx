'use client';
import { useEffect, useMemo, useState } from 'react';

export default function SourceHealthView() {
  const [data,setData]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  const [truth,setTruth]=useState({entity_id:'',source_url:'',official_job_count:'',job_urls:''});

  async function load() {
    setLoading(true); setError('');
    try {
      const res=await fetch('/api/source-health');
      const body=await res.json().catch(()=>null);
      if(!res.ok)throw new Error(body?.error||'Could not load source health.');
      setData(body);
    } catch(err){setError(err instanceof Error?err.message:'Could not load source health.');}
    finally{setLoading(false);}
  }
  useEffect(()=>{load().catch(()=>{});},[]);

  async function saveTruth() {
    if(!truth.entity_id)return;
    setSaving(true);setError('');
    try{
      const res=await fetch('/api/benchmarks/truth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        entity_id:truth.entity_id,source_url:truth.source_url||null,
        official_job_count:truth.official_job_count===''?null:Number(truth.official_job_count),
        job_urls:truth.job_urls.split(/\r?\n/g).map(v=>v.trim()).filter(Boolean),captured_by:'source-health-console',
      })});
      const body=await res.json().catch(()=>null);if(!res.ok)throw new Error(body?.error||'Could not save truth snapshot.');
      setTruth({entity_id:'',source_url:'',official_job_count:'',job_urls:''});
      await load();
    }catch(err){setError(err instanceof Error?err.message:'Could not save truth snapshot.');}
    finally{setSaving(false);}
  }

  const summary=data?.summary||{};
  const releases=Array.isArray(data?.portal_releases)?data.portal_releases:[];
  const sources=Array.isArray(data?.source_fleet)?data.source_fleet:[];
  const incidents=Array.isArray(data?.incidents)?data.incidents:[];
  const pairs=Array.isArray(data?.source_pair_baselines)?data.source_pair_baselines:[];
  const audits=Array.isArray(data?.official_audits)?data.official_audits:[];
  const truthCandidates=Array.isArray(data?.truth_candidates)?data.truth_candidates:[];
  const latest=data?.latest_benchmark_run;
  const highIncidents=incidents.filter((row:any)=>['critical','high'].includes(String(row.severity||'').toLowerCase())).length;
  const sourceHealth=useMemo(()=>{
    const total=sources.reduce((sum:number,row:any)=>sum+Number(row.entities||0),0);
    const healthy=sources.reduce((sum:number,row:any)=>sum+Number(row.healthy||0),0);
    return total?Math.round(healthy/total*100):0;
  },[sources]);

  return <div className="min-h-full p-5 lg:p-6 space-y-5 max-w-[1650px] mx-auto">
    <section className="glass-card-hero luminous-panel relative overflow-hidden p-5 lg:p-6">
      <div className="shimmer-top"/><div className="aurora-sweep"/>
      <div className="relative z-10 flex items-start justify-between gap-5 flex-wrap">
        <div><p className="text-[10px] uppercase tracking-[0.17em] text-blue-300/65">Validation & reliability</p><h1 className="mt-1 text-[28px] font-semibold tracking-tight text-white">Source Health</h1><p className="mt-2 max-w-3xl text-[11px] leading-relaxed text-slate-500">Fleet-wide connector health, source incidents, independent official-source audits, learned disagreement baselines, benchmark evidence and portal release gates. Parity and independently verified ground truth are reported separately.</p></div>
        <button onClick={()=>load()} disabled={loading} className="px-4 py-2.5 rounded-xl border border-blue-400/30 bg-blue-500/10 text-xs text-blue-100 hover:bg-blue-500/20 disabled:opacity-50">{loading?'Refreshing…':'Refresh diagnostics'}</button>
      </div>
      <div className="relative z-10 grid grid-cols-2 lg:grid-cols-6 gap-3 mt-5">
        <Metric label="Tracked entities" value={summary.active_entities}/><Metric label="Source checks" value={summary.latest_source_checks}/><Metric label="Fleet health" value={`${sourceHealth}%`}/><Metric label="Open incidents" value={summary.open_incidents} warn={highIncidents>0}/><Metric label="Independent audits" value={summary.independently_audited_entities}/><Metric label="Truth-backed entities" value={summary.truth_entities}/>
      </div>
    </section>

    {error&&<div className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>}

    <section className="glass-card luminous-panel p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4"><div><h2 className="text-[15px] font-semibold text-slate-100">Portal Release Gates</h2><p className="mt-1 text-[10px] text-slate-600">A portal cannot pass on source parity alone; independent truth evidence is mandatory.</p></div>{latest&&<div className="text-right"><p className="text-[9px] uppercase tracking-[0.12em] text-slate-600">Latest benchmark</p><p className="mt-1 text-[10px] text-slate-400">#{latest.id} · {latest.status} · {formatTime(latest.completed_at||latest.started_at)}</p></div>}</div>
      {loading?<Skeleton/>:releases.length?<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{releases.map((row:any)=><ReleaseCard key={row.portal_id} row={row}/>)}</div>:<Empty text="No release assessment yet. The scheduled benchmark will populate this after deployment."/>}
    </section>

    <div className="grid grid-cols-1 2xl:grid-cols-[1.1fr_0.9fr] gap-5">
      <section className="glass-card luminous-panel p-5 min-w-0"><SectionTitle title="Source Fleet" detail={`${sources.length} source families`}/>{loading?<Skeleton/>:<div className="overflow-x-auto"><table className="w-full text-left text-[10px]"><thead><tr className="text-slate-600 border-b border-white/8"><Th>Source</Th><Th>Entities</Th><Th>Healthy</Th><Th>Errors</Th><Th>Jobs</Th><Th>Oldest check</Th></tr></thead><tbody>{sources.slice(0,40).map((row:any)=><tr key={row.source} className="border-b border-white/[0.045] text-slate-400"><Td strong>{label(row.source)}</Td><Td>{row.entities}</Td><Td>{pct(Number(row.healthy||0),Number(row.entities||0))}</Td><Td warn={Number(row.errors||0)>0}>{row.errors}</Td><Td>{Number(row.jobs_reported||0).toLocaleString()}</Td><Td>{formatTime(row.oldest_checked_at)}</Td></tr>)}</tbody></table></div>}</section>
      <section className="glass-card luminous-panel p-5 min-w-0"><SectionTitle title="Open Reliability Incidents" detail={`${incidents.length} open · ${highIncidents} high/critical`}/>{loading?<Skeleton/>:incidents.length?<div className="space-y-2 max-h-[430px] overflow-y-auto scrollbar-glass pr-1">{incidents.slice(0,75).map((row:any)=><div key={`${row.entity_id}-${row.incident_key}`} className="rounded-xl border border-white/8 bg-white/[0.025] px-3.5 py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[11px] font-medium text-slate-200 truncate">{row.entity_name}</p><p className="mt-1 text-[9px] text-slate-600">{portalLabel(row.portal)} · {row.source?label(row.source):label(row.kind)}</p></div><Status value={row.severity}/></div><p className="mt-2 text-[10px] leading-relaxed text-slate-500">{row.message}</p></div>)}</div>:<Empty text="No open source reliability incidents."/>}</section>
    </div>

    <section className="glass-card luminous-panel p-5"><SectionTitle title="Independent Official-Source Audits" detail={`${audits.length} latest source audits`}/>{loading?<Skeleton/>:audits.length?<div className="overflow-x-auto"><table className="w-full text-left text-[10px]"><thead><tr className="text-slate-600 border-b border-white/8"><Th>Entity</Th><Th>Portal</Th><Th>Official source</Th><Th>Status</Th><Th>Official jobs</Th><Th>Truth eligible</Th><Th>Audited</Th></tr></thead><tbody>{audits.slice(0,75).map((row:any)=><tr key={`${row.entity_id}|${row.source_key}`} className="border-b border-white/[0.045] text-slate-400"><Td strong>{row.entity_name}</Td><Td>{portalLabel(row.portal)}</Td><Td strong>{row.source_label||label(row.ats_provider||row.source_key)}</Td><Td><Status value={row.status}/></Td><Td>{row.official_job_count===null||row.official_job_count===undefined?'—':Number(row.official_job_count).toLocaleString()}</Td><Td>{row.truth_eligible?'yes':'no'}</Td><Td>{formatTime(row.audited_at)}</Td></tr>)}</tbody></table></div>:<Empty text="Independent official-source audits will appear after benchmark cohort entities complete an ingest."/>}</section>

    <section className="glass-card luminous-panel p-5"><SectionTitle title="Learned Source-Pair Baselines" detail="Normal disagreement learned from recent healthy checks"/>{loading?<Skeleton/>:pairs.length?<div className="overflow-x-auto"><table className="w-full text-left text-[10px]"><thead><tr className="text-slate-600 border-b border-white/8"><Th>Source A</Th><Th>Source B</Th><Th>Samples</Th><Th>Median ratio</Th><Th>Normal p10–p90</Th><Th>Median Δ</Th><Th>Window</Th></tr></thead><tbody>{pairs.slice(0,40).map((row:any)=><tr key={`${row.source_a}|${row.source_b}`} className="border-b border-white/[0.045] text-slate-400"><Td strong>{label(row.source_a)}</Td><Td strong>{label(row.source_b)}</Td><Td>{row.sample_count}</Td><Td>{num(row.median_ratio)}</Td><Td>{num(row.p10_ratio)}–{num(row.p90_ratio)}</Td><Td>{num(row.median_abs_delta)}</Td><Td>{row.window_days}d</Td></tr>)}</tbody></table></div>:<Empty text="Baselines need several days of overlapping healthy source observations."/>}</section>

    <section className="glass-card luminous-panel p-5"><div className="flex items-start justify-between gap-4 flex-wrap mb-4"><div><h2 className="text-[15px] font-semibold text-slate-100">Ground Truth Capture</h2><p className="mt-1 text-[10px] text-slate-600">Automatic independent auditors capture supported official systems after cohort ingests. Manual capture remains available for unsupported sources; complete URL sets unlock exact precision and recall.</p></div><span className="rounded-full border border-cyan-400/20 bg-cyan-500/8 px-2.5 py-1 text-[9px] text-cyan-200">{summary.truth_entities||0} entities verified</span></div>
      <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr_0.55fr] gap-3"><select value={truth.entity_id} onChange={e=>setTruth(v=>({...v,entity_id:e.target.value}))} className="rounded-xl border border-white/10 bg-[#07101f] px-3 py-2.5 text-xs text-slate-300"><option value="">Select tracked entity…</option>{truthCandidates.map((row:any)=><option key={row.id} value={row.id}>{portalLabel(row.portal)} · {row.name}</option>)}</select><input value={truth.source_url} onChange={e=>setTruth(v=>({...v,source_url:e.target.value}))} placeholder="Official careers URL" className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs text-slate-300 outline-none focus:border-blue-400/35"/><input value={truth.official_job_count} onChange={e=>setTruth(v=>({...v,official_job_count:e.target.value}))} placeholder="Official count" inputMode="numeric" className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs text-slate-300 outline-none focus:border-blue-400/35"/></div>
      <textarea value={truth.job_urls} onChange={e=>setTruth(v=>({...v,job_urls:e.target.value}))} placeholder="Optional but best: paste the complete official job URL set, one URL per line…" className="mt-3 min-h-[92px] w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs text-slate-300 outline-none focus:border-blue-400/35"/>
      <div className="mt-3 flex justify-end"><button onClick={saveTruth} disabled={saving||!truth.entity_id} className="px-4 py-2.5 rounded-xl border border-blue-400/30 bg-blue-500/12 text-xs text-blue-100 hover:bg-blue-500/22 disabled:opacity-40">{saving?'Saving…':'Save truth snapshot'}</button></div>
    </section>
  </div>;
}

function Metric({label,value,warn=false}:{label:string;value:any;warn?:boolean}){return <div className={`rounded-xl border px-3.5 py-3 ${warn?'border-red-400/20 bg-red-500/[0.05]':'border-white/10 bg-white/[0.035]'}`}><p className="text-[9px] uppercase tracking-[0.13em] text-slate-500">{label}</p><p className={`mt-1 text-lg font-semibold ${warn?'text-red-100':'text-slate-100'}`}>{value??0}</p></div>}
function ReleaseCard({row}:{row:any}){const metrics=row.metrics||{};const blockers=Array.isArray(row.blockers)?row.blockers:[];return <div className="rounded-xl border border-white/8 bg-white/[0.025] p-3.5"><div className="flex items-start justify-between gap-3"><div><p className="text-[12px] font-medium text-slate-200">{portalLabel(row.portal_id)}</p><p className="mt-1 text-[9px] text-slate-600">{row.benchmark_entity_count} benchmark · {row.truth_entity_count} truth</p></div><Status value={row.status}/></div><div className="grid grid-cols-3 gap-2 mt-3 text-[9px]"><Mini label="Precision" value={percent(metrics.precision)}/><Mini label="Recall" value={percent(metrics.recall)}/><Mini label="Parity" value={percent(metrics.parity)}/></div>{blockers.length>0&&<p className="mt-3 text-[9px] leading-relaxed text-amber-200/60" title={blockers.join(' · ')}>{blockers.slice(0,2).join(' · ')}{blockers.length>2?` · +${blockers.length-2} more`:''}</p>}</div>}
function Status({value}:{value:any}){const v=String(value||'unknown').toLowerCase();const cls=v==='pass'||v==='low'||v==='complete'?'border-emerald-400/20 bg-emerald-500/8 text-emerald-200':v==='fail'||v==='critical'||v==='high'||v==='error'?'border-red-400/25 bg-red-500/8 text-red-200':'border-amber-400/20 bg-amber-500/8 text-amber-200';return <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[8px] uppercase tracking-[0.1em] ${cls}`}>{v.replace(/_/g,' ')}</span>}
function Mini({label:labelText,value}:{label:string;value:any}){return <div className="rounded-lg bg-white/[0.025] px-2 py-2"><p className="text-slate-600">{labelText}</p><p className="mt-1 text-slate-300">{value}</p></div>}
function SectionTitle({title,detail}:{title:string;detail:string}){return <div className="flex items-center justify-between gap-4 mb-4"><h2 className="text-[15px] font-semibold text-slate-100">{title}</h2><span className="text-[9px] text-slate-600">{detail}</span></div>}
function Empty({text}:{text:string}){return <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-5 text-[11px] text-slate-600">{text}</div>}
function Skeleton(){return <div className="h-24 rounded-xl border border-white/5 bg-white/[0.03] animate-pulse"/>}
function Th({children}:{children:any}){return <th className="py-2.5 pr-4 font-medium">{children}</th>}
function Td({children,strong=false,warn=false}:{children:any;strong?:boolean;warn?:boolean}){return <td className={`py-2.5 pr-4 ${strong?'text-slate-300 font-medium':''} ${warn?'text-amber-200':''}`}>{children}</td>}
function pct(a:number,b:number){return b?`${Math.round(a/b*100)}%`:'—'}
function percent(value:any){const n=Number(value);return Number.isFinite(n)?`${(n*100).toFixed(1)}%`:'—'}
function num(value:any){const n=Number(value);return Number.isFinite(n)?n.toFixed(2):'—'}
function formatTime(value:any){if(!value)return'—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}
function label(value:any){return String(value||'unknown').replace(/^ats:/,'').replace(/^gov:/,'').replace(/[_:]/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}
function portalLabel(value:any){const map:any={current_clients:'Current Clients',prospects:'Prospects',private_companies:'Private Companies',federal_agencies:'Federal Agencies',state_agencies:'State Agencies',counties_and_cities:'Counties & Cities'};return map[String(value||'')]||label(value)}
