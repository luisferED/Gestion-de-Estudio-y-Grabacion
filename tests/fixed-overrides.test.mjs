import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const compilerOptions={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX};
const url=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions}).outputText).toString('base64');
const fixedUrl=url(await readFile(new URL('../lib/fixed-schedule.ts',import.meta.url),'utf8'));
const fixed=await import(fixedUrl);
const blocks=[{id:1,title:'FIXED_FIRST',program:'Program A',resource:'radio',active:true,weekdays:'3',startTime:'08:00',endTime:'09:00',kind:'grabacion'},
 {id:2,title:'FIXED_SECOND',program:'Program B',resource:'radio',active:true,weekdays:'3',startTime:'09:15',endTime:'10:00',kind:'en vivo'}];
const payload={title:'BOOKING',program:'BOOKING',date:'2026-11-18',locationType:'radio',startTime:'08:30',endTime:'09:30',requester:'Requester',requesterEmail:'requester@example.test',usageCategory:'grabacion',crewDetail:'SONIDISTA'};

async function fixture(role='administrador',{rows=[],schedule=blocks,race=false}={}){
  const actor={email:'actor@example.test',name:'Fixture Actor',role,active:true},audits=[],stored=rows.map(r=>({...r}));
  const tables=Object.fromEntries(['reservations','scheduleBlocks','users','auditLogs','smtpSettings','editingStaff'].map(name=>[name,new Proxy({table:name},{get:(target,key)=>key==='table'?name:{table:name,key}})]));
  const matches=(row,condition)=>!condition|| (Array.isArray(condition)?condition.every(c=>matches(row,c)):row[condition.column.key]===condition.value);
  const data=table=>({reservations:stored,scheduleBlocks:schedule,users:[actor],auditLogs:audits,smtpSettings:[],editingStaff:[]}[table.table]);
  const mutation=rows=>({returning:async()=>rows,then:resolve=>resolve(undefined)});
  const db={select:()=>({from:table=>{let conditions;const chain={where:c=>{conditions=c;return chain;},limit:async n=>data(table).filter(r=>matches(r,conditions)).slice(0,n),orderBy:async()=>data(table).filter(r=>matches(r,conditions)),then:resolve=>resolve(data(table).filter(r=>matches(r,conditions)))};return chain;}}),
    insert:table=>({values:value=>{if(table===tables.auditLogs){audits.push(value);return mutation([value]);}if(race)throw Error('RESERVATION_TIME_CONFLICT');const saved={id:100+stored.length,assignedOperators:'[]',editingRequests:'[]',assignedEditingStaff:'[]',...value};stored.push(saved);return mutation([saved]);}}),
    update:table=>({set:values=>({where:condition=>{if(race)throw Error('RESERVATION_TIME_CONFLICT');const selected=data(table).filter(r=>matches(r,condition));for(const row of selected)Object.assign(row,values);return mutation(selected);}})})};
  globalThis.__fixedFixture={db,tables};
  let source=await readFile(new URL('../app/api/reservations/route.ts',import.meta.url),'utf8');
  source=source.replace('import { and, eq, lt, gt, asc, sql } from "drizzle-orm";','const eq=(column,value)=>({column,value}),and=(...c)=>c,lt=eq,gt=eq,asc=x=>x,sql=()=>null;')
    .replace('import { env } from "cloudflare:workers";','const env={DB:{prepare(){throw Error("DDL forbidden")}}};')
    .replace('import { getDb } from "../../../db";','const {db,tables}=globalThis.__fixedFixture;const getDb=()=>db;')
    .replace('import { auditLogs, editingStaff, reservations, scheduleBlocks, smtpSettings, users } from "../../../db/schema";','const {auditLogs,editingStaff,reservations,scheduleBlocks,smtpSettings,users}=tables;')
    .replace('import { assignOperators, requiresManualAssignment } from "../../../lib/operator-roster";','const assignOperators=async()=>[{role:"SONIDISTA",name:"ASYNC_ASSIGNED",startTime:"08:30",endTime:"09:30"}],requiresManualAssignment=()=>false;')
    .replace('import { sendSmtpMail } from "../../../lib/smtp";','const sendSmtpMail=()=>{throw Error("Real mail forbidden")};')
    .replace('from "../../../lib/fixed-schedule"','from '+JSON.stringify(fixedUrl));
  const mod=await import(url(source)+'#'+Math.random());delete globalThis.__fixedFixture;
  const send=(method,body)=>mod[method](new Request('http://fixture.test/api/reservations',{method,headers:{'x-ed-user-email':actor.email},body:JSON.stringify(body)}));
  return {send,stored,audits,actor};
}
const existing=()=>({id:1,...payload,status:'pendiente',assignedOperators:'[]',editingRequests:'[]',assignedEditingStaff:'[]'});

for(const role of ['administrador','jefe_produccion'])test(`${role}: all blocks require explicit fresh confirmation; creation is approved and audited`,async()=>{
  const f=await fixture(role);
  const first=await f.send('POST',payload);assert.equal(first.status,409);
  const warning=await first.json();assert.equal(warning.overrides.length,2);
  assert.match(warning.error,/Program A/);assert.match(warning.error,/Program B/);
  assert.equal((await f.send('POST',{...payload,allowFixedOverride:true})).status,409);
  assert.equal((await f.send('POST',{...payload,allowFixedOverride:'true',fixedOverrideKey:warning.overrideKey})).status,409);
  assert.equal(f.stored.length,0);assert.equal(f.audits.length,0);
  const accepted=await f.send('POST',{...payload,allowFixedOverride:true,fixedOverrideKey:warning.overrideKey});
  assert.equal(accepted.status,201);
  const {reservation}=await accepted.json();assert.equal(reservation.status,'aprobada');assert.equal(reservation.fixedOverride,true);
  assert.equal(reservation.approvalBy,f.actor.email);assert.equal(reservation.assignedOperators[0].name,'ASYNC_ASSIGNED');
  assert.equal(JSON.parse(f.audits[0].changes).sobrescrituraGrillaFija.after.length,2);
});

test('other roles cannot override by forging flags, key or role in payload',async()=>{
  for(const role of ['jefe_operaciones','productor','produccion','editor','operador','visor']){
    const f=await fixture(role);
    const key=fixed.fixedOverrideKey(payload,blocks);
    assert.equal((await f.send('POST',{...payload,role:'administrador',allowFixedOverride:true,fixedOverrideKey:key,fixedOverride:true,status:'aprobada'})).status,403);
    assert.equal(f.stored.length,0);assert.equal(f.audits.length,0);
  }
});

test('a changed fixed schedule invalidates prior confirmation',async()=>{
  const schedule=blocks.map(b=>({...b}));const f=await fixture('administrador',{schedule});
  const warning=await (await f.send('POST',payload)).json();schedule[1].title='CHANGED';
  assert.equal((await f.send('POST',{...payload,allowFixedOverride:true,fixedOverrideKey:warning.overrideKey})).status,409);
  assert.equal(f.stored.length,0);
});

test('approval uses persisted interval, requires confirmation and restricts override roles',async()=>{
  for(const role of ['administrador','jefe_produccion','productor','jefe_operaciones']){
    const f=await fixture(role,{rows:[existing()]});
    const request={id:1,action:'approve',startTime:'21:00',locationType:'exteriores'};
    const response=await f.send('PATCH',request);
    if(!fixed.canOverwriteFixed(role)){assert.equal(response.status,403);continue;}
    assert.equal(response.status,409);const warning=await response.json();
    const approved=await f.send('PATCH',{...request,allowFixedOverride:true,fixedOverrideKey:warning.overrideKey});
    assert.equal(approved.status,200);assert.equal(f.stored[0].fixedOverride,true);
    assert.equal(f.stored[0].startTime,payload.startTime);assert.equal(f.audits.length,1);
  }
});

test('editing an override repeats confirmation and preserves async personnel assignment',async()=>{
  const f=await fixture('jefe_produccion',{rows:[{...existing(),status:'aprobada',fixedOverride:true}]});
  const body={...payload,id:1};const warning=await (await f.send('PATCH',body)).json();
  assert.equal(f.audits.length,0);
  assert.equal((await f.send('PATCH',{...body,allowFixedOverride:true,fixedOverrideKey:warning.overrideKey})).status,200);
  assert.equal(f.stored[0].status,'aprobada');assert.equal(f.stored[0].fixedOverride,true);
  assert.equal(JSON.parse(f.stored[0].assignedOperators)[0].name,'ASYNC_ASSIGNED');
});

test('cancellation and denial restore projection without modifying schedule rows',async()=>{
  for(const method of ['DELETE','PATCH']){
    const before={...existing(),status:'aprobada',fixedOverride:true};const f=await fixture('administrador',{rows:[before]});
    assert.equal(fixed.visibleFixedBlocks(blocks,f.stored,payload.date).length,0);
    const request=method==='DELETE'?{id:1,reason:'Otro',detail:'Fixture reason'}:{id:1,action:'deny',reason:'Fixture denial'};
    assert.equal((await f.send(method,request)).status,200);
    assert.equal(f.stored[0].fixedOverride,false);assert.equal(fixed.visibleFixedBlocks(blocks,f.stored,payload.date).length,2);
    assert.equal(f.audits.length,1);assert.equal(blocks.length,2);
  }
});

test('ordinary reservations remain pending, ignore client flags and preserve requester identity',async()=>{
  const f=await fixture('produccion',{schedule:[]});
  const response=await f.send('POST',{...payload,status:'aprobada',fixedOverride:true,allowFixedOverride:true});
  assert.equal(response.status,201);assert.equal(f.stored[0].status,'pendiente');assert.equal(f.stored[0].fixedOverride,false);
  assert.equal(f.stored[0].requesterEmail,f.actor.email);
});

test('override never bypasses other reservations, recording buffers or DB concurrency errors',async()=>{
  for(const startTime of ['09:44','09:45']){
    const other={...existing(),id:2,startTime,endTime:'10:15',status:'aprobada'};
    const f=await fixture('administrador',{rows:[other],schedule:[]});
    const result=await f.send('POST',payload);
    assert.equal(result.status,startTime==='09:44'?409:201);
  }
  const f=await fixture('administrador',{race:true});const warning=await (await f.send('POST',payload)).json();
  assert.equal((await f.send('POST',{...payload,allowFixedOverride:true,fixedOverrideKey:warning.overrideKey})).status,409);
  assert.equal(f.audits.length,0);
});

test('Estudio II weekends remain open and weekday protected blocks require authorized confirmation',async()=>{
  for(const date of ['2026-11-21','2026-11-22']){
    const f=await fixture('produccion',{schedule:blocks.map(b=>({...b,resource:'estudio',weekdays:'1,2,3,4,5'}))});
    assert.equal((await f.send('POST',{...payload,date,locationType:'estudio',startTime:'12:00',endTime:'12:15'})).status,201);
  }
  const f=await fixture('administrador',{schedule:[{...blocks[0],resource:'estudio',startTime:'12:00',endTime:'12:15'}]});
  const body={...payload,locationType:'estudio',startTime:'12:00',endTime:'12:15'};
  const first=await f.send('POST',body);assert.equal(first.status,409);const warning=await first.json();
  assert.equal((await f.send('POST',{...body,allowFixedOverride:true,fixedOverrideKey:warning.overrideKey})).status,201);
});

test('projection is limited to date/resource/approved lifecycle and includes operational margins',()=>{
  const booked={...payload,status:'aprobada',fixedOverride:true};
  assert.equal(fixed.visibleFixedBlocks(blocks,[booked],payload.date).length,0);
  for(const status of ['pendiente','denegada','cancelada'])assert.equal(fixed.visibleFixedBlocks(blocks,[{...booked,status}],payload.date).length,2);
  assert.equal(fixed.visibleFixedBlocks(blocks,[booked],'2026-11-25').length,2);
  assert.equal(fixed.visibleFixedBlocks(blocks,[{...booked,locationType:'estudio'}],payload.date).length,2);
  assert.equal(fixed.fixedBlocksForBooking(blocks,{...payload,startTime:'09:14',endTime:'09:15'}).length,2);
  assert.equal(fixed.fixedBlocksForBooking(blocks,{...payload,startTime:'09:15',endTime:'09:30'}).length,1);
});

test('rendered weekly calendar hides and restores fixed blocks only on the affected day',async()=>{
  let source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
  source=source.replace('import {useAuth} from "./auth-context";','const useAuth=()=>({user:null});').replace(/^import ["'][^"']+\.css["'];\r?\n/gm,'')
    .replace('from "react"','from '+JSON.stringify(import.meta.resolve('react')))
    .replace('import {appFetch as fetch,appPath} from "../lib/app-path";','const fetch=()=>{throw Error("No network")},appPath=x=>x;')
    .replace('from "../lib/fixed-schedule"','from '+JSON.stringify(fixedUrl));
  const js=ts.transpileModule(source+'\nexport {Schedule};',{compilerOptions}).outputText.replace(/from "react\/jsx-runtime"/g,'from '+JSON.stringify(import.meta.resolve('react/jsx-runtime')));
  const {Schedule}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
  const render=status=>renderToStaticMarkup(React.createElement(Schedule,{days:[new Date('2026-11-18T12:00:00-04:00')],fixed:blocks.map(b=>({...b,start:b.startTime,end:b.endTime})),reservations:[{id:1,...payload,color:'#123456',status,fixedOverride:true}],onEdit(){}}));
  assert.ok(!render('aprobada').includes('FIXED_FIRST'));
  assert.ok(render('cancelada').includes('FIXED_FIRST'));assert.ok(render('denegada').includes('FIXED_SECOND'));
});
