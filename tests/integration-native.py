# Reproducible integration test against native Wrangler/Miniflare, using only disposable local state.
import secrets
import concurrent.futures
import http.cookiejar, json, os, pathlib, sqlite3, subprocess, sys, time, urllib.request, urllib.error, urllib.parse
root=pathlib.Path(__file__).resolve().parents[1]
os.chdir(root)
state=root/'outputs'/('integration-state-'+str(time.time_ns()))
state.mkdir(parents=True,exist_ok=True)
env=dict(os.environ,D1_STATE_DIR=str(state),KEYCLOAK_CLIENT_SECRET='fixture-only',WRANGLER_SEND_METRICS='false',WRANGLER_WRITE_LOGS='false',CLOUDFLARE_INCLUDE_PROCESS_ENV='true',X_LOCAL_EXPLORER='false',X_LOCAL_OBSERVABILITY='false',PORT='16680',HOST='127.0.0.1',INTERNAL_APP_PORT='16683')
origin='http://127.0.0.1:16680'
env['KEYCLOAK_PUBLIC_ORIGIN']=origin
env['ED_GATEWAY_SECRET']=secrets.token_urlsafe(32)
wrangler=['node','node_modules/wrangler/bin/wrangler.js']
results=[]
processes=[]
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args): return None
def client():
    jar=http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(jar),NoRedirect())
def request(c,path,method='GET',body=None,headers=None):
    h=dict(headers or {})
    if method!='GET':
        h.setdefault('Origin',origin)
        if body is not None:h['Content-Type']='application/json'
    data=json.dumps(body).encode() if body is not None else None
    req=urllib.request.Request(path if path.startswith('http') else origin+path,data=data,headers=h,method=method)
    try:r=c.open(req,timeout=20)
    except urllib.error.HTTPError as e:r=e
    raw=r.read()
    try:value=json.loads(raw)
    except:value=raw.decode(errors='replace')
    return r.status,r.headers,value
def check(name,condition,detail=''):
    results.append({'name':name,'ok':bool(condition),'detail':detail})
    print(('PASS ' if condition else 'FAIL ')+name,flush=True)
    if not condition:raise AssertionError(name+': '+str(detail))
def run(*args,ok=True):
    p=subprocess.run(args,env=env,capture_output=True,text=True,encoding='utf8',errors='replace')
    if ok and p.returncode:raise RuntimeError(p.stdout+p.stderr)
    return p
def start(command,log):
    handle=open(root/'outputs'/log,'w',encoding='utf8')
    p=subprocess.Popen(command,env=env,stdout=handle,stderr=subprocess.STDOUT)
    processes.append((p,handle))
    return p
def stop(p):
    if p.poll() is None:
        if os.name=='nt':subprocess.run(['taskkill','/PID',str(p.pid),'/T','/F'],capture_output=True)
        else:p.terminate();p.wait(timeout=15)
def wait():
    for _ in range(45):
        try:
            if request(client(),'/api/health')[0]==200:return
        except Exception:pass
        time.sleep(1)
    raise RuntimeError('App did not become healthy; inspect outputs/integration-app.log')
def login(email,mode='',tamper=False):
    c=client()
    status,h,_=request(c,'/api/auth/keycloak/login')
    check('OIDC authorization redirect '+email+mode,status==302)
    target=h['Location']+'&'+urllib.parse.urlencode({'test_user':email,'test_mode':mode})
    status,h,_=request(c,target)
    callback=h['Location']
    if tamper:callback=callback.replace('state=','state=wrong')
    status,h,_=request(c,callback)
    valid=not mode and not tamper
    check('OIDC callback '+email+mode+(' state tamper' if tamper else ''),status==302 and (('auth_success=1' in h['Location'])==valid),h['Location'])
    status,_,value=request(c,'/api/auth')
    check('OIDC session '+email+mode+(' state tamper' if tamper else ''),status==(200 if valid else 401),str(value))
    return c
try:
    # A new dedicated directory is required; reruns may retain only test fixture data.
    run(*wrangler,'d1','execute','site-creator-d1','--local','--config','wrangler.local.jsonc','--persist-to',str(state),'--command','SELECT 1')
    out=run(sys.executable,'tools/db-admin.py','migrate')
    check('migrations on local D1',out.returncode==0)
    out=run(sys.executable,'tools/db-admin.py','migrate')
    check('migration second run skips applied SQL','Applied ' not in out.stdout)
    info=json.loads(run(sys.executable,'tools/db-admin.py','inspect').stdout)
    dbpath=pathlib.Path(info['sqlite'])
    check('SQLite actual state path',state in dbpath.parents,info['sqlite'])
    with sqlite3.connect(dbpath) as db:
        # All test identities are corporate fixture identities. No production state is accessed.
        for role in ['administrador','jefe_operaciones','jefe_produccion','productor','operador','editor','produccion','visor']:
            email=('admin' if role=='administrador' else role)+'@example.test'
            db.execute("INSERT INTO users(email,name,program,role,active) VALUES (?,?,?, ?,1) ON CONFLICT(email) DO UPDATE SET role=excluded.role,active=1",(email,role,'TEST',role))
        db.commit()
    run(sys.executable,'tools/db-admin.py','admin','admin@example.test')
    bad=run(sys.executable,'tools/db-admin.py','admin',"evil@example.test'; DROP TABLE users;--",ok=False)
    check('bootstrap rejects SQL injection',bad.returncode!=0)
    config=json.loads((root/'dist/server/wrangler.json').read_text())
    config['vars']={'KEYCLOAK_ISSUER':'http://127.0.0.1:16681/realms/test','KEYCLOAK_CLIENT_ID':'ed-fixture','KEYCLOAK_PUBLIC_ORIGIN':origin,'LOCAL_AUTH_BYPASS':'false','DEPLOYMENT_MODE':'production','SEED_DEMO_DATA':'false'}
    config['secrets']={'required':['KEYCLOAK_CLIENT_SECRET','ED_GATEWAY_SECRET']}
    configfile=root/'dist/server/runtime-validation.json'
    configfile.write_text(json.dumps(config))
    fixture=start(['node','tests/oidc-fixture.mjs'],'integration-oidc.log')
    smtp=start(['node','tests/smtp-fixture.mjs'],'integration-smtp.log')
    relay=start(['node','tools/local-smtp-relay.mjs'],'integration-relay.log')
    appargs=wrangler+['dev','--local','--config',str(configfile),'--persist-to',str(state),'--ip','127.0.0.1','--port','16683','--inspector-port','0','--show-interactive-dev-session=false']
    gateway=start(['node','tools/http-gateway.mjs'],'integration-gateway.log')
    app=start(appargs,'integration-app.log')
    wait()
    check('Wrangler Explorer blocked',request(client(),'/cdn-cgi/local/explorer/api/d1/database')[0]==404)
    check('healthcheck binding DB',request(client(),'/api/health')[2].get('database')=='ok')
    check('identity spoofing blocked',request(client(),'/api/users',headers={'x-ed-user-role':'administrador','x-ed-user-email':'admin@example.test'})[0]==401)
    c=login('admin@example.test')
    status,_,value=request(c,'/api/schedule')
    check('schedule initially empty',status==200 and len(value['blocks'])==0,str(value))
    for mode in ['nonce','signature','expired','audience','subject','unverified']:login('invalid@example.test',mode)
    login('invalid@example.test',tamper=True)
    role_clients={}
    for role in ['jefe_produccion','productor','operador','editor','produccion','visor','jefe_operaciones']:
        rc=login(role+'@example.test');role_clients[role]=rc
        if role!='jefe_operaciones':
            for path in ['/api/metrics','/api/users','/api/smtp-settings','/admin']:
                check(role+' denied '+path,request(rc,path)[0]==403)
    check('operations cannot promote user',request(role_clients['jefe_operaciones'],'/api/users','PATCH',{'id':1,'role':'administrador'})[0]==403)
    check('CSRF blocked',request(c,'/api/programs','POST',{'name':'EVIL'},headers={'Origin':'http://evil.test'})[0]==403)
    program={'name':'TEST PROGRAM','color':'#4976BA'}
    status,_,value=request(c,'/api/programs','POST',program)
    check('program create',status==201,str(value))
    block={'program':'TEST PROGRAM','title':'Fixed test','resource':'radio','startTime':'08:00','endTime':'09:00','weekdays':'1,2,3,4,5','kind':'en vivo','color':'#4976BA'}
    status,_,value=request(c,'/api/schedule','POST',block)
    check('schedule create',status==201,str(value))
    block.update(id=value['block']['id'])
    status,_,value=request(c,'/api/schedule','PATCH',{**block,'title':'Fixed updated'})
    check('schedule update',status==200,str(value))
    payload={'title':'TEST','program':'TEST PROGRAM','locationType':'radio','date':'2026-11-09','startTime':'10:00','endTime':'10:30','requester':'Test','requesterEmail':'admin@example.test','crewDetail':''}
    status,_,value=request(c,'/api/reservations','POST',payload)
    check('reservation create',status==201,str(value))
    reservation=value['reservation'];rid=reservation['id']
    check('15 minute margin',request(c,'/api/reservations','POST',{**payload,'startTime':'10:35','endTime':'11:00'})[0]==409)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        duplicate={**payload,'startTime':'16:00','endTime':'16:30'}
        statuses=list(pool.map(lambda _:request(c,'/api/reservations','POST',duplicate)[0],range(2)))
    check('concurrent reservation admits exactly one writer',sorted(statuses)==[201,409],str(statuses))
    check('approve reservation',request(c,'/api/reservations','PATCH',{'id':rid,'action':'approve'})[0]==200)
    status,_,value=request(c,'/api/reservations','PATCH',{**payload,'id':rid,'startTime':'12:00','endTime':'12:30','rescheduleReason':'Otro','rescheduleDetail':'test reschedule'})
    check('reschedule reservation',status==200,str(value))
    status,_,value=request(c,'/api/reservations','DELETE',{'id':rid,'reason':'Otro','detail':'test cancel'})
    check('cancel reservation',status==200,str(value))
    status,_,value=request(c,'/api/logs')
    check('audit generated',status==200 and len(value['logs'])>=4,str(value))
    overlap={**payload,'startTime':'08:15','endTime':'08:45'}
    check('fixed schedule overlap requires confirmation',request(c,'/api/reservations','POST',overlap)[0]==409)
    status,_,value=request(c,'/api/reservations','POST',{**overlap,'allowFixedOverride':True})
    check('confirmed overlap can be requested',status==201,str(value))
    overlap_id=value['reservation']['id']
    check('producer cannot approve fixed overlap',request(role_clients['productor'],'/api/reservations','PATCH',{'id':overlap_id,'action':'approve'})[0]==403)
    check('Production Chief approves fixed overlap',request(role_clients['jefe_produccion'],'/api/reservations','PATCH',{'id':overlap_id,'action':'approve'})[0]==200)
    smtp_config={'host':'127.0.0.1','port':16682,'security':'none','authMode':'none','fromEmail':'admin@example.test','fromName':'Test application','recipients':'recipient@example.test','enabled':True}
    status,_,value=request(c,'/api/smtp-settings','PUT',smtp_config)
    check('SMTP configuration without invented credentials',status==200,str(value))
    status,_,value=request(c,'/api/smtp-settings','POST',{'testRecipient':'recipient@example.test'})
    check('notification sent through Node relay to local SMTP sink',status==200,str(value))
    check('SMTP authenticated cleartext rejected',request(c,'/api/smtp-settings','PUT',{**smtp_config,'authMode':'login','username':'test','password':'fixture-only'})[0]==400)
    status,_,value=request(c,'/api/metrics?month=2026-11')
    check('administrator metrics',status==200,str(value)[:300])
    status,_,value=request(c,'/api/auth','DELETE')
    check('logout federated endpoint',status==200 and '/logout?' in value.get('logoutUrl',''),str(value))
    check('logout revokes local session',request(c,'/api/auth')[0]==401)
    stop(app)
    app=start(appargs,'integration-app-restart.log');wait()
    c=login('admin@example.test')
    status,_,value=request(c,'/api/reservations')
    check('data persisted across process restart',status==200 and any(row['id']==rid for row in value['reservations']))
    backup=root/'outputs'/'integration-backup.sqlite'
    if backup.exists(): backup=root/'outputs'/('integration-backup-'+str(time.time_ns())+'.sqlite')
    run(sys.executable,'tools/db-admin.py','backup',str(backup))
    check('backup includes WAL committed records',sqlite3.connect(backup).execute('SELECT count(*) FROM reservations').fetchone()[0]>=2)
    stop(app)
    with sqlite3.connect(dbpath) as db:db.execute("UPDATE users SET name='modified after backup' WHERE email='admin@example.test'");db.commit()
    run(sys.executable,'tools/db-admin.py','restore',str(backup))
    with sqlite3.connect(dbpath) as db:
        check('restore recovers backup content',db.execute("SELECT name FROM users WHERE email='admin@example.test'").fetchone()[0]!='modified after backup')
    check('restored SQLite integrity',json.loads(run(sys.executable,'tools/db-admin.py','inspect').stdout)['integrity']=='ok')
finally:
    for p,h in reversed(processes):stop(p);h.close()
    (root/'outputs'/'integration-results.json').write_text(json.dumps(results,indent=2))
print('Integration checks passed:',len(results))
