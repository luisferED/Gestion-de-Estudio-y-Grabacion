import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
const crypto=webcrypto;
async function moduleFrom(file, replacements) {
  let source=await readFile(new URL('../'+file,import.meta.url),'utf8');
  for(const [before,after] of replacements)source=source.replace(before,after);
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  return import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
}
const keycloak=await moduleFrom('lib/keycloak.ts',[
  [/import \{env\} from "cloudflare:workers";/,'const env={};'],
  [/import \{APP_BASE_PATH\} from ".\/app-path";/,'const APP_BASE_PATH="";'],
]);
test('OIDC verifies RSA signature, issuer, audience, expiry, nonce, subject, iat and azp',async()=>{
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'test-key'};
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({keys:[jwk]});
  const now=Math.floor(Date.now()/1000);
  const claims={iss:'https://issuer.test/realm',aud:'ed-test',sub:'subject-test',iat:now,exp:now+60,nonce:'nonce-test'};
  const token=async c=>{
    const input=Buffer.from(JSON.stringify({alg:'RS256',kid:'test-key'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(c)).toString('base64url');
    return input+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,Buffer.from(input))).toString('base64url');
  };
  const discovery={issuer:claims.iss,jwks_uri:'https://issuer.test/keys'};
  try{
    assert.equal((await keycloak.verifyIdToken(await token(claims),discovery,'ed-test','nonce-test')).sub,claims.sub);
    for(const change of [{iss:'https://evil.test'},{aud:'evil'},{exp:now-1},{exp:'invalid'},{nonce:'evil'},{sub:''},{iat:now+600},{nbf:now+600},{aud:['ed-test','other'],azp:'evil'}]){
      await assert.rejects(()=>token({...claims,...change}).then(t=>keycloak.verifyIdToken(t,discovery,'ed-test','nonce-test')));
    }
    const signed=await token(claims),parts=signed.split('.');
    parts[1]=Buffer.from(JSON.stringify({...claims,sub:'forged'})).toString('base64url');
    await assert.rejects(()=>keycloak.verifyIdToken(parts.join('.'),discovery,'ed-test','nonce-test'));
  }finally{globalThis.fetch=originalFetch}
});
globalThis.__workerSha=keycloak.sha256Base64Url;
const {default:worker}=await moduleFrom('worker/index.ts',[
  ['import {getSession} from "../lib/auth-session";','const getSession=async(db,req)=>req.headers.get("Cookie")?db.prepare("").bind("").first():null;'],
  ['import {setIdentityName} from "../lib/request-identity";','const setIdentityName=(h,n)=>{h.set("x-ed-user-name",encodeURIComponent(n));h.set("x-ed-user-name-encoding","percent-encoded-utf-8")};'],

  ['from "../tools/request-origin.mjs"','from '+JSON.stringify(new URL('../tools/request-origin.mjs',import.meta.url).href)],
  [/import \{sha256Base64Url\} from "..\/lib\/keycloak";/,'const sha256Base64Url=globalThis.__workerSha;'],
  [/import handler from "vinext\/server\/app-router-entry";/,'const handler={fetch:async(request)=>Response.json({email:request.headers.get("x-ed-user-email"),role:request.headers.get("x-ed-user-role")})};'],
  [/import \{APP_BASE_PATH\} from "..\/lib\/app-path";/,'const APP_BASE_PATH="";'],
]);
const origin='http://127.0.0.1:16680';
const session=role=>({email:'session@example.test',name:'Test session',role});
function request(path,role,method='GET',headers={},body){
  const req=new Request(origin+path,{method,headers:{...(role?{Cookie:'ed_session_v2=test-session'}:{}),...(method!=='GET'?{Origin:origin,'Content-Type':'application/json'}:{}),...headers},...(method!=='GET'?{body:JSON.stringify(body||{})}:{})});
  const env={KEYCLOAK_PUBLIC_ORIGIN:origin,LOCAL_AUTH_BYPASS:'true',DB:{prepare:()=>({bind:()=>({first:async()=>role?session(role):null}),first:async()=>({count:0})})}};
  return worker.fetch(req,env,{waitUntil(){}});
}
test('external identity headers and localhost bypass cannot authenticate a request',async()=>{
  assert.equal((await request('/api/users',null,'GET',{'x-ed-user-email':'admin@example.test','x-ed-user-role':'administrador'})).status,401);
  assert.equal((await request('/api/authenticity',null)).status,401);
});
test('session identity overrides forged headers',async()=>{
  const r=await request('/api/reservations','produccion','GET',{'x-ed-user-email':'forged@example.test','x-ed-user-role':'administrador'});
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{email:'session@example.test',role:'produccion'});
});
test('Production Chief and Producer cannot reach metrics or central administration',async()=>{
  for(const role of ['jefe_produccion','productor','operador','editor','produccion','visor']){
    for(const path of ['/api/metrics','/api/users','/api/smtp-settings','/admin']){
      assert.equal((await request(path,role)).status,403,role+' '+path);
    }
  }
  assert.equal((await request('/api/reservations','jefe_produccion','PATCH')).status,200);
});
test('only Administrator can mutate users; operational staff can read the list',async()=>{
  assert.equal((await request('/api/users','jefe_operaciones')).status,200);
  assert.equal((await request('/api/users','jefe_operaciones','PATCH')).status,403);
  assert.equal((await request('/api/users','administrador','PATCH')).status,200);
});
test('viewer is read only and cross-origin mutations fail',async()=>{
  assert.equal((await request('/api/reservations','visor','POST')).status,403);
  assert.equal((await request('/api/reservations','administrador','POST',{Origin:'https://evil.test'})).status,403);
  assert.equal((await request('/api/reservations','administrador','POST',{Origin:''})).status,403);
});
test('healthcheck performs database queries',async()=>{
  assert.equal((await request('/api/health',null)).status,200);
  const r=await worker.fetch(new Request(origin+'/api/health'),{DB:{prepare(){throw Error('DB unavailable')}}},{});
  assert.equal(r.status,503);
});
test('uploaded SVG or external image URLs are rejected',async()=>{
  assert.equal((await request('/api/programs','administrador','POST',{}, {logoData:'data:image/svg+xml;base64,PHN2Zz4='})).status,400);
  assert.equal((await request('/api/programs','administrador','POST',{}, {logoData:'https://evil.test/logo'})).status,400);
});
test('SMTP password encryption authenticates ciphertext and detects a wrong key',async()=>{
  globalThis.__smtpTestEnv={SMTP_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};
  const secrets=await moduleFrom('lib/smtp-secrets.ts',[[/import \{env\} from "cloudflare:workers";/,'const env=globalThis.__smtpTestEnv;']]);
  const encrypted=await secrets.encryptSmtpPassword('fixture-password');
  assert.notEqual(encrypted,'fixture-password');
  assert.equal(await secrets.decryptSmtpPassword(encrypted),'fixture-password');
  globalThis.__smtpTestEnv.SMTP_ENCRYPTION_KEY=Buffer.alloc(32,8).toString('base64');
  await assert.rejects(()=>secrets.decryptSmtpPassword(encrypted));
  delete globalThis.__smtpTestEnv;
});

test('public gateway rejects runtime internals and encoded bypasses',async()=>{
  process.env.ED_GATEWAY_TEST_IMPORT='true';
  const {isPublicPath}=await import('../tools/http-gateway.mjs');
  for(const path of ['/cdn-cgi/local/explorer/api/d1/database','/%63dn-cgi/local/explorer/api/d1/database','/__scheduled','/@vite/client','/.env','/_next/static/secret.js.map'])assert.equal(isPublicPath(path),false,path);
  for(const path of ['/','/admin','/api/health','/api/reservations'])assert.equal(isPublicPath(path),true,path);
});
