import {spawn,spawnSync} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const [origin,profile,mode='verify']=process.argv.slice(2);
await mkdir(profile,{recursive:true});
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let ws;const checks=[],events=[],pending=new Map();let seq=0,currentEmail='alice@example.test';
function check(name,ok){if(!ok)throw Error(name);checks.push(name);console.log('PASS '+name)}
try{
  let port;
  for(let i=0;i<60;i++){try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split(String.fromCharCode(10))[0]);break}catch{await pause(100)}}
  if(!port)throw Error('Headless Chrome failed to start');
  const pages=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
  ws.addEventListener('message',event=>{
    const m=JSON.parse(event.data);
    if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p?.reject(Error(m.error.message));else p?.resolve(m.result);return}
    if(m.method==='Fetch.requestPaused'){
      const u=new URL(m.params.request.url);u.searchParams.set('test_user',currentEmail);
      call('Fetch.continueRequest',{requestId:m.params.requestId,url:u.href}).catch(()=>{});
    }
    if(m.method==='Network.responseReceived'){
      const u=new URL(m.params.response.url);
      if(u.origin===origin)events.push({path:u.pathname,status:m.params.response.status});
    }
    if(m.method==='Network.requestWillBeSentExtraInfo'){
      for(const c of m.params.associatedCookies||[])if(c.cookie.name==='ed_session_v2'&&c.blockedReasons.length)events.push({cookieBlocked:c.blockedReasons});
    }
  });
  await call('Page.enable');await call('Network.enable');
  await call('Fetch.enable',{patterns:[{urlPattern:'http://localhost:18781/realms/test/authorize*',requestStage:'Request'}]});
  const evaluate=async expression=>{
    const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw Error('Browser evaluation failed');
    return result.result.value;
  };
  const until=async expression=>{
    for(let i=0;i<100;i++){try{if(await evaluate(expression))return}catch{}await pause(100)}
    throw Error('Timed out waiting for '+expression);
  };
  const auth=()=>evaluate('fetch("/api/auth",{cache:"no-store",credentials:"same-origin"}).then(async r=>({status:r.status,data:await r.json()}))');
  await call('Page.navigate',{url:origin+'/api/auth/keycloak/login'});
  await until('location.pathname==="/admin"&&document.readyState==="complete"');
  const initial=await auth();
  const observation={events:[...events],authStatus:initial.status,name:initial.data.user?.name,location:await evaluate('location.pathname')};
  console.log('OBSERVED '+JSON.stringify(observation));
  if(mode==='baseline'){
    await writeFile(path.join(profile,'observed.json'),JSON.stringify(observation,null,2));
  }else{
    check('Chrome cross-site login reaches admin HTML',events.some(e=>e.path==='/admin'&&e.status===200));
    check('Chrome receives exact Unicode administrator identity',initial.status===200&&initial.data.user.name==='María Muñoz'&&initial.data.user.role==='administrador');
    await until('document.querySelector(".auth-session-chip button")!==null');
    const stored=await call('Network.getCookies',{urls:[origin]});
    const oldToken=stored.cookies.find(c=>c.name==='ed_session_v2')?.value;
    check('Chrome session cookie is HttpOnly and SameSite Strict',stored.cookies.some(c=>c.name==='ed_session_v2'&&c.httpOnly&&c.sameSite==='Strict'));
    await evaluate('document.querySelector(".auth-session-chip button").click()');
    await until('location.pathname==="/"&&document.querySelector(".keycloak-login")!==null');
    check('Chrome logout leaves auth API at 401',(await auth()).status===401);
    await call('Page.reload',{ignoreCache:true});
    await until('document.querySelector(".keycloak-login")!==null');
    check('Chrome F5 equivalent stays on login page',(await auth()).status===401);
    const revoked=await fetch(origin+'/api/auth',{headers:{Cookie:'ed_session_v2='+oldToken}});
    check('old Chrome session cannot be reused',revoked.status===401);
    currentEmail='bob@example.test';
    await evaluate('document.querySelector(".keycloak-login").click()');
    await until('document.querySelector(".auth-session-chip")!==null');
    const second=await auth();
    check('same Chrome profile logs into second Unicode account',second.status===200&&second.data.user.email==='bob@example.test'&&second.data.user.name==='José Peña — Producción');
    check('second account retains Produccion role',second.data.user.role==='produccion');
    const denied=await evaluate('fetch("/admin",{cache:"no-store"}).then(r=>r.status)');
    check('second account is still denied admin',denied===403);
    await evaluate('document.querySelector(".auth-session-chip button").click()');
    await until('document.querySelector(".keycloak-login")!==null');
    check('second account logs out',(await auth()).status===401);
    await writeFile(path.join(profile,'result.json'),JSON.stringify({ok:true,checks,events},null,2));
  }
}finally{
  ws?.close();
  if(browser.pid)spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
}
