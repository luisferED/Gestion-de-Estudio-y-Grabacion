import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const state = process.env.D1_STATE_DIR || '/data/state';
if (process.env.LOCAL_AUTH_BYPASS !== 'false') throw new Error('LOCAL_AUTH_BYPASS must be false');
for (const key of ['KEYCLOAK_ISSUER','KEYCLOAK_CLIENT_ID','KEYCLOAK_CLIENT_SECRET','KEYCLOAK_PUBLIC_ORIGIN']) {
  if (!process.env[key]) throw new Error('Missing ' + key);
}
process.env.X_LOCAL_EXPLORER='false';
process.env.X_LOCAL_OBSERVABILITY='false';
process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV='true';
mkdirSync(state, {recursive:true});
const wrangler = 'node_modules/wrangler/bin/wrangler.js';
function run(command, args) {
  const p = spawnSync(command, args, {stdio:'inherit', env:process.env});
  if (p.status !== 0) process.exit(p.status || 1);
}
// Create the local D1 file with Wrangler before applying schema to that exact file.
run(process.execPath, [wrangler,'d1','execute','site-creator-d1','--local','--config','wrangler.local.jsonc','--persist-to',state,'--command','SELECT 1']);
run('python3', ['tools/db-admin.py','migrate']);
const config = JSON.parse(readFileSync('dist/server/wrangler.json','utf8'));
config.vars = Object.fromEntries(['KEYCLOAK_ISSUER','KEYCLOAK_CLIENT_ID','KEYCLOAK_CLIENT_SECRET','KEYCLOAK_PUBLIC_ORIGIN'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
Object.assign(config.vars, {LOCAL_AUTH_BYPASS:'false',SEED_DEMO_DATA:'false',DEPLOYMENT_MODE:'production'});
delete config.vars.KEYCLOAK_CLIENT_SECRET;
config.secrets={required:['KEYCLOAK_CLIENT_SECRET',...(process.env.SMTP_ENCRYPTION_KEY?['SMTP_ENCRYPTION_KEY']:[])]};
// Secrets are injected only at container start, never during the image build.
writeFileSync('dist/server/runtime.json', JSON.stringify(config), {mode:0o600});
const children = [
  spawn(process.execPath,['tools/local-smtp-relay.mjs'],{stdio:'inherit'}),
  spawn(process.execPath,['tools/http-gateway.mjs'],{stdio:'inherit'}),
  spawn(process.execPath,[wrangler,'dev','--local','--config','dist/server/runtime.json','--persist-to',state,'--ip','127.0.0.1','--port',process.env.INTERNAL_APP_PORT||'3001','--inspector-port','0','--show-interactive-dev-session=false'],{stdio:'inherit'}),
];
let stopping=false;
function stop(code) {
  if(stopping)return;
  stopping=true;
  for(const child of children) child.kill('SIGTERM');
  process.exitCode=code;
}
for(const child of children) {
  child.on('error',()=>stop(1));
  child.on('exit',code=>stop(code || 1));
}
process.on('SIGTERM',()=>stop(0));
process.on('SIGINT',()=>stop(0));
