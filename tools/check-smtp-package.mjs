import {readFile,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const defaultRoot=fileURLToPath(new URL('../',import.meta.url));
const pythonCheck=`import importlib.metadata, logging, runpy, sys
logging.disable(logging.CRITICAL)
try:
    runpy.run_path(sys.argv[1], run_name='smtp_package_check')
    import spnego
    assert importlib.metadata.version('pyspnego') == sys.argv[2]
    context = spnego.client('PACKAGE_CHECK\\\\fixture', 'offline-fixture-only', protocol='ntlm', context_req=spnego.ContextReq.none, options=spnego.NegotiateOptions.use_ntlm)
    token = context.step()
    assert token[:8] == b'NTLMSSP\\x00' and token[8:12] == b'\\x01\\x00\\x00\\x00'
except Exception:
    sys.exit(1)
`;

export async function verifySmtpPackage({root=defaultRoot,filesOnly=false,git=false,python=process.env.SMTP_NTLM_PYTHON || (process.platform==='win32'?'python':'python3')}={}) {
  root=path.resolve(root);
  const manifestPath=path.join(root,'tools/smtp-package.json');
  let manifest;
  try{manifest=JSON.parse((await readFile(manifestPath,'utf8')).replace(/^\uFEFF/,''));}
  catch{throw new Error('SMTP preflight: missing or invalid tools/smtp-package.json');}
  const files=[...manifest.runtime,...(git?manifest.tests:[])];
  for(const file of files){
    if(typeof file!=='string'||path.isAbsolute(file)||file.split(/[\\/]/).includes('..'))throw new Error('SMTP preflight: invalid manifest path');
    try{if(!(await stat(path.join(root,file))).isFile())throw Error();}
    catch{throw new Error(`SMTP preflight: missing file ${file}`);}
  }
  // Actual module loading validates syntax and all transitive Node imports. Import
  // mode prevents listen() and does not open SMTP, HTTP or database connections.
  const probe=spawnSync(process.execPath,['--input-type=module','-e','await import(process.argv[1]);',pathToFileURL(path.join(root,'tools/local-smtp-relay.mjs')).href],{
    cwd:root,env:{...process.env,ED_SMTP_TEST_IMPORT:'true'},encoding:'utf8',timeout:10000,windowsHide:true,
  });
  if(probe.status!==0)throw new Error('SMTP preflight: relay module graph failed to load; check missing modules or syntax (no SMTP connection attempted)');
  if(git){
    for(const file of files){
      const tracked=spawnSync('git',['ls-files','--error-unmatch','--',file],{cwd:root,stdio:'pipe',windowsHide:true});
      if(tracked.status!==0)throw new Error(`SMTP preflight: file is not in Git index: ${file}`);
      const ignored=spawnSync('git',['check-ignore','--no-index','--quiet','--',file],{cwd:root,stdio:'pipe',windowsHide:true});
      if(ignored.status!==1)throw new Error(`SMTP preflight: ignored file or Git ignore check failed: ${file}`);
    }
  }
  if(!filesOnly){
    const requirements=await readFile(path.join(root,'requirements-smtp.txt'),'utf8');
    const version=requirements.match(/^pyspnego==([0-9.]+)\s*$/m)?.[1];
    if(!version)throw new Error('SMTP preflight: pyspnego must have a pinned version');
    const probe=spawnSync(python,['-B','-c',pythonCheck,path.join(root,'tools/smtp-ntlm.py'),version],{
      cwd:root,encoding:'utf8',timeout:15000,windowsHide:true,
      env:{...process.env,LM_COMPAT_LEVEL:'3',PYTHONIOENCODING:'utf-8'},
    });
    if(probe.status!==0)throw new Error('SMTP preflight: Python/helper/pyspnego dependency check failed; install requirements-smtp.txt using SMTP_NTLM_PYTHON (offline check, no credentials used)');
  }
  return {files:files.length,python:!filesOnly,git};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const result=await verifySmtpPackage({filesOnly:process.argv.includes('--files-only'),git:process.argv.includes('--git')});
    console.log('[SMTP preflight] OK',JSON.stringify(result));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
