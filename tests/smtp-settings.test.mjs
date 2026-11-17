import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

async function fixture(before){
  const writes=[];
  globalThis.__smtpSettingsTest={before,writes};
  let source=await readFile(new URL('../app/api/smtp-settings/route.ts',import.meta.url),'utf8');
  source=source
    .replace('import {encryptSmtpPassword} from "../../../lib/smtp-secrets";','const encryptSmtpPassword=async value=>!value||value.startsWith("aesgcm:v1:")?value:"aesgcm:v1:mock-encrypted";')
    .replace('import { eq } from "drizzle-orm";','const eq=()=>null;')
    .replace('import { env } from "cloudflare:workers";','const env={DB:{prepare:()=>{throw Error("SQL is forbidden in this test")}}};')
    .replace('import { getDb } from "../../../db";',`const {before,writes}=globalThis.__smtpSettingsTest;
      const getDb=()=>({select:()=>({from:()=>({where:()=>({limit:async()=>before?[before]:[]})})}),
        update:()=>({set:values=>{writes.push(values);return {where:()=>({returning:async()=>[{id:1,...values}]})}}}),
        insert:()=>({values:values=>{writes.push(values);return {returning:async()=>[values]}}})});`)
    .replace('import { smtpSettings } from "../../../db/schema";','const smtpSettings={id:1};')
    .replace('import { sendSmtpMail } from "../../../lib/smtp";','const sendSmtpMail=()=>{throw Error("PRIVATE_TEST_PASSWORD NTLMSSP_PRIVATE_TOKEN")};');
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const mod=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64')+'#'+Math.random());
  delete globalThis.__smtpSettingsTest;
  return {mod,writes};
}
const config={id:1,host:'172.20.16.5',port:25,security:'none',authMode:'ntlm',username:'DOMAIN\\service',password:'aesgcm:v1:existing-ciphertext',fromName:'Gestión ED',fromEmail:'sender@example.test',recipients:'recipient@example.test',enabled:true};
const put=(mod,body)=>mod.PUT(new Request('http://fixture.test/api/smtp-settings',{method:'PUT',body:JSON.stringify(body)}));

test('NTLM settings accept no TLS and preserve existing encrypted password on blank input',async()=>{
  const f=await fixture(config);
  const response=await put(f.mod,{...config,password:''});
  assert.equal(response.status,200);
  assert.equal(f.writes.length,1);
  assert.equal(f.writes[0].password,config.password);
  assert.equal(f.writes[0].username,config.username);
  assert.equal(f.writes[0].authMode,'ntlm');
  const {settings}=await response.json();
  assert.equal(settings.password,'');assert.equal(settings.hasPassword,true);
});

test('reading legacy LOGIN settings does not migrate credentials or expose ciphertext',async()=>{
  const f=await fixture({...config,authMode:'login',security:'starttls'});
  const {settings}=await (await f.mod.GET()).json();
  assert.equal(settings.authMode,'login');assert.equal(settings.password,'');
  assert.equal(settings.hasPassword,true);assert.deepEqual(f.writes,[]);
});

test('LOGIN without TLS, unknown auth and missing NTLM credentials are rejected without writes',async()=>{
  for(const change of [{authMode:'login'},{authMode:'plain'},{username:''},{password:''}]){
    const f=await fixture();
    const response=await put(f.mod,{...config,...change});
    assert.equal(response.status,400);assert.deepEqual(f.writes,[]);
  }
});

test('new NTLM passwords pass through encryption; LOGIN with TLS and IP relay remain available',async()=>{
  for(const change of [{authMode:'ntlm',password:'synthetic-secret'},{authMode:'login',security:'starttls',password:'synthetic-secret'},{authMode:'none',password:''}]){
    const f=await fixture();
    assert.equal((await put(f.mod,{...config,...change})).status,200);
    assert.equal(f.writes[0].password,change.authMode==='none'?'':'aesgcm:v1:mock-encrypted');
  }
});


test('corporate account selector uses the explicit NTLM mode and labels LOGIN separately',async()=>{
  const source=await readFile(new URL('../app/admin/page.tsx',import.meta.url),'utf8');
  assert.match(source,/<option value="ntlm">Cuenta corporativa/);
  assert.match(source,/<option value="login">AUTH LOGIN/);
  assert.match(source,/\["login","ntlm"\]\.includes\(form.authMode\)/);
});


test('SMTP test API returns a fixed public 502 without third-party error details',async()=>{
  const f=await fixture(config);
  const response=await f.mod.POST(new Request('http://fixture.test/api/smtp-settings',{method:'POST',body:'{}'}));
  assert.equal(response.status,502);
  const result=await response.json();
  assert.deepEqual(result,{error:'No se pudo enviar el correo de prueba. Revise los logs del servidor.'});
  assert.ok(!JSON.stringify(result).includes('PRIVATE_TEST_PASSWORD'));
  assert.deepEqual(f.writes,[]);
});
