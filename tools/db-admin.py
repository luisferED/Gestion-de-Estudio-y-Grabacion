#!/usr/bin/env python3
import argparse, hashlib, json, os, re, sqlite3, sys
if os.name=="nt": import msvcrt
else: import fcntl
from pathlib import Path
from datetime import datetime, timezone

os.umask(0o077)
state = Path(os.environ.get('D1_STATE_DIR', '/data/state')).resolve()
def database():
    # Wrangler's D1 namespace contains one SQLite database for this application.
    paths = list((state / 'v3' / 'd1').rglob('*.sqlite')) if (state/'v3'/'d1').exists() else list((state/'d1').rglob('*.sqlite'))
    paths=[p for p in paths if re.fullmatch(r'[0-9a-f]{64}\.sqlite',p.name)]
    if len(paths) != 1:
        raise SystemExit('Expected exactly one D1 SQLite file; found: '+str(paths))
    return paths[0]
def offline():
    state.mkdir(parents=True, exist_ok=True)
    lock = open(state/'.runtime.lock','a')
    try:
        if os.name=="nt":
            lock.seek(0); msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (BlockingIOError, OSError): raise SystemExit('Stop the application first; state is locked.')
    return lock
def connect(path):
    db=sqlite3.connect(path, timeout=30)
    db.execute('PRAGMA foreign_keys=ON')
    return db
def integrity(db):
    if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
        raise SystemExit('SQLite integrity check failed')
    if db.execute('PRAGMA foreign_key_check').fetchall():
        raise SystemExit('Foreign key check failed')
p=argparse.ArgumentParser()
p.add_argument('action',choices=['migrate','inspect','backup','restore','admin'])
p.add_argument('value',nargs='?')
a=p.parse_args()
lock=None
if a.action in ('restore','admin') or (a.action=='migrate' and os.environ.get('ED_RUNTIME_LOCKED')!='1'): lock=offline()
path=database()
if a.action=='restore':
    if not a.value: raise SystemExit('Supply a backup path')
    source=Path(a.value).resolve()
    if source==path: raise SystemExit('Source must differ from destination')
    if not source.is_file(): raise SystemExit('Backup does not exist')
    with sqlite3.connect('file:'+str(source)+'?mode=ro',uri=True) as src:
        integrity(src)
        required={'users','reservations','ed_migrations','auth_sessions'}
        names={row[0] for row in src.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not required.issubset(names): raise SystemExit('This is not a compatible application backup')
        approved=json.loads(Path('tools/migrations-approved.json').read_text(encoding='utf8'))
        for name,digest in src.execute('SELECT name,sha256 FROM ed_migrations'):
            if approved.get(name)!=digest: raise SystemExit('Backup migration history is incompatible with this image')
        # Preserve a consistent recovery copy before replacing database contents.
        recovery=state.parent/'backups'/('before-restore-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.sqlite')
        recovery.parent.mkdir(parents=True, exist_ok=True)
        with connect(path) as old, connect(recovery) as dest: old.backup(dest)
        with connect(path) as dest: src.backup(dest); integrity(dest)
    print('Restored; recovery copy:',recovery)
else:
    with connect(path) as db:
        if a.action=='migrate':
            files=sorted(Path('drizzle').glob('*.sql'))
            # Preflight all pending migrations before making any schema change.
            db.execute('CREATE TABLE IF NOT EXISTS ed_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)')
            applied=dict(db.execute('SELECT name,sha256 FROM ed_migrations'))
            approved=json.loads(Path('tools/migrations-approved.json').read_text(encoding='utf8'))
            if set(approved)!={file.name for file in files}: raise SystemExit('Approved migration set differs from files in this image')
            if set(applied)-{file.name for file in files}: raise SystemExit('An applied migration is missing from this image')
            for file in files:
                sql=file.read_text(encoding='utf8')
                digest=hashlib.sha256(sql.encode()).hexdigest()
                if approved.get(file.name)!=digest: raise SystemExit('Migration requires explicit review and approval in tools/migrations-approved.json: '+file.name)
                if file.name in applied and applied[file.name]!=digest: raise SystemExit('Applied migration was changed: '+file.name)
                if file.name not in applied and re.search(r'\b(DROP|DELETE|TRUNCATE|REPLACE)\b',re.sub(r'--[^\n]*','',sql),re.I):
                    raise SystemExit('Destructive migration requires manual review: '+file.name)
            if any(file.name not in applied for file in files) and db.execute("SELECT name FROM sqlite_master WHERE name='users'").fetchone():
                before=state.parent/'backups'/('before-migration-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.sqlite')
                before.parent.mkdir(parents=True,exist_ok=True)
                with connect(before) as dest: db.backup(dest); integrity(dest)
                print('Pre-migration backup:',before)
            for file in files:
                if file.name in applied: continue
                sql=file.read_text(encoding='utf8')
                digest=hashlib.sha256(sql.encode()).hexdigest()
                statements=[]
                current=''
                for line in sql.splitlines(True):
                    current+=line
                    if sqlite3.complete_statement(current):
                        statements.append(current); current=''
                if current.strip() and not current.strip().startswith('--'): raise SystemExit('Incomplete SQL: '+file.name)
                db.execute('BEGIN IMMEDIATE')
                try:
                    for statement in statements: db.execute(statement)
                    db.execute('INSERT INTO ed_migrations(name,sha256) VALUES (?,?)',(file.name,digest))
                    db.commit()
                except: db.rollback(); raise
                print('Applied',file.name)
            integrity(db)
            print('Migrations current:',len(files))
        elif a.action=='inspect':
            integrity(db)
            print(json.dumps({'sqlite':str(path),'integrity':'ok','migrations':db.execute('SELECT count(*) FROM ed_migrations').fetchone()[0]}))
        elif a.action=='admin':
            email=(a.value or '').strip().lower()
            if len(email)>254 or not re.fullmatch(r'[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+',email): raise SystemExit('Invalid corporate email')
            matches=db.execute('SELECT id FROM users WHERE lower(email)=?',(email,)).fetchall()
            if len(matches)>1: raise SystemExit('Ambiguous duplicate email')
            if matches: db.execute("UPDATE users SET role='administrador',active=1 WHERE id=?",(matches[0][0],))
            else: db.execute("INSERT INTO users(email,name,program,role,active) VALUES (?,?,?,'administrador',1)",(email,email.split('@')[0],'OPERACIONES'))
            db.commit()
            print('Administrator assigned:',email)
        elif a.action=='backup':
            destination=Path(a.value or ('/data/backups/gestion-ed-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.sqlite')).resolve()
            if destination==path or destination.exists(): raise SystemExit('Destination must be new and different from live database')
            destination.parent.mkdir(parents=True,exist_ok=True)
            with connect(destination) as dest: db.backup(dest); integrity(dest)
            os.chmod(destination,0o600)
            print('Consistent SQLite backup:',destination)
