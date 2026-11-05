import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
async function compiled(file,replacements=[]){
  let source=await readFile(new URL('../'+file,import.meta.url),'utf8');
  for(const [from,to] of replacements)source=source.replace(from,to);
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  return 'data:text/javascript;base64,'+Buffer.from(js).toString('base64');
}
const identityUrl=await compiled('lib/request-identity.ts'),identity=await import(identityUrl);
globalThis.__identity=identity;
test('identity header round-trips Unicode through an ASCII-only envelope',()=>{
  for(const name of ['María Muñoz','José Peña — Producción','Zoë Łukasz','漢字 😀','Nombre %20 literal']){
    const h=new Headers();identity.setIdentityName(h,name);
    assert.ok([...h.get('x-ed-user-name')].every(c=>c.charCodeAt(0)<128));
    assert.equal(identity.requestIdentityName(new Request('https://grabaciones.ed',{headers:h})),name);
  }
});
const sessionModule=await compiled('lib/auth-session.ts',[
  ['import {sessionTokens} from "./auth-cookies";','const sessionTokens=()=>[];'],
  ['import {sha256Base64Url} from "./keycloak";','const sha256Base64Url=async()=>"test";'],
]);
const {isActiveUser}=await import(sessionModule);
test('imported active booleans have one strict interpretation without activating false values',()=>{
  for(const value of [1,true,'1','true','TRUE',' true '])assert.equal(isActiveUser(value),true);
  for(const value of [0,false,'0','false','FALSE','',null,undefined,2,'administrador'])assert.equal(isActiveUser(value),false);
});
const workerModule=await compiled('worker/index.ts',[
  ['from "../tools/request-origin.mjs"','from '+JSON.stringify(new URL('../tools/request-origin.mjs',import.meta.url).href)],
  ['import {getSession} from "../lib/auth-session";','const getSession=async(db)=>db.session;'],
  ['from "../lib/request-identity"','from '+JSON.stringify(identityUrl)],
  ['import {APP_BASE_PATH} from "../lib/app-path";','const APP_BASE_PATH="";'],
  ['import handler from "vinext/server/app-router-entry";','const handler={fetch:async req=>Response.json({encoded:req.headers.get("x-ed-user-name"),name:globalThis.__identity.requestIdentityName(req),role:req.headers.get("x-ed-user-role")})};'],
]);
const {default:worker}=await import(workerModule);
test('Worker replaces forged identity headers with the Unicode database identity',async()=>{
  const req=new Request('http://grabaciones.ed/admin',{headers:{'x-ed-user-name':'FORGED','x-ed-user-name-encoding':'percent-encoded-utf-8','x-ed-user-role':'administrador'}});
  const result=await worker.fetch(req,{DB:{session:{email:'test@example.test',name:'María Muñoz — Producción',role:'administrador'}}},{});
  assert.equal(result.status,200);
  const data=await result.json();assert.equal(data.name,'María Muñoz — Producción');assert.notEqual(data.encoded,'FORGED');
});
test('Unicode handling cannot grant admin permission to Produccion',async()=>{
  const result=await worker.fetch(new Request('http://grabaciones.ed/admin',{headers:{'x-ed-user-role':'administrador'}}),{DB:{session:{email:'test@example.test',name:'José Peña',role:'produccion'}}},{});
  assert.equal(result.status,403);
});
test('session retrieval errors are operational errors, not misleading 401 responses',async()=>{
  const result=await worker.fetch(new Request('http://grabaciones.ed/admin'),{DB:{get session(){throw Error('test unavailable')}}},{});
  assert.equal(result.status,503);
});
