import {decryptSmtpPassword} from "./smtp-secrets";
export type SmtpConfig={host:string;port:number;security:string;authMode:string;username:string;password:string;fromName:string;fromEmail:string;recipients:string};
type MailMessage={to:string[];subject:string;html:string};
export async function sendSmtpMail(config:SmtpConfig,message:MailMessage){
  if(!config.host.trim()||!config.fromEmail.trim()||!message.to.length)throw new Error("Complete servidor, remitente y destinatarios SMTP.");
  if(config.authMode==="login"&&config.security==="none")throw new Error("La autenticacion SMTP requiere TLS.");
  const password=await decryptSmtpPassword(config.password);
  const relay=await fetch("http://127.0.0.1:3127/send",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({config:{...config,password,rejectUnauthorized:true},message}),
    signal:AbortSignal.timeout(60000),
  });
  const result=await relay.json() as {ok?:boolean;error?:string};
  if(!relay.ok||!result.ok)throw new Error(result.error||"El relay SMTP local rechazo el envio.");
}
