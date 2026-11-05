import fcntl, os
from pathlib import Path
state = Path(os.environ.get('D1_STATE_DIR', '/data/state'))
state.mkdir(parents=True, exist_ok=True)
lock = open(state / '.runtime.lock', 'a')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
os.set_inheritable(lock.fileno(), True)
os.environ['ED_RUNTIME_LOCKED'] = '1'
os.execvp('node', ['node', 'tools/container-start.mjs'])
