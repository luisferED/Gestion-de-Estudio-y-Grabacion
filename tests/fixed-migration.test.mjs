import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('SQLite upgrades preserve records, handle existing columns and keep migration history',async()=>{
  const python=process.platform==='win32'?'python':'python3';
  const {stderr}=await promisify(execFile)(python,['tests/fixed-migration.py'],{windowsHide:true,timeout:30000});
  assert.match(stderr,/Ran 4 tests/);assert.match(stderr,/OK/);
});

test('D1 supports override column and retains trigger enforcement including concurrent writes',async()=>{
  const mf=new Miniflare(convertV4MiniflareOptions({compatibilityDate:'2026-07-29',modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'00000000-0000-4000-8000-000000000000'}}));
  try{
    const db=await mf.getD1Database('DB');
    await db.prepare('CREATE TABLE reservations (id integer PRIMARY KEY AUTOINCREMENT,date text,location_type text,start_time text,end_time text,status text,usage_category text)').run();
    await db.prepare(await readFile(new URL('../drizzle/0023_fixed_schedule_overrides.sql',import.meta.url),'utf8')).run();
    const triggers=await readFile(new URL('../drizzle/0021_reservation_concurrency.sql',import.meta.url),'utf8');
    for(const trigger of triggers.match(/CREATE TRIGGER[\s\S]*?END;/g))await db.prepare(trigger).run();
    const insert=(date,start,end)=>db.prepare("INSERT INTO reservations(date,location_type,start_time,end_time,status,usage_category,fixed_override) VALUES (?,'radio',?,?,'aprobada','grabacion',1)").bind(date,start,end).run();
    await insert('2026-11-18','08:00','09:00');
    await assert.rejects(()=>insert('2026-11-18','09:14','09:30'),/RESERVATION_TIME_CONFLICT/);
    await insert('2026-11-18','09:15','09:30');
    const raced=await Promise.allSettled([insert('2026-11-19','08:00','09:00'),insert('2026-11-19','08:00','09:00')]);
    assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(raced.filter(r=>r.status==='rejected').length,1);
    assert.equal((await db.prepare('SELECT sum(fixed_override) n FROM reservations').first()).n,3);
  }finally{await mf.dispose();}
});


test('fixed schedule package validates a final-image layout and rejects absent runtime artifacts',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'ed-fixed-image-'));
  t.after(async()=>{const target=path.resolve(directory);assert.equal(path.dirname(target),path.resolve(tmpdir()));assert.ok(path.basename(target).startsWith('ed-fixed-image-'));await rm(target,{recursive:true,force:true});});
  const approved=JSON.parse(await readFile(new URL('../tools/migrations-approved.json',import.meta.url),'utf8'));
  const files=['tools/check-fixed-package.mjs','tools/fixed_override_migration.py','tools/migrations-approved.json','drizzle/meta/_journal.json','drizzle/meta/0023_snapshot.json',...Object.keys(approved).map(name=>'drizzle/'+name)];
  for(const file of files){const target=path.join(directory,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,await readFile(new URL('../'+file,import.meta.url)));}
  await writeFile(path.join(directory,'package.json'),'{}');
  const checker=path.join(directory,'tools/check-fixed-package.mjs');
  // Image package.json has type=module; the copied .mjs also works independently.
  assert.match((await promisify(execFile)(process.execPath,[checker],{windowsHide:true})).stdout,/OK/);
  const helper=path.join(directory,'tools/fixed_override_migration.py');await rm(helper);
  await assert.rejects(()=>promisify(execFile)(process.execPath,[checker],{windowsHide:true}));
  await writeFile(helper,await readFile(new URL('../tools/fixed_override_migration.py',import.meta.url)));
  await rm(path.join(directory,'drizzle/0023_fixed_schedule_overrides.sql'));
  await assert.rejects(()=>promisify(execFile)(process.execPath,[checker],{windowsHide:true}));
  const docker=await readFile(new URL('../Dockerfile',import.meta.url),'utf8');
  assert.match(docker,/RUN npm run check:fixed:source/);assert.match(docker,/RUN npm run check:fixed\s/);
});
