'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const auditor=require('../lib/benchmark/officialSourceAuditor');
const FIXTURES=path.join(__dirname,'fixtures');

function mockFetch(handler){const original=global.fetch;global.fetch=handler;return()=>{global.fetch=original;};}
function response({status=200,json,text='',contentType='application/json'}){return{ok:status>=200&&status<300,status,headers:{get:(name)=>String(name).toLowerCase()==='content-type'?contentType:null},json:async()=>json,text:async()=>text};}
function diagnostic(result){return JSON.stringify({status:result?.status,complete:result?.complete,officialCount:result?.officialCount,jobUrls:result?.jobUrls,metadata:result?.metadata});}

test('GovernmentJobs auditor independently captures complete RSS URL truth',async()=>{
  const xml=fs.readFileSync(path.join(FIXTURES,'neogov-valid.xml'),'utf8');
  const restore=mockFetch(async()=>response({text:xml,contentType:'application/rss+xml'}));
  try{const result=await auditor.auditOfficialSource({name:'City of Fresno'},{source_class:'authoritative',is_verified:true,ats_provider:'governmentjobs',board_id:'fresnoca',metadata:{shared_inventory:false}});assert.equal(result.status,'complete',diagnostic(result));assert.equal(result.officialCount,2);assert.equal(result.jobUrls.length,2);assert.ok(result.jobUrls.every(url=>url.includes('governmentjobs.com/careers/fresnoca/jobs/')));}finally{restore();}
});

test('GovernmentJobs partial RSS is audit-incomplete and cannot become ground truth',async()=>{
  const xml=fs.readFileSync(path.join(FIXTURES,'neogov-partial.xml'),'utf8');
  const restore=mockFetch(async()=>response({text:xml,contentType:'application/rss+xml'}));
  try{const result=await auditor.auditOfficialSource({name:'City of Fresno'},{source_class:'authoritative',is_verified:true,ats_provider:'governmentjobs',board_id:'fresnoca',metadata:{shared_inventory:false}});assert.equal(result.status,'incomplete',diagnostic(result));assert.equal(result.complete,false);assert.equal(result.officialCount,2);assert.equal(result.jobUrls.length,1);}finally{restore();}
});

test('Workday auditor independently paginates official inventory and builds stable posting URLs',async()=>{
  const fixture=JSON.parse(fs.readFileSync(path.join(FIXTURES,'workday-page.json'),'utf8'));
  const restore=mockFetch(async(url,options)=>{assert.equal(options.method,'POST');return response({json:fixture});});
  try{const result=await auditor.auditOfficialSource({name:'Acme'},{source_class:'authoritative',is_verified:true,ats_provider:'workday',board_id:'https://acme.wd5.myworkdayjobs.com/en-US/External',metadata:{shared_inventory:false}});assert.equal(result.status,'complete',diagnostic(result));assert.equal(result.officialCount,2);assert.equal(result.jobUrls.length,2);assert.ok(result.jobUrls.some(url=>url.includes('R1001')));}finally{restore();}
});

test('Greenhouse auditor refuses partial URL evidence',async()=>{
  const restore=mockFetch(async()=>response({json:{jobs:[{id:1,absolute_url:'https://boards.greenhouse.io/acme/jobs/1'},{id:2}]}}));
  try{const result=await auditor.auditOfficialSource({name:'Acme'},{source_class:'authoritative',is_verified:true,ats_provider:'greenhouse',board_id:'acme',metadata:{shared_inventory:false}});assert.equal(result.status,'incomplete',diagnostic(result));assert.equal(result.complete,false);assert.equal(result.officialCount,2);assert.equal(result.jobUrls.length,1);}finally{restore();}
});

test('Personio fallback posting URLs preserve the host that successfully served XML',async()=>{
  const xml='<?xml version="1.0"?><positions><position><id>personio-123</id><name>Program Manager</name></position></positions>';
  const restore=mockFetch(async(url)=>String(url).includes('.jobs.personio.de/')?response({status:404,text:'not found',contentType:'text/plain'}):response({text:xml,contentType:'application/xml'}));
  try{const result=await auditor.auditOfficialSource({name:'Acme'},{source_class:'authoritative',is_verified:true,ats_provider:'personio',board_id:'acme',metadata:{shared_inventory:false}});assert.equal(result.status,'complete',diagnostic(result));assert.equal(result.officialCount,1);assert.deepEqual(result.jobUrls,['https://acme.jobs.personio.com/job/personio-123']);assert.equal(result.metadata.host,'acme.jobs.personio.com');}finally{restore();}
});

test('shared inventories are never promoted to entity ground truth by the auditor',async()=>{
  let called=false;const restore=mockFetch(async()=>{called=true;return response({json:{}});});
  try{const result=await auditor.auditOfficialSource({name:'Example County'},{source_class:'authoritative',is_verified:true,ats_provider:'workday',board_id:'https://state.wd5.myworkdayjobs.com/en-US/jobs',metadata:{shared_inventory:true}});assert.equal(result.status,'unsupported',diagnostic(result));assert.equal(called,false);}finally{restore();}
});

test('recognized V2X Jibe source can be audited independently from ingest parser',async()=>{
  const restore=mockFetch(async(url)=>response({json:{totalCount:2,jobs:[{data:{title:'One',slug:'REQ1'}},{data:{title:'Two',slug:'REQ2'}}]}}));
  try{const result=await auditor.auditOfficialSource({name:'V2X'},{source_class:'authoritative',is_verified:true,ats_provider:'icims',source_url:'https://careers.gov2x.com/why-gov2x/jobs',metadata:{shared_inventory:false}});assert.equal(result.status,'complete',diagnostic(result));assert.equal(result.officialCount,2);assert.equal(result.jobUrls.length,2);}finally{restore();}
});
