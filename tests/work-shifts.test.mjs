import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

// Exercise the route with an in-memory double: no SQL or database is executed.
async function route(seed, existing=[]) {
  const inserted=[], statements=[];
  const db={
    select:()=>({from:()=>({limit:async()=>existing,orderBy:async()=>existing})}),
    insert:()=>({values:async rows=>{inserted.push(...rows);}}),
  };
  globalThis.__workShiftsFixture={env:{SEED_DEMO_DATA:seed,DB:{prepare:sql=>({run:async()=>{statements.push(sql);}})}},db};
  let source=await readFile(new URL('../app/api/work-shifts/route.ts',import.meta.url),'utf8');
  source=source
    .replace('import { asc, eq } from "drizzle-orm";','const asc=x=>x,eq=(a,b)=>[a,b];')
    .replace('import { env } from "cloudflare:workers";','const {env,db}=globalThis.__workShiftsFixture;')
    .replace('import { getDb } from "../../../db";','const getDb=()=>db;')
    .replace('import { operatorShifts } from "../../../db/schema";','const operatorShifts={};');
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const mod=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64')+'#'+Math.random());
  delete globalThis.__workShiftsFixture;
  return {mod,inserted,statements};
}

test('production GET preserves existing shifts and does not seed or run SQL',async()=>{
  const existing=[{id:42,staffName:'PERSONA EXISTENTE',startTime:'10:00',endTime:'12:00'}];
  for(const seed of [undefined,'false']){
    const fixture=await route(seed,existing);
    const response=await fixture.mod.GET();
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{shifts:existing});
    assert.deepEqual(fixture.inserted,[]);
    assert.deepEqual(fixture.statements,[]);
  }
  const empty=await route('false');
  assert.deepEqual(await (await empty.mod.GET()).json(),{shifts:[]});
  assert.deepEqual(empty.inserted,[]);
  assert.deepEqual(empty.statements,[]);
});

test('explicit demo seed uses the 31 revised shifts only when empty',async()=>{
  const fixture=await route('true');
  assert.equal((await fixture.mod.GET()).status,200);
  assert.equal(fixture.inserted.length,31);
  assert.equal(new Set(fixture.inserted.map(row=>JSON.stringify(row))).size,31);
  assert.equal(fixture.inserted.filter(row=>row.weekdays==='6').length,9);
  const sunday=fixture.inserted.filter(row=>row.weekdays==='0');
  assert.equal(sunday.length,2);
  for(const row of sunday){
    assert.equal(row.startTime,'14:00');
    assert.equal(row.endTime,'20:00');
    assert.equal(row.label,'Domingo fútbol');
  }
  for(const row of fixture.inserted){
    assert.ok(['radio','estudio'].includes(row.resource));
    assert.ok(row.startTime<row.endTime);
  }
  const occupied=await route('true',[{id:42}]);
  await occupied.mod.GET();
  assert.deepEqual(occupied.inserted,[]);
});
