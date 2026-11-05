import {spawn,spawnSync} from 'node:child_process';
import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const [origin,profile,mode='verify']=process.argv.slice(2);
await mkdir(profile,{recursive:true});
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const pending=new Map(),checks=[],events=[];let ws,seq=0,email='alice@example.test',phase='initial';
function check(name,value){if(!value)throw Error(name);checks.push(name);console.log('PASS '+name)}
async function localResponse(request){
  const url=new URL(request.url),headers={...request.headers,Host:url.host};
  delete headers['Content-Length'];delete headers['content-length'];
  const body=request.postData||'';
  if(body)headers['Content-Length']=String(Buffer.byteLength(body));
  return new Promise((resolve,reject)=>{
    const upstream=http.request({hostname:'127.0.0.1',port:18780,path:url.pathname+url.search,method:request.method,headers},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{
        const responseHeaders=[];
        for(let i=0;i<res.rawHeaders.length;i+=2)if(!['connection','transfer-encoding'].includes(res.rawHeaders[i].toLowerCase()))responseHeaders.push({name:res.rawHeaders[i],value:res.rawHeaders[i+1]});
        resolve({responseCode:res.statusCode,responseHeaders,body:Buffer.concat(chunks).toString('base64')});
      });
    });upstream.on('error',reject);if(body)upstream.write(body);upstream.end();
  });
}
try{
  let port;
  for(let i=0;i<60;i++){try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split(String.fromCharCode(10))[0]);break}catch{await pause(100)}}
  if(!port)throw Error('Isolated Chrome did not start');
  const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
  ws.addEventListener('message',event=>{
    const m=JSON.parse(event.data);
    if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(m.error.message)):p?.resolve(m.result);return}
    if(m.method==='Fetch.requestPaused'){
      (async()=>{
        const request=m.params.request,url=new URL(request.url);
        if(url.hostname==='localhost'){
          url.searchParams.set('test_user',email);
          await call('Fetch.continueRequest',{requestId:m.params.requestId,url:url.href});return;
        }
        if(url.hostname!=='grabaciones.ed')throw Error('Unexpected destination');
        // Simulated Traefik: redirect HTTP to HTTPS; HTTPS terminates at the local gateway.
        // Chrome performs its own cookie selection. Never inject cookies or rewrite Location.
        const response=url.protocol==='http:'
          ?{responseCode:301,responseHeaders:[{name:'Location',value:origin+url.pathname+url.search}],body:''}
          :await localResponse(request);
        const cookieHeader=Object.entries(request.headers).find(([k])=>k.toLowerCase()==='cookie')?.[1]||'';
        if(['/', '/admin','/api/auth','/api/auth/keycloak/callback'].includes(url.pathname)){
          const location=response.responseHeaders.find(h=>h.name.toLowerCase()==='location')?.value;
          events.push({phase,scheme:url.protocol,path:url.pathname,method:request.method,status:response.responseCode,
            cookieNames:cookieHeader.split(';').map(x=>x.trim().split('=')[0]).filter(Boolean),
            ...(location?{location:location.split('?')[0]}:{})});
        }
        await call('Fetch.fulfillRequest',{requestId:m.params.requestId,...response});
      })().catch(async error=>{console.error('Interception:',error.message);await call('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'Failed'}).catch(()=>{})});
    }
    if(m.method==='Network.requestWillBeSentExtraInfo'){
      for(const c of m.params.associatedCookies||[])if(c.cookie.name==='ed_session_v2'&&c.blockedReasons.length)events.push({phase,blocked:c.blockedReasons});
    }
  });
  await call('Page.enable');await call('Network.enable');
  await call('Fetch.enable',{patterns:[
    {urlPattern:'https://grabaciones.ed/*',requestStage:'Request'},
    {urlPattern:'http://grabaciones.ed/*',requestStage:'Request'},
    {urlPattern:'http://localhost:18781/realms/test/authorize*',requestStage:'Request'},
  ]});
  const evaluate=async expression=>{
    const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw Error('Browser expression failed');
    return result.result.value;
  };
  const until=async expression=>{
    for(let i=0;i<100;i++){try{if(await evaluate(expression))return}catch{}await pause(100)}
    throw Error('Browser did not reach '+expression);
  };
  const auth=()=>evaluate('fetch("/api/auth",{credentials:"same-origin",cache:"no-store"}).then(async r=>({status:r.status,data:await r.json()}))');
  await call('Page.navigate',{url:origin+'/'});
  await until('document.querySelector(".keycloak-login")!==null');
  for(const [i,account] of ['alice@example.test','bob@example.test','alice@example.test'].entries()){
    email=account;phase='login-'+i;
    await evaluate('document.querySelector(".keycloak-login").click()');
    const destination='/';
    await until('location.pathname==='+JSON.stringify(destination)+'&&document.readyState==="complete"');
    const first=events.find(e=>e.phase===phase&&e.scheme==='https:'&&e.path===destination&&e.method==='GET');
    if(mode==='baseline'&&i===1){
      console.log('BASELINE '+JSON.stringify({first,events:events.filter(e=>e.phase===phase)}));
      const after=await auth();console.log('AUTH_AFTER_DOCUMENT '+JSON.stringify({status:after.status,email:after.data.user?.email}));
      await writeFile(path.join(profile,'baseline.json'),JSON.stringify({first,afterStatus:after.status,events},null,2));
      break;
    }
    check(account+' first destination response is 200',first?.status===200);
    check(account+' callback first lands on the calendar',destination==='/'&&first?.path==='/');
    await until('document.querySelector(".auth-session-chip button")!==null');
    const current=await auth();
    check(account+' correct identity on first login',current.status===200&&current.data.user.email===account);
    check(account+' existing role is preserved',current.data.user.role===(account.startsWith('bob')?'administrador':'produccion'));
    if(account.startsWith('bob')){
      await evaluate('Array.from(document.querySelectorAll(".top-actions button")).find(button=>button.textContent.trim()==="Dashboard").click()');
      await until('location.pathname==="/admin"&&document.readyState==="complete"');
      const admin=events.find(e=>e.phase===phase&&e.scheme==='https:'&&e.path==='/admin'&&e.method==='GET');
      check('administrator Dashboard button opens the real panel',admin?.status===200);
      check('explicit admin navigation already carries the session',admin?.cookieNames.includes('ed_session_v2'));
      check('admin panel keeps the correct logged-in account',(await auth()).data.user?.email===account);
      await evaluate(`window.adminScroll=()=>{const a=document.querySelector('.admin-nav');return getComputedStyle(a).overflowY==='auto'?a:document.querySelector('.admin-nav-scroll')}`);
      for(const [width,height,label] of [[1280,500,'100%'],[1024,400,'125% equivalent viewport'],[853,333,'150% equivalent viewport'],[390,420,'mobile'],[390,260,'short mobile']]){
        await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const bounds=await evaluate(`(()=>{const e=document.querySelector('.admin-nav'),s=window.adminScroll();return {bottom:e.getBoundingClientRect().bottom,height:innerHeight,top:e.getBoundingClientRect().top,overflow:s.scrollHeight>s.clientHeight}})()`);
        console.log('BOUNDS',label,JSON.stringify(bounds));
        check(label+' sidebar stays within viewport',bounds.bottom<=bounds.height+1&&bounds.overflow);
        await evaluate('window.adminScroll().scrollTop=0');
        const point=await evaluate(`(()=>{const r=window.adminScroll().getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+30}})()`);
        await call('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:600});
        await until('window.adminScroll().scrollTop>0');
        check(label+' mouse wheel scrolls navigation',await evaluate('window.adminScroll().scrollTop>0'));
        for(const text of ['Usuarios','Correo SMTP','Métricas']){
          const target=await evaluate(`(()=>{const b=Array.from(document.querySelectorAll('.admin-nav nav button')).find(b=>b.textContent.endsWith(${JSON.stringify(text)}));b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,unblocked:b.contains(document.elementFromPoint(x,y)),disabled:b.disabled}})()`);
          check(label+' '+text+' is clickable',target.unblocked&&!target.disabled);
          await call('Input.dispatchMouseEvent',{type:'mousePressed',x:target.x,y:target.y,button:'left',clickCount:1});
          await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:target.x,y:target.y,button:'left',clickCount:1});
          await until('document.querySelector(".admin-head h1").textContent==='+JSON.stringify(text));
        }
        check(label+' return to agenda reachable',await evaluate(`(()=>{const a=document.querySelector('.nav-foot a');a.scrollIntoView({block:'nearest'});const r=a.getBoundingClientRect();return r.height>0&&a.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`));
      }
      await call('Emulation.clearDeviceMetricsOverride');

      await until('document.querySelector(".auth-session-chip button")!==null');
    }else{
      const denied=await evaluate('fetch("/admin",{cache:"no-store",redirect:"manual"}).then(response=>response.status)');
      check('Produccion is still forbidden from the administrative panel',denied===403);
    }

    const callback=events.find(e=>e.phase===phase&&e.path==='/api/auth/keycloak/callback');
    if(mode!=='baseline'){
      check(account+' callback keeps public HTTPS scheme',callback?.location?.startsWith(origin));
      check(account+' no HTTP downgrade in the login redirect chain',!events.some(e=>e.phase===phase&&e.scheme==='http:'));
    }
    const cookie=(await call('Network.getCookies',{urls:[origin]})).cookies.find(c=>c.name==='ed_session_v2');
    check(account+' cookie remains Secure HttpOnly Strict',cookie?.secure&&cookie.httpOnly&&cookie.sameSite==='Strict');
    phase='logout-'+i;
    await evaluate('document.querySelector(".auth-session-chip button").click()');
    await until('location.pathname==="/"&&document.querySelector(".keycloak-login")!==null');
    check(account+' logout invalidates session',(await auth()).status===401);
    const rejected=await evaluate('fetch("/api/reservations",{cache:"no-store"}).then(r=>r.status)');
    check(account+' protected API rejects logged-out browser',rejected===401);
    // Explicit requested F5 test, never a production recovery mechanism.
    await call('Page.reload',{ignoreCache:true});
    await until('document.querySelector(".keycloak-login")!==null');
    check(account+' F5 after logout stays disconnected',(await auth()).status===401);
  }
  if(mode!=='baseline'){
    phase='direct-admin';
    await call('Page.navigate',{url:origin+'/admin'});
    await until('location.pathname==="/"&&document.querySelector(".keycloak-login")!==null');
    const direct=events.find(e=>e.phase===phase&&e.path==='/admin');
    check('direct admin without a session returns a web redirect',direct?.status===302);
    check('direct admin redirect does not authenticate',(await auth()).status===401);
    await writeFile(path.join(profile,'result.json'),JSON.stringify({ok:true,checks,events},null,2));
  }
}finally{
  ws?.close();
  if(browser.pid)spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
}
