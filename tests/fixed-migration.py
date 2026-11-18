from pathlib import Path
from contextlib import closing
import hashlib,json,os,shutil,sqlite3,subprocess,sys,tempfile,unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from fixed_override_migration import apply_migration_statement
NEW='0023_fixed_schedule_overrides.sql'

class MigrationTests(unittest.TestCase):
    def setUp(self):
        (ROOT/'outputs').mkdir(exist_ok=True)
        self.work=Path(tempfile.mkdtemp(prefix='fixed-migration-',dir=ROOT/'outputs')).resolve()
    def tearDown(self):
        assert self.work.parent==(ROOT/'outputs').resolve()
        assert self.work.name.startswith('fixed-migration-')
        shutil.rmtree(self.work)
    def project(self,manual=None):
        project=self.work/'project';(project/'drizzle').mkdir(parents=True);(project/'tools').mkdir()
        for file in (ROOT/'drizzle').glob('*.sql'):shutil.copyfile(file,project/'drizzle'/file.name)
        shutil.copyfile(ROOT/'tools/migrations-approved.json',project/'tools/migrations-approved.json')
        state=project/'state';folder=state/'v3/d1/fixture';folder.mkdir(parents=True)
        dbpath=folder/('a'*64+'.sqlite')
        approved=json.loads((ROOT/'tools/migrations-approved.json').read_text())
        with closing(sqlite3.connect(dbpath)) as db:
            for file in sorted((ROOT/'drizzle').glob('*.sql')):
                if file.name!=NEW:db.executescript(file.read_text(encoding='utf-8'))
            db.execute('CREATE TABLE ed_migrations(name text PRIMARY KEY,sha256 text NOT NULL)')
            db.executemany('INSERT INTO ed_migrations VALUES (?,?)',[(n,h) for n,h in approved.items() if n!=NEW])
            db.execute("INSERT INTO reservations(title,program,location_type,date,start_time,end_time,requester,requester_email) VALUES ('PRESERVE','TEST','radio','2026-11-18','08:00','09:00','F','fixture@example.test')")
            db.execute("INSERT INTO auth_sessions(token,user_email,expires_at,id_token_hint,end_session_endpoint) VALUES ('KEEP','fixture@example.test','2099-01-01','KEEP_HINT','https://fixture.invalid/logout')")
            if manual:db.execute('ALTER TABLE reservations ADD COLUMN fixed_override '+manual)
            if manual=='integer DEFAULT false NOT NULL':db.execute('UPDATE reservations SET fixed_override=1')
            db.commit()
        return project,state,dbpath
    def run_migrate(self,project,state):
        return subprocess.run([sys.executable,str(ROOT/'tools/db-admin.py'),'migrate'],cwd=project,env={**os.environ,'D1_STATE_DIR':str(state),'PYTHONIOENCODING':'utf-8'},capture_output=True,text=True,encoding='utf-8',timeout=20)
    def test_upgrade_preserves_all_existing_data_and_is_idempotent(self):
        project,state,dbpath=self.project()
        with closing(sqlite3.connect(dbpath)) as db:
            columns=[r[1] for r in db.execute('PRAGMA table_info(reservations)')];before=db.execute('SELECT * FROM reservations').fetchall()
        result=self.run_migrate(project,state);self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        with closing(sqlite3.connect(dbpath)) as db:
            self.assertEqual(db.execute('SELECT '+','.join('"'+c+'"' for c in columns)+' FROM reservations').fetchall(),before)
            self.assertEqual(db.execute('SELECT fixed_override FROM reservations').fetchall(),[(0,)])
            self.assertEqual(db.execute('SELECT count(*) FROM ed_migrations').fetchone()[0],24)
            self.assertEqual(db.execute('SELECT id_token_hint FROM auth_sessions').fetchone()[0],'KEEP_HINT')
            self.assertEqual(db.execute("SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'reservations_no_overlap_%'").fetchone()[0],2)
        self.assertTrue(list((project/'backups').glob('before-migration-*.sqlite')))
        again=self.run_migrate(project,state);self.assertEqual(again.returncode,0);self.assertNotIn('Applied ',again.stdout)
    def test_manually_added_compatible_column_is_adopted_without_reset(self):
        project,state,dbpath=self.project('integer DEFAULT false NOT NULL')
        result=self.run_migrate(project,state);self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        with closing(sqlite3.connect(dbpath)) as db:
            self.assertEqual(db.execute('SELECT fixed_override FROM reservations').fetchall(),[(1,)])
            self.assertEqual(len([r for r in db.execute('PRAGMA table_info(reservations)') if r[1]=='fixed_override']),1)
    def test_incompatible_existing_column_fails_without_marking_migration(self):
        project,state,dbpath=self.project('text')
        result=self.run_migrate(project,state);self.assertNotEqual(result.returncode,0)
        self.assertIn('incompatible definition',result.stderr)
        with closing(sqlite3.connect(dbpath)) as db:self.assertEqual(db.execute('SELECT count(*) FROM ed_migrations').fetchone()[0],23)
    def test_fresh_schema_and_all_approved_hashes(self):
        approved=json.loads((ROOT/'tools/migrations-approved.json').read_text())
        with closing(sqlite3.connect(':memory:')) as db:
            for file in sorted((ROOT/'drizzle').glob('*.sql')):
                sql=file.read_text(encoding='utf-8');self.assertEqual(hashlib.sha256(sql.encode()).hexdigest(),approved[file.name])
                if file.name==NEW:apply_migration_statement(db,file.name,sql)
                else:db.executescript(sql)
            self.assertEqual(db.execute('SELECT count(*) FROM reservations').fetchone()[0],0)
            self.assertIn('fixed_override',[r[1] for r in db.execute('PRAGMA table_info(reservations)')])

if __name__=='__main__':unittest.main()
