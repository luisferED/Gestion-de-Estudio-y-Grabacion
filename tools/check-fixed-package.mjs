import {readFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const required=['tools/fixed_override_migration.py','drizzle/0023_fixed_schedule_overrides.sql','drizzle/meta/0023_snapshot.json'];
try{
  for(const file of required)await access(path.join(root,file));
  if(process.argv.includes('--source'))for(const file of ['lib/fixed-schedule.ts','app/page.tsx','app/api/reservations/route.ts','db/schema.ts'])await access(path.join(root,file));
  const approved=JSON.parse(await readFile(path.join(root,'tools/migrations-approved.json'),'utf8'));
  for(const [name,digest] of Object.entries(approved)){
    const sql=await readFile(path.join(root,'drizzle',name),'utf8');
    if(createHash('sha256').update(sql.replace(/\r\n/g,'\n')).digest('hex')!==digest)throw Error(`Migration hash mismatch: ${name}`);
  }
  if(!approved['0023_fixed_schedule_overrides.sql'])throw Error('Missing approved override migration');
  const journal=JSON.parse(await readFile(path.join(root,'drizzle/meta/_journal.json'),'utf8'));
  if(new Set(journal.entries.map(entry=>entry.idx)).size!==journal.entries.length)throw Error('Duplicate migration index');
  if(journal.entries.length!==Object.keys(approved).length)throw Error('Migration journal differs from approved set');
  console.log('[Fixed schedule package] OK');
}catch(error){console.error('[Fixed schedule package]',error.message);process.exitCode=1;}
