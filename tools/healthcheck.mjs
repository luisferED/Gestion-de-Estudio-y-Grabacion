try {
  const r=await fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',{signal:AbortSignal.timeout(4000)});
  const j=await r.json();
  process.exit(r.ok && j.ok && j.database==='ok' ? 0:1);
} catch {process.exit(1)}
