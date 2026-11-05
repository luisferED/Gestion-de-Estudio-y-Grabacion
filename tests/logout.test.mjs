import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
async function compiled(file,replacements=[]){
  let source=await readFile(new URL('../'+file,import.meta.url),'utf8');
  for(const [before,after] of replacements)source=source.replace(before,after);
  return 'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64');
}
const cookiesUrl=await compiled('lib/auth-cookies.ts',[['import {APP_BASE_PATH,APP_COOKIE_PATH} from "./app-path";','const APP_BASE_PATH="",APP_COOKIE_PATH="/";']]);
const cookies=await import(cookiesUrl);
test('HTTPS session creation and removal use identical Path, HttpOnly, Secure and SameSite',()=>{
  const active=cookies.sessionCookie('https://grabaciones.ed','test-token');
  const h=new Headers();cookies.clearAuthCookies(h,'https://grabaciones.ed');
  const removed=h.getSetCookie().find(x=>x.startsWith('ed_session_v2='));
  for(const flag of ['Path=/','HttpOnly','SameSite=Strict','Secure']){assert.ok(active.includes(flag));assert.ok(removed.includes(flag))}
  assert.ok(!active.includes('Domain=')&&!removed.includes('Domain='));
  assert.ok(active.includes('Max-Age=43200'));assert.ok(removed.includes('Max-Age=0'));assert.ok(removed.includes('Expires=Thu, 01 Jan 1970'));
  for(const name of ['ed_oidc_state','ed_oidc_nonce','ed_oidc_verifier']){
    const created=cookies.oidcCookie('https://grabaciones.ed',name,'test');
    const cleared=h.getSetCookie().find(x=>x.startsWith(name+'='));
    for(const flag of ['Path=/api/auth/keycloak','HttpOnly','SameSite=Lax','Secure']){assert.ok(created.includes(flag));assert.ok(cleared.includes(flag))}
  }
});
const {logoutSession}=await import(await compiled('lib/logout-client.ts'));
test('Salir checks HTTP errors and does not fake a successful logout',async()=>{
  for(const status of [403,503]){
    let cleared=false,navigated=false;
    await assert.rejects(()=>logoutSession(async()=>Response.json({ok:false,error:'revocation failed'},{status}),()=>{cleared=true},()=>{navigated=true}),/revocation failed/);
    assert.equal(cleared,false);assert.equal(navigated,false);
  }
});
test('Salir sends credentials/no-store and navigates only after successful revocation',async()=>{
  const order=[];
  await logoutSession(async(url,init)=>{
    assert.equal(url,'/api/auth');assert.equal(init.method,'DELETE');assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');
    return Response.json({ok:true,logoutUrl:'https://keycloak.test/official/logout'});
  },()=>order.push('clear'),url=>order.push(url));
  assert.deepEqual(order,['clear','https://keycloak.test/official/logout']);
});
test('SQLite delete failure returns 503, not ok:true or cookie-only logout',async()=>{
  globalThis.__logoutEnv={DB:{prepare(){return{bind(){return{}}}},async batch(){throw Error('database unavailable')}}};
  const routeUrl=await compiled('app/api/auth/route.ts',[
    ['import {getSession} from "../../../lib/auth-session";','const getSession=async()=>null;'],
    ['import {keycloakConfig,keycloakDiscovery,keycloakPublicOrigin,sha256Base64Url} from "../../../lib/keycloak";','const keycloakPublicOrigin=()=>"https://grabaciones.ed",sha256Base64Url=async()=>"hash";'],
    ['import {env} from "cloudflare:workers";','const env=globalThis.__logoutEnv;'],
    ['from "../../../lib/auth-cookies"','from '+JSON.stringify(cookiesUrl)],
  ]);
  const {DELETE}=await import(routeUrl);
  const response=await DELETE(new Request('https://grabaciones.ed/api/auth',{method:'DELETE',headers:{Cookie:'ed_session_v2=fixture-token'}}));
  assert.equal(response.status,503);assert.equal((await response.json()).ok,false);assert.equal(response.headers.has('Set-Cookie'),false);
});
