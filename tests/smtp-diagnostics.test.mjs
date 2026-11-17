import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {promisify} from 'node:util';
import {safeSmtpDiagnostic} from '../tools/smtp-diagnostics.mjs';
import {sendNtlmMail} from '../tools/smtp-ntlm.mjs';

test('diagnostic schema discards arbitrary stderr, secret fields and injected identifiers',()=>{
  const privateValue='PRIVATE_PASSWORD_HASH_TOKEN_MESSAGE';
  assert.equal(safeSmtpDiagnostic(privateValue),null);
  const result=safeSmtpDiagnostic({stage:'auth',event:'error',smtp_code:535,enhanced_code:'5.7.3',
    reason:'auth',error_type:'SMTPAuthenticationError',password:privateValue,message:privateValue,stack:privateValue,token:privateValue,
    process_code:privateValue,operation:privateValue,errno:privateValue,error_code:13});
  assert.deepEqual(result,{stage:'auth',event:'error',reason:'auth',error_type:'SMTPAuthenticationError',smtp_code:535,enhanced_code:'5.7.3',error_code:13});
  assert.equal(safeSmtpDiagnostic({stage:privateValue,event:'error'}),null);
  assert.deepEqual(safeSmtpDiagnostic({stage:'auth',event:'error',smtp_code:334,enhanced_code:privateValue,error_type:privateValue}),{stage:'auth',event:'error',smtp_code:334});
});

test('Python diagnostics handle unexpected exceptions without traceback or secrets',async()=>{
  const python=process.env.SMTP_NTLM_PYTHON || (existsSync('.smtp-venv/Scripts/python.exe')?'.smtp-venv/Scripts/python.exe':process.platform==='win32'?'python':'python3');
  const {stderr}=await promisify(execFile)(python,['tests/smtp-diagnostics.py'],{windowsHide:true,timeout:10000});
  assert.match(stderr,/OK/);
});

test('missing Python executable records a safe process code without exposing arguments',async t=>{
  const entries=[];
  t.mock.method(console,'error',(...args)=>entries.push(JSON.parse(args[1])));
  const before=process.env.SMTP_NTLM_PYTHON;
  process.env.SMTP_NTLM_PYTHON='nonexistent-python-fixture-command';
  try{
    await assert.rejects(()=>sendNtlmMail({username:'PRIVATE_USER',password:'PRIVATE_PASSWORD',security:'none'},{}));
    assert.ok(entries.some(e=>e.stage==='helper'&&e.reason==='helper_spawn'&&e.process_code==='ENOENT'));
    assert.ok(!JSON.stringify(entries).includes('PRIVATE_'));
  }finally{
    if(before===undefined)delete process.env.SMTP_NTLM_PYTHON;else process.env.SMTP_NTLM_PYTHON=before;
  }
});
