import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const helper=fileURLToPath(new URL('./smtp-ntlm.py',import.meta.url));

export async function sendNtlmMail(config,message) {
  if(!config.username || !config.password) throw new Error('NTLM requiere usuario y contraseña.');
  if(!['none','starttls','ssl'].includes(config.security)) throw new Error('Seguridad SMTP no válida.');
  const python=process.env.SMTP_NTLM_PYTHON || (process.platform==='win32'?'python':'python3');
  await new Promise((resolve,reject)=>{
    // No shell or credentials in argv/environment. Only a private stdin pipe.
    const child=spawn(python,[path.resolve(helper)],{
      windowsHide:true,stdio:['pipe','pipe','ignore'],timeout:50000,
      env:{...process.env,PYTHONIOENCODING:'utf-8',LM_COMPAT_LEVEL:'3'},
    });
    let output='';
    child.stdout.on('data',chunk=>{if(output.length<8192)output+=chunk.toString('utf8');});
    child.stdin.on('error',()=>{});
    child.once('error',()=>reject(new Error('No se pudo iniciar el cliente SMTP NTLM. Revise Python y requirements-smtp.txt.')));
    child.once('close',code=>{
      let result;try{result=JSON.parse(output);}catch{}
      if(code===0 && result?.ok===true)return resolve();
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
