import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import path from 'node:path';
const state=process.argv[2];
const mf=new Miniflare(convertV4MiniflareOptions({
  modules:true,script:'export default {fetch(){return new Response("test")}}',
  compatibilityDate:'2026-07-29',
  d1Databases:{DB:'00000000-0000-4000-8000-000000000000'},
  resourcePersistencePath:path.join(state,'v3'),
}));
let checks=0;
const check=(name,condition)=>{assert.ok(condition,name);checks++;console.log('PASS '+name)};
try{
  const db=await mf.getD1Database('DB');
  check('D1 reads the migrated SQLite file',(await db.prepare('SELECT count(*) n FROM ed_migrations').first()).n===22);
  check('both original overlapping rows survive',(await db.prepare("SELECT count(*) n FROM reservations WHERE title LIKE 'legacy-%'").first()).n===2);
  const insert=async({date='2026-12-01',start='10:00',end='11:00',resource='radio',status='pendiente',category='grabación'}={})=>
    db.prepare("INSERT INTO reservations(title,program,location_type,date,start_time,end_time,requester,requester_email,status,usage_category) VALUES ('fixture','TEST',?,?,?,?, 'Fixture','fixture@example.test',?,?)").bind(resource,date,start,end,status,category).run();
  const conflict=async(name,fn)=>{await assert.rejects(fn,/RESERVATION_TIME_CONFLICT/);checks++;console.log('PASS '+name)};
  await db.prepare("UPDATE reservations SET notes='retained' WHERE title='legacy-a'").run();
  await db.prepare("UPDATE reservations SET status='confirmada',actual_start_time='08:05',delay_minutes=5 WHERE title='legacy-a'").run();
  check('existing overlap permits notes, approval and actual timing',(await db.prepare("SELECT notes FROM reservations WHERE title='legacy-a'").first()).notes==='retained');
  await db.prepare("UPDATE reservations SET title='legacy-a',start_time=start_time WHERE title='legacy-a'").run();
  check('no-op schedule update permitted',true);
  await conflict('existing overlap cannot move into conflict',()=>db.prepare("UPDATE reservations SET start_time='08:10' WHERE title='legacy-a'").run());
  check('failed update leaves original unchanged',(await db.prepare("SELECT start_time FROM reservations WHERE title='legacy-a'").first()).start_time==='08:00');
  await insert();
  await conflict('direct overlap rejected',()=>insert({start:'10:30',end:'11:30'}));
  await conflict('15-minute recording buffer rejected',()=>insert({start:'11:14',end:'11:30'}));
  await insert({start:'11:15',end:'11:45'});
  check('exact 15-minute boundary accepted',true);
  await conflict('preceding recording buffer rejected',()=>insert({start:'09:00',end:'09:50',date:'2026-12-02'}).then(()=>insert({date:'2026-12-02'})));
  await insert({date:'2026-12-03',start:'09:00',end:'09:45'});
  await insert({date:'2026-12-03'});
  check('preceding exact boundary accepted',true);
  await insert({resource:'estudio'});
  check('different resource accepted',true);
  const cancelled=await insert({status:'cancelada',start:'10:30',end:'10:45'});
  await conflict('reactivation conflicting cancelled reservation rejected',()=>db.prepare("UPDATE reservations SET status='pendiente' WHERE id=?").bind(cancelled.meta.last_row_id).run());
  await insert({status:'denegada',start:'10:30',end:'10:45'});
  check('cancelled and denied rows do not reserve space',true);
  await insert({date:'2026-12-05',category:'actividades internas'});
  await insert({date:'2026-12-05',start:'11:00',end:'11:30',category:'actividades internas'});
  check('non-recording adjacent reservations accepted',true);
  await conflict('switching category respects recording margin',()=>db.prepare("UPDATE reservations SET usage_category='grabación' WHERE date='2026-12-05' AND start_time='10:00'").run());
  const raced=await Promise.allSettled([insert({date:'2026-12-04'}),insert({date:'2026-12-04'})]);
  check('concurrent requests admit exactly one writer',raced.filter(x=>x.status==='fulfilled').length===1&&raced.filter(x=>x.status==='rejected').length===1);
  check('concurrent rejection is trigger conflict',raced.some(x=>x.status==='rejected'&&/RESERVATION_TIME_CONFLICT/.test(String(x.reason))));
  check('exactly one row committed',(await db.prepare("SELECT count(*) n FROM reservations WHERE date='2026-12-04'").first()).n===1);
  await db.prepare("UPDATE reservations SET status='cancelada' WHERE title='legacy-a'").run();
  check('legacy overlapping reservation can be cancelled',true);
  console.log(JSON.stringify({d1_checks:checks,ok:true}));
}finally{await mf.dispose()}
