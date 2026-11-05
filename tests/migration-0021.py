from pathlib import Path
import hashlib,json,os,shutil,sqlite3,subprocess,sys,tempfile
root=Path(__file__).resolve().parents[1]
work=Path(tempfile.mkdtemp(prefix='migration-0021-',dir=root/'outputs'))
env=dict(os.environ,PYTHONUTF8='1',WRANGLER_SEND_METRICS='false',WRANGLER_WRITE_LOGS='false',X_LOCAL_EXPLORER='false',X_LOCAL_OBSERVABILITY='false')
checks=[]
def check(name,ok):
    if not ok:raise AssertionError(name)
    checks.append(name);print('PASS '+name,flush=True)
def run(args,cwd=root):
    p=subprocess.run(args,cwd=cwd,env=env,capture_output=True,text=True,encoding='utf8',errors='replace',timeout=60)
    if p.returncode:raise RuntimeError(p.stdout+chr(10)+p.stderr)
    return p.stdout
approved=json.loads((root/'tools/migrations-approved.json').read_text(encoding='utf8'))
check('all SQL hashes approved',all(approved[file.name]==hashlib.sha256(file.read_text(encoding='utf8').encode()).hexdigest() for file in (root/'drizzle').glob('*.sql')))
for kind in ['existing','fresh']:
    project=work/kind
    (project/'drizzle').mkdir(parents=True)
    (project/'tools').mkdir()
    state=project/'state';env['D1_STATE_DIR']=str(state)
    run(['node',str(root/'node_modules/wrangler/bin/wrangler.js'),'d1','execute','site-creator-d1','--local','--config',str(root/'wrangler.local.jsonc'),'--persist-to',str(state),'--command','SELECT 1'])
    subset={name:digest for name,digest in approved.items() if kind=='fresh' or not name.startswith('0021_')}
    for name in subset:shutil.copy2(root/'drizzle'/name,project/'drizzle'/name)
    (project/'tools/migrations-approved.json').write_text(json.dumps(subset),encoding='utf8')
    run([sys.executable,str(root/'tools/db-admin.py'),'migrate'],cwd=project)
    info=json.loads(run([sys.executable,str(root/'tools/db-admin.py'),'inspect'],cwd=project));dbpath=Path(info['sqlite'])
    check(kind+' initialization uses expected state',state in dbpath.parents)
    if kind=='existing':
        with sqlite3.connect(dbpath) as db:
            for title,start,end in [('legacy-a','08:00','09:00'),('legacy-b','08:30','09:30')]:
                db.execute("INSERT INTO reservations(title,program,location_type,date,start_time,end_time,requester,requester_email,status) VALUES (?, 'TEST','radio','2026-12-01',?,?, 'Fixture','fixture@example.test','pendiente')",(title,start,end))
            db.commit();before=db.execute('SELECT * FROM reservations ORDER BY id').fetchall()
        shutil.copy2(root/'drizzle/0021_reservation_concurrency.sql',project/'drizzle/0021_reservation_concurrency.sql')
        (project/'tools/migrations-approved.json').write_text(json.dumps(approved),encoding='utf8')
        run([sys.executable,str(root/'tools/db-admin.py'),'migrate'],cwd=project)
        with sqlite3.connect(dbpath) as db:check('existing fields unchanged by migration',before==db.execute('SELECT * FROM reservations ORDER BY id').fetchall())
        check('pre-migration backup exists',bool(list((project/'backups').glob('before-migration-*.sqlite'))))
    with sqlite3.connect(dbpath) as db:
        check(kind+' has 22 applied migrations',db.execute('SELECT count(*) FROM ed_migrations').fetchone()[0]==22)
        check(kind+' has both triggers',db.execute("SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'reservations_no_overlap_%'").fetchone()[0]==2)
        if kind=='fresh':check('fresh reservations empty',db.execute('SELECT count(*) FROM reservations').fetchone()[0]==0)
    check(kind+' rerun idempotent','Applied ' not in run([sys.executable,str(root/'tools/db-admin.py'),'migrate'],cwd=project))
    if kind=='existing':print(run(['node',str(root/'tests/migration-0021-d1.mjs'),str(state)]),flush=True)
(work/'result.json').write_text(json.dumps({'ok':True,'initialization_checks':len(checks),'checks':checks},indent=2),encoding='utf8')
print('Focused tests passed. Evidence:',work)
