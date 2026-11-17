// Only fixed identifiers and bounded numbers reach the container log. Never copy
// arbitrary stderr, exception messages, SMTP response text, addresses or payloads.
const stages=new Set(['prepare','dependency','connection','ehlo','starttls','ntlm_negotiate','auth','mail_from','rcpt_to','data','quit','helper']);
const events=new Set(['start','ok','error']);
const reasons=new Set(['dependency','config','capability','tls','challenge','auth','connection','message','internal','helper_spawn','helper_exit','helper_timeout','helper_protocol','stdin']);
const types=new Set(('SmtpFailure UnexpectedError ImportError ModuleNotFoundError AttributeError TypeError ValueError KeyError OSError TimeoutError ConnectionRefusedError ConnectionResetError BrokenPipeError gaierror SSLError SSLCertVerificationError SMTPException SMTPConnectError SMTPServerDisconnected SMTPResponseException SMTPHeloError SMTPAuthenticationError SMTPNotSupportedError SMTPSenderRefused SMTPRecipientsRefused SMTPDataError SpnegoError InvalidTokenError InvalidCredentialError BadMechanismError BadNameError NoCredentialError OperationNotAvailableError FeatureMissingError').split(' '));
const processCodes=new Set(['ENOENT','EACCES','EPIPE','ECONNRESET','ETIMEDOUT','ENOEXEC']);

export function safeSmtpDiagnostic(input) {
  if(!input || !stages.has(input.stage) || !events.has(input.event))return null;
  const out={stage:input.stage,event:input.event};
  if(['context','type1','type2','type3'].includes(input.operation))out.operation=input.operation;
  if(reasons.has(input.reason))out.reason=input.reason;
  if(types.has(input.error_type))out.error_type=input.error_type;
  if(processCodes.has(input.process_code))out.process_code=input.process_code;
  if(Number.isInteger(input.smtp_code)&&input.smtp_code>=100&&input.smtp_code<=599)out.smtp_code=input.smtp_code;
  if(typeof input.enhanced_code==='string'&&/^[245]\.\d{1,3}\.\d{1,3}$/.test(input.enhanced_code))out.enhanced_code=input.enhanced_code;
  for(const key of ['errno','winerror','error_code','verify_code','exit_code']){
    if(Number.isSafeInteger(input[key])&&Math.abs(input[key])<=0xffffffff)out[key]=input[key];
  }
  return out;
}

export function logSmtpDiagnostic(requestId,input) {
  const diagnostic=safeSmtpDiagnostic(input);
  if(diagnostic)console.error('[smtp-ntlm]',JSON.stringify({request_id:requestId,...diagnostic}));
  return diagnostic;
}
