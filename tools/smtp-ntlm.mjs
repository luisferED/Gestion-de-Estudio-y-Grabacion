import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {logSmtpDiagnostic} from './smtp-diagnostics.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const helper=fileURLToPath(new URL('./smtp-ntlm.py',import.meta.url));

export async function sendNtlmMail(config,message) {
  if(!config.username || !config.password) throw new Error('NTLM requiere usuario y contraseña.');
  if(!['none','starttls','ssl'].includes(config.security)) throw new Error('Seguridad SMTP no válida.');
  const python=process.env.SMTP_NTLM_PYTHON || (process.platform==='win32'?'python':'python3');
  const requestId=randomUUID();
  await new Promise((resolve,reject)=>{
    // No shell or credentials in argv/environment. Only a private stdin pipe.
    const child=spawn(python,[path.resolve(helper)],{
      windowsHide:true,stdio:['pipe','pipe','pipe'],
      env:{...process.env,PYTHONIOENCODING:'utf-8',LM_COMPAT_LEVEL:'3'},
    });
    let output='',buffer='',lastStage='helper';
    let timedOut=false;
    const log=entry=>logSmtpDiagnostic(requestId,entry);
    log({stage:'helper',event:'start'});
    const timer=setTimeout(()=>{timedOut=true;child.kill();},50000);
    const line=value=>{
      let entry;try{entry=JSON.parse(value);}catch{return;}
      const safe=log(entry);
      if(safe)lastStage=safe.stage;
    };
    child.stderr.on('data',chunk=>{
      buffer+=chunk.toString('utf8');
      let at;
      while((at=buffer.indexOf('\n'))>=0){
        const value=buffer.slice(0,at);buffer=buffer.slice(at+1);
        if(value.length<=4096)line(value);
      }
      // Bound memory even for startup tracebacks or malformed child output.
      if(buffer.length>4096)buffer='';
    });
    child.stdout.on('data',chunk=>{if(output.length<8192)output+=chunk.toString('utf8');});
    child.stdin.on('error',error=>log({stage:lastStage,event:'error',reason:'stdin',process_code:error.code}));
    child.once('error',error=>{
      clearTimeout(timer);
      log({stage:'helper',event:'error',reason:'helper_spawn',process_code:error.code});
      reject(new Error('No se pudo iniciar el cliente SMTP NTLM. Revise Python y requirements-smtp.txt.'));
    });
    child.once('close',(code)=>{
      clearTimeout(timer);
      if(buffer.length<=4096 && buffer.trim())line(buffer);
      let result;try{result=JSON.parse(output);}catch{}
      if(code===0 && result?.ok===true){log({stage:'helper',event:'ok'});return resolve();}
      log({stage:lastStage,event:'error',reason:timedOut?'helper_timeout':result?.error?'helper_exit':'helper_protocol',exit_code:code});
      // The helper emits fixed error codes only: no server text or credentials.
      const errors={dependency:'Instale las dependencias de requirements-smtp.txt para SMTP NTLM.',
        config:'Configuración SMTP NTLM no válida.',capability:'Exchange no anuncia AUTH NTLM.',
        tls:'Exchange no ofrece STARTTLS o su certificado TLS no es válido.',
        challenge:'Exchange no proporcionó un desafío NTLMv2 válido.',
        auth:'Exchange rechazó la autenticación NTLM.',
        connection:'No se pudo conectar con Exchange o se agotó el tiempo de espera.',
        message:'Exchange rechazó el remitente, destinatario o mensaje.'};
      reject(new Error(errors[result?.error] || 'No se pudo completar el envío SMTP NTLM.'));
    });
    child.stdin.end(JSON.stringify({config,message}),'utf8');
  });
}
