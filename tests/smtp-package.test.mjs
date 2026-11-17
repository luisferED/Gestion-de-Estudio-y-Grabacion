import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {verifySmtpPackage} from '../tools/check-smtp-package.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse((await readFile(new URL('../tools/smtp-package.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
async function fixture(t,{index=false}={}){
  const directory=await mkdtemp(path.join(tmpdir(),'ed-smtp-package-'));
  t.after(async()=>{
    const target=path.resolve(directory);
    assert.equal(path.dirname(target),path.resolve(tmpdir()));
    assert.ok(path.basename(target).startsWith('ed-smtp-package-'));
    await rm(target,{recursive:true,force:true});
  });
  for(const file of [...manifest.runtime,'package.json']){
    const target=path.join(directory,file);
    await mkdir(path.dirname(target),{recursive:true});
    let data;
    if(index){
      const result=spawnSync('git',['show',`:${file}`],{cwd:root,windowsHide:true});
      assert.equal(result.status,0,`Missing indexed artifact: ${file}`);data=result.stdout;
    }else data=await readFile(path.join(root,file));
    await writeFile(target,data);
  }
  return directory;
}

test('complete SMTP artifact imports offline without opening listeners',async t=>{
  const directory=await fixture(t);
  assert.deepEqual(await verifySmtpPackage({root:directory,filesOnly:true}),{files:manifest.runtime.length,python:false,git:false});
});

for(const missing of ['tools/smtp-diagnostics.mjs','tools/smtp-ntlm.mjs','tools/smtp-ntlm.py','requirements-smtp.txt'])test(`preflight rejects missing ${missing}`,async t=>{
  const directory=await fixture(t);
  await rm(path.join(directory,missing));
  await assert.rejects(()=>verifySmtpPackage({root:directory,filesOnly:true}),error=>error.message.includes(missing));
});

test('preflight loads transitive imports and catches missing modules beyond the manifest',async t=>{
  const directory=await fixture(t);
  await writeFile(path.join(directory,'tools/smtp-diagnostics.mjs'),'import "./missing-transitive.mjs";');
  await assert.rejects(()=>verifySmtpPackage({root:directory,filesOnly:true}),/module graph/);
});

test('preflight reports missing Python without starting SMTP',async t=>{
  const directory=await fixture(t);
  await assert.rejects(()=>verifySmtpPackage({root:directory,python:'nonexistent-smtp-python-fixture'}),/Python\/helper\/pyspnego/);
});

test('Git-index artifact contains the complete SMTP runtime',async t=>{
  const directory=await fixture(t,{index:true});
  await verifySmtpPackage({root:directory,filesOnly:true});
});

test('Docker validates both build context and runtime image before application startup',async()=>{
  const docker=await readFile(new URL('../Dockerfile',import.meta.url),'utf8');
  assert.match(docker,/RUN npm run check:smtp:files && npm run build/);
  assert.match(docker,/COPY --from=build[^\n]*\/app\/tools \.\/tools/);
  assert.match(docker,/COPY --from=build[^\n]*\/app\/requirements-smtp\.txt \.\//);
  assert.match(docker,/USER node\s*#[^\n]*\nRUN npm run check:smtp/);
  const startup=await readFile(new URL('../tools/container-start.mjs',import.meta.url),'utf8');
  assert.ok(startup.indexOf('await verifySmtpPackage();')<startup.indexOf('const state ='));
});


test('Docker context ends with explicit inclusions for every SMTP runtime file',async()=>{
  const rules=(await readFile(new URL('../.dockerignore',import.meta.url),'utf8')).split(/\r?\n/).filter(line=>line.trim()&&!line.startsWith('#'));
  assert.deepEqual(rules.slice(-(manifest.runtime.length+1)),['!tools/',...manifest.runtime.map(file=>'!'+file)]);
});
