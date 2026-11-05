# Focused real D1/HTTP logout test with two synthetic identities, no reservation writes.
import base64,hashlib,http.cookiejar,json,os,pathlib,sqlite3,subprocess,sys,tempfile,time,urllib.request,urllib.error,urllib.parse
root=pathlib.Path(__file__).resolve().parents[1]
os.chdir(root)
work=pathlib.Path(tempfile.mkdtemp(prefix='logout-',dir=root/'outputs'))
state=work/'state'
origin='http://127.0.0.1:18780'
issuer='http://127.0.0.1:18781/realms/test'
env=dict(os.environ,PYTHONUTF8='1',D1_STATE_DIR=str(state),KEYCLOAK_CLIENT_SECRET='fixture-only',WRANGLER_SEND_METRICS='false',WRANGLER_WRITE_LOGS='false',CLOUDFLARE_INCLUDE_PROCESS_ENV='true',X_LOCAL_EXPLORER='false',X_LOCAL_OBSERVABILITY='false',PORT='18780',HOST='127.0.0.1',INTERNAL_APP_PORT='18783',TEST_ISSUER=issuer,TEST_OIDC_PORT='18781',TEST_PUBLIC_ORIGIN=origin,TEST_SSO='true')
wrangler=['node','node_modules/wrangler/bin/wrangler.js']
checks=[];processes=[]
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args):return None
def client():
    jar=http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(jar),NoRedirect()),jar
def request(c,url,method='GET',headers=None):
    h=dict(headers or {})
    if method!='GET':h.update({'Origin':origin,'Content-Type':'application/json'})
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
    config=json.loads((root/'dist/server/wrangler.json').read_text(encoding='utf8'))
    config['vars']={'KEYCLOAK_ISSUER':issuer,'KEYCLOAK_CLIENT_ID':'grabaciones','KEYCLOAK_PUBLIC_ORIGIN':origin,'LOCAL_AUTH_BYPASS':'false','DEPLOYMENT_MODE':'production','SEED_DEMO_DATA':'false'}
    config['secrets']={'required':['KEYCLOAK_CLIENT_SECRET']}
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
    check('initial browser has no local session',request(c,'/api/auth')[0]==401)
    revoked=[]
    for email in ['alice@example.test','bob@example.test']:
        status,h,_=request(c,'/api/auth/keycloak/login')
        check(email+' login starts',status==302)
        auth_url=h['Location']
        q=urllib.parse.parse_qs(urllib.parse.urlparse(auth_url).query)
        check(email+' asks for fresh login',q.get('prompt')==['login'] and q.get('max_age')==['0'])
        status,h,_=request(c,auth_url+'&'+urllib.parse.urlencode({'test_user':email}))
        status,h,_=request(c,h['Location'])
        check(email+' callback succeeds',status==302 and 'auth_success=1' in h['Location'])
        status,h,user=request(c,'/api/auth')
        check(email+' authenticated as correct identity',status==200 and user['user']['email']==email)
        check(email+' auth response never cached','no-store' in h.get('Cache-Control',''))
        token=next(cookie.value for cookie in jar if cookie.name=='ed_session_v2')
        check(email+' API accepts active session',request(c,'/api/reservations')[0]==200)
        check(email+' provider SSO exists',request(c,issuer+'/session')[2]['authenticated'])
        with sqlite3.connect(dbpath) as db:
            row=db.execute('SELECT id_token_hint,end_session_endpoint FROM auth_sessions WHERE token=?',(session_key(token),)).fetchone()
        check(email+' logout context stored server side',bool(row and row[0] and row[1]==issuer+'/protocol/openid-connect/logout'))
        status,h,result=request(c,'/api/auth','DELETE')
        check(email+' logout succeeds only after revocation',status==200 and result['ok'] is True)
        with sqlite3.connect(dbpath) as db:
            check(email+' local session removed from SQLite',db.execute('SELECT count(*) FROM auth_sessions WHERE token=?',(session_key(token),)).fetchone()[0]==0)
        check(email+' browser session cookie removed',not any(cookie.name=='ed_session_v2' for cookie in jar))
        check(email+' response clears all local auth cookies',all(any(value.startswith(name+'=') and 'Max-Age=0' in value for value in h.get_all('Set-Cookie',[])) for name in ['ed_session_v2','ed_session','ed_oidc_state','ed_oidc_nonce','ed_oidc_verifier']))
        logout_url=result['logoutUrl'];parsed=urllib.parse.urlparse(logout_url);query=urllib.parse.parse_qs(parsed.query)
        check(email+' redirects to discovered official endpoint',parsed.scheme+'://'+parsed.netloc+parsed.path==issuer+'/protocol/openid-connect/logout')
        check(email+' passes own id_token_hint and correct return URL',query.get('id_token_hint')==[row[0]] and query.get('client_id')==['grabaciones'] and query.get('post_logout_redirect_uri')==[origin+'/'])
        status,h,_=request(c,logout_url)
        check(email+' SSO endpoint returns to application root',status==302 and h['Location']==origin+'/')
        check(email+' SSO session and cookie cleared',not request(c,issuer+'/session')[2]['authenticated'] and not any(cookie.name=='fixture_sso' for cookie in jar))
        for repeat in range(3):
            check(email+' refresh '+str(repeat+1)+' remains logged out',request(c,'/')[0]==200 and request(c,'/api/auth')[0]==401)
        old,_=client()
        check(email+' old token rejected by auth API',request(old,'/api/auth',headers={'Cookie':'ed_session_v2='+token})[0]==401)
        check(email+' old token rejected by protected API',request(old,'/api/reservations',headers={'Cookie':'ed_session_v2='+token})[0]==401)
        revoked.append(token)
    old,_=client()
    check('first user token remains revoked after second login/logout',request(old,'/api/reservations',headers={'Cookie':'ed_session_v2='+revoked[0]})[0]==401)
    with sqlite3.connect(dbpath) as db:
        check('both test users retained',db.execute("SELECT count(*) FROM users WHERE email IN ('alice@example.test','bob@example.test')").fetchone()[0]==2)
        check('no reservations created or changed',db.execute('SELECT count(*) FROM reservations').fetchone()[0]==0)
        check('all tested sessions invalidated',db.execute('SELECT count(*) FROM auth_sessions').fetchone()[0]==0)
finally:
    for p,h in reversed(processes):
        if p.poll() is None:
            if os.name=='nt':subprocess.run(['taskkill','/PID',str(p.pid),'/T','/F'],capture_output=True)
            else:p.terminate();p.wait(timeout=15)
        h.close()
    (work/'results.json').write_text(json.dumps({'passed':len(checks),'checks':checks},indent=2),encoding='utf8')
print('Focused logout integration passed:',len(checks),'checks. Evidence:',work)
