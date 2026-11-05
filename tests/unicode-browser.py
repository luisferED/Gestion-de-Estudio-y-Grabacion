# Focused real D1/HTTP logout test with two synthetic identities, no reservation writes.
import secrets
import base64,hashlib,http.client,http.cookiejar,json,os,pathlib,sqlite3,subprocess,sys,tempfile,time,urllib.request,urllib.error,urllib.parse
root=pathlib.Path(__file__).resolve().parents[1]
os.chdir(root)
work=pathlib.Path(tempfile.mkdtemp(prefix='logout-',dir=root/'outputs'))
state=work/'state'
origin='http://127.0.0.1:18780'
issuer='http://localhost:18781/realms/test'
env=dict(os.environ,PYTHONUTF8='1',D1_STATE_DIR=str(state),KEYCLOAK_CLIENT_SECRET='fixture-only',WRANGLER_SEND_METRICS='false',WRANGLER_WRITE_LOGS='false',CLOUDFLARE_INCLUDE_PROCESS_ENV='true',X_LOCAL_EXPLORER='false',X_LOCAL_OBSERVABILITY='false',PORT='18780',HOST='127.0.0.1',INTERNAL_APP_PORT='18783',TEST_ISSUER=issuer,TEST_OIDC_PORT='18781',TEST_PUBLIC_ORIGIN=origin,TEST_SSO='true')
env['KEYCLOAK_PUBLIC_ORIGIN']=origin
env['ED_GATEWAY_SECRET']=secrets.token_urlsafe(32)
wrangler=['node','node_modules/wrangler/bin/wrangler.js']
checks=[];processes=[]
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args):return None
class LocalTLSProxy(urllib.request.HTTPSHandler):
    def https_open(self,req):
        if req.host!='grabaciones.ed':raise AssertionError('Unexpected external HTTPS request')
        return self.do_open(lambda _host,**kw:http.client.HTTPConnection('127.0.0.1',18780,timeout=kw.get('timeout',15)),req)
def client():
    jar=http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(jar),LocalTLSProxy(),NoRedirect()),jar
def request(c,url,method='GET',headers=None):
    h=dict(headers or {})
    if method!='GET':
        h.setdefault('Origin',origin);h.setdefault('Referer',origin+'/');h.setdefault('Content-Type','application/json')
    if url.startswith('http://grabaciones.ed/'):url='https://'+url[len('http://'):]
    req=urllib.request.Request(url if url.startswith('http') else origin+url,data=b'{}' if method!='GET' else None,headers=h,method=method)
    try:r=c.open(req,timeout=15)
    except urllib.error.HTTPError as e:r=e
    raw=r.read()
    try:value=json.loads(raw)
    except:value=raw.decode(errors='replace')
    return r.status,r.headers,value
def check(name,ok):
    if not ok:raise AssertionError(name)
    checks.append(name);print('PASS '+name,flush=True)
def run(args):
    p=subprocess.run(args,env=env,capture_output=True,text=True,encoding='utf8',errors='replace',timeout=45)
    if p.returncode:raise RuntimeError(p.stdout+p.stderr)
    return p.stdout
def start(command,name):
    handle=open(work/name,'w',encoding='utf8')
    p=subprocess.Popen(command,env=env,stdout=handle,stderr=subprocess.STDOUT)
    processes.append((p,handle));return p
def session_key(token):return 'sha256:'+base64.urlsafe_b64encode(hashlib.sha256(token.encode()).digest()).decode().rstrip('=')
try:
    run(wrangler+['d1','execute','site-creator-d1','--local','--config','wrangler.local.jsonc','--persist-to',str(state),'--command','SELECT 1'])
    run([sys.executable,'tools/db-admin.py','migrate'])
    info=json.loads(run([sys.executable,'tools/db-admin.py','inspect']));dbpath=pathlib.Path(info['sqlite'])
    with sqlite3.connect(dbpath) as db:
        db.execute("INSERT INTO users(email,name,program,role,active) VALUES ('alice@example.test','María Muñoz','TEST','administrador','true')")
        db.execute("INSERT INTO users(email,name,program,role,active) VALUES ('bob@example.test','José Peña — Producción','TEST','produccion',1)")
        db.commit()
    config=json.loads((root/'dist/server/wrangler.json').read_text(encoding='utf8'))
    config['vars']={'KEYCLOAK_ISSUER':issuer,'KEYCLOAK_CLIENT_ID':'grabaciones','KEYCLOAK_PUBLIC_ORIGIN':origin,'LOCAL_AUTH_BYPASS':'false','DEPLOYMENT_MODE':'production','SEED_DEMO_DATA':'false'}
    config['secrets']={'required':['KEYCLOAK_CLIENT_SECRET','ED_GATEWAY_SECRET']}
    configfile=root/'dist/server/runtime-logout-test.json';configfile.write_text(json.dumps(config),encoding='utf8')
    start(['node','tests/oidc-fixture.mjs'],'oidc.log')
    start(['node','tools/http-gateway.mjs'],'gateway.log')
    start(wrangler+['dev','--local','--config',str(configfile),'--persist-to',str(state),'--ip','127.0.0.1','--port','18783','--inspector-port','0','--show-interactive-dev-session=false'],'app.log')
    c,jar=client()
    for attempt in range(30):
        try:
            if request(c,'/api/health')[0]==200:break
        except Exception:pass
        time.sleep(0.5)
    else:raise RuntimeError('Test app failed to start: '+str(work))

    print(run(['node','tests/browser-session-flow.mjs',origin,str(work/'chrome'),'verify']),flush=True)
    result=json.loads((work/'chrome/result.json').read_text(encoding='utf8'))
    checks.extend(result['checks'])

finally:
    for p,h in reversed(processes):
        if p.poll() is None:
            if os.name=='nt':subprocess.run(['taskkill','/PID',str(p.pid),'/T','/F'],capture_output=True)
            else:p.terminate();p.wait(timeout=15)
        h.close()
    (work/'results.json').write_text(json.dumps({'passed':len(checks),'checks':checks},indent=2),encoding='utf8')
print('Chrome session checks passed:',len(checks),'Evidence:',work)
