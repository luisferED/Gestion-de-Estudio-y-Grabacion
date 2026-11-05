import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {configuredPublicOrigin,ORIGIN_PROOF_HEADER,signRequestOrigin,verifyRequestOrigin} from '../tools/request-origin.mjs';
const publicOrigin='https://grabaciones.ed',secret='fixture-gateway-secret-'.repeat(3);
let source=await readFile(new URL('../worker/index.ts',import.meta.url),'utf8');
source=source.replace('import {getSession} from "../lib/auth-session";','const getSession=async(db,req)=>req.headers.get("Cookie")?db.prepare("").bind("").first():null;');
source=source.replace('import {setIdentityName} from "../lib/request-identity";','const setIdentityName=(h,n)=>{h.set("x-ed-user-name",encodeURIComponent(n));h.set("x-ed-user-name-encoding","percent-encoded-utf-8")};');

source=source.replace('from "../tools/request-origin.mjs"','from '+JSON.stringify(new URL('../tools/request-origin.mjs',import.meta.url).href));
source=source.replace('import {sha256Base64Url} from "../lib/keycloak";','const sha256Base64Url=async()=>"fixture-hash";');
source=source.replace('import handler from "vinext/server/app-router-entry";','const handler={fetch:async()=>Response.json({handled:true})};');
source=source.replace('import {APP_BASE_PATH} from "../lib/app-path";','const APP_BASE_PATH="";');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const runtime={KEYCLOAK_PUBLIC_ORIGIN:publicOrigin,ED_GATEWAY_SECRET:secret,DB:{prepare:()=>({bind:()=>({first:async()=>({email:'fixture@example.test',name:'Fixture',role:'produccion'})})})}};
async function send(headers={},env=runtime,path='/api/auth',method='DELETE'){
  return worker.fetch(new Request('http://grabaciones.ed'+path,{method,headers:{Origin:'http://grabaciones.ed','Content-Type':'application/json',Cookie:'ed_session_v2=fixture',...headers},...(method==='GET'?{}:{body:'{}'})}),env,{waitUntil(){}});
}
test('Worker accepts the verified HTTPS browser origin after Wrangler rewrites Origin to HTTP',async()=>{
  const proof=await signRequestOrigin(secret,publicOrigin,'DELETE','/api/auth');
  assert.equal((await send({[ORIGIN_PROOF_HEADER]:proof})).status,200);
});
test('Worker rejects foreign origins, missing proof and forged forwarded headers',async()=>{
  const foreign=await signRequestOrigin(secret,'https://evil.test','DELETE','/api/auth');
  for(const headers of [
    {[ORIGIN_PROOF_HEADER]:foreign},
    {Origin:publicOrigin},
    {Origin:'https://evil.test','X-Forwarded-Proto':'https','X-Forwarded-Host':'grabaciones.ed',[ORIGIN_PROOF_HEADER]:'forged'},
  ])assert.equal((await send(headers)).status,403);
});
test('proof is bound to private key, path, method and exact public origin',async()=>{
  const proof=await signRequestOrigin(secret,publicOrigin,'DELETE','/api/auth');
  assert.equal(await verifyRequestOrigin(proof,secret,publicOrigin,'DELETE','/api/auth'),true);
  for(const args of [[secret,'https://evil.test','DELETE','/api/auth'],[secret,publicOrigin,'POST','/api/auth'],[secret,publicOrigin,'DELETE','/api/users'],['other-secret-'.repeat(4),publicOrigin,'DELETE','/api/auth']])
    assert.equal(await verifyRequestOrigin(proof,...args),false);
  assert.equal(await verifyRequestOrigin(proof+'x',secret,publicOrigin,'DELETE','/api/auth'),false);
});
test('missing public origin fails closed instead of using the internal HTTP URL',async()=>{
  assert.equal((await send({}, {...runtime,KEYCLOAK_PUBLIC_ORIGIN:''})).status,503);
  assert.throws(()=>configuredPublicOrigin('https://grabaciones.ed/other'));
});
test('Produccion 403 for users and staff is role authorization and stays unchanged',async()=>{
  for(const path of ['/api/users','/api/staff']){
    const r=await send({},runtime,path,'GET');
    assert.equal(r.status,403);
    assert.match((await r.json()).error,/exclusivo/);
  }
});
test('gateway validates original Origin and replaces all client-supplied forwarding/proof headers',async()=>{
  let captured;
  const upstream=http.createServer((req,res)=>{captured=req.headers;res.writeHead(200);res.end('ok')});
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  Object.assign(process.env,{INTERNAL_APP_PORT:String(upstream.address().port),KEYCLOAK_PUBLIC_ORIGIN:publicOrigin,ED_GATEWAY_SECRET:secret,ED_GATEWAY_TEST_IMPORT:'true'});
  const {createGateway}=await import('../tools/http-gateway.mjs');
  const gateway=createGateway();gateway.listen(0,'127.0.0.1');await once(gateway,'listening');
  const url='http://127.0.0.1:'+gateway.address().port+'/api/auth';
  try{
    const goodProof=await signRequestOrigin(secret,publicOrigin,'DELETE','/api/auth');
    let r=await fetch(url,{method:'DELETE',headers:{Origin:'https://evil.test',[ORIGIN_PROOF_HEADER]:goodProof,'X-Forwarded-Host':'grabaciones.ed','X-Forwarded-Proto':'https'},body:'{}'});
    assert.equal(r.status,403);await r.text();assert.equal(captured,undefined);
    r=await fetch(url,{method:'DELETE',headers:{Origin:publicOrigin,[ORIGIN_PROOF_HEADER]:'forged','X-Forwarded-Host':'evil.test','X-Forwarded-Proto':'http',Forwarded:'host=evil.test'},body:'{}'});
    assert.equal(r.status,200);await r.text();
    assert.equal(captured.origin,publicOrigin);
    assert.equal(captured['x-forwarded-host'],undefined);assert.equal(captured['x-forwarded-proto'],undefined);assert.equal(captured.forwarded,undefined);
    assert.notEqual(captured[ORIGIN_PROOF_HEADER],'forged');
    assert.equal(await verifyRequestOrigin(captured[ORIGIN_PROOF_HEADER],secret,publicOrigin,'DELETE','/api/auth'),true);
  }finally{
    gateway.closeAllConnections();upstream.closeAllConnections();
    await Promise.all([new Promise(resolve=>gateway.close(resolve)),new Promise(resolve=>upstream.close(resolve))]);
  }
});
