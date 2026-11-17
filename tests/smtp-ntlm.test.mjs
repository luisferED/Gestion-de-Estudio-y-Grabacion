import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {existsSync} from 'node:fs';
if(!process.env.SMTP_NTLM_PYTHON && existsSync('.smtp-venv/Scripts/python.exe')) process.env.SMTP_NTLM_PYTHON='.smtp-venv/Scripts/python.exe';
import {once} from 'node:events';
import {createHmac, timingSafeEqual} from 'node:crypto';
import {sendNtlmMail} from '../tools/smtp-ntlm.mjs';

const config={host:'127.0.0.1',port:25,security:'none',authMode:'ntlm',username:'Domain\\User',password:'Password',fromName:'Gestión ED',fromEmail:'sender@example.test'};
const message={to:['recipient@example.test'],subject:'Grabación · ñ',html:'<p>Ángel, programación</p>'};
const challenge=Buffer.from('0123456789abcdef','hex');
function type2(){
  const domain=Buffer.from('Domain','utf16le');
  const av=Buffer.alloc(4+domain.length+4);
  av.writeUInt16LE(2);av.writeUInt16LE(domain.length,2);domain.copy(av,4);
  const buf=Buffer.alloc(48+av.length);
  buf.write('NTLMSSP\0');buf.writeUInt32LE(2,8);
  buf.writeUInt32LE(0x00888205,20);challenge.copy(buf,24);
  buf.writeUInt16LE(av.length,40);buf.writeUInt16LE(av.length,42);buf.writeUInt32LE(48,44);av.copy(buf,48);
  return buf.toString('base64');
}
function field(buf,at){return buf.subarray(buf.readUInt32LE(at+4),buf.readUInt32LE(at+4)+buf.readUInt16LE(at));}
function verifyType3(buf){
  assert.equal(buf.subarray(0,8).toString(),'NTLMSSP\0');
  assert.equal(buf.readUInt32LE(8),3);
  const domain=field(buf,28).toString('utf16le'),user=field(buf,36).toString('utf16le');
  assert.equal(domain.toUpperCase(),'DOMAIN');assert.equal(user,'User');
  const response=field(buf,20);
  assert.ok(response.length>24,'NTLMv2 response must include its blob');
  assert.equal(response.subarray(16,20).toString('hex'),'01010000');
  // Published NT hash for the synthetic password "Password". Independent proof check.
  const ntHash=Buffer.from('a4f49c406510bdcab6824ee7c30fd852','hex');
  const key=createHmac('md5',ntHash).update(Buffer.from(user.toUpperCase()+domain,'utf16le')).digest();
  const proof=createHmac('md5',key).update(Buffer.concat([challenge,response.subarray(16)])).digest();
  assert.ok(timingSafeEqual(proof,response.subarray(0,16)));
}
async function fixture(t,{capabilities='AUTH GSSAPI NTLM',reject=false,malformed=false,failStage=''}={}){
  const lines=[],tokens=[],bodies=[];let failure;
  const sockets=new Set();
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    socket.write(failStage==='connection'?'421 4.3.2 PRIVATE_SERVER_TEXT\r\n':'220 fake.example.test SMTP\r\n');
    let buffer='',data=false,body=[];
    socket.on('data',chunk=>{
      buffer+=chunk.toString();
      while(buffer.includes('\r\n')){
        const at=buffer.indexOf('\r\n'),line=buffer.slice(0,at);buffer=buffer.slice(at+2);
        if(data){if(line==='.') {data=false;bodies.push(body.join('\r\n'));socket.write(failStage==='data'?'554 5.6.0 PRIVATE_SERVER_TEXT\r\n':'250 2.0.0 accepted locally\r\n');}else body.push(line);continue;}
        lines.push(line);
        if((failStage==='ehlo'&&/^EHLO /i.test(line))||(failStage==='mail_from'&&/^MAIL FROM:/i.test(line))||(failStage==='rcpt_to'&&/^RCPT TO:/i.test(line))){socket.write('550 5.7.1 PRIVATE_SERVER_TEXT\r\n');continue;}
        if(/^EHLO /i.test(line))socket.write(`250-fake.example.test\r\n250-${capabilities}\r\n250 SIZE 1048576\r\n`);
        else if(line==='AUTH NTLM')socket.write('334 \r\n');
        else if(line.startsWith('AUTH NTLM ') || /^[A-Za-z0-9+/=]{20,}$/.test(line)){
          try{
            const buf=Buffer.from(line.replace(/^AUTH NTLM /,''),'base64');tokens.push(buf);
            if(buf.readUInt32LE(8)===1)socket.write('334 '+(malformed?'invalid-challenge':type2())+'\r\n');
            else {verifyType3(buf);socket.write(reject?'535 5.7.3 denied\r\n':'235 2.7.0 authenticated\r\n');}
          }catch(error){failure=error;socket.write('535 failed\r\n');}
        }
        else if(/^(MAIL FROM:|RCPT TO:)/i.test(line))socket.write('250 ok\r\n');
        else if(line.toUpperCase()==='DATA'){data=true;body=[];socket.write('354 go\r\n');}
        else if(line.toUpperCase()==='QUIT'){socket.end('221 bye\r\n');}
        else socket.write('500 unexpected\r\n');
      }
    });
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
  return {port:server.address().port,lines,tokens,bodies,check:()=>{if(failure)throw failure;}};
}

test('NTLM rejects missing credentials and invalid security before connection',async()=>{
  for(const change of [{username:''},{password:''},{security:'invalid'}]){
    await assert.rejects(()=>sendNtlmMail({...config,...change},message));
  }
});

for(const capabilities of ['AUTH NTLM','AUTH GSSAPI NTLM'])test(`portable client negotiates NTLMv2 against loopback fixture (${capabilities})`,async t=>{
  const f=await fixture(t,{capabilities});
  try{await sendNtlmMail({...config,port:f.port},message);}catch(error){f.check();throw error;}f.check();
  assert.equal(f.tokens.length,2);
  assert.equal(f.bodies.length,1);
  assert.ok(!f.lines.some(line=>/STARTTLS|AUTH LOGIN|AUTH PLAIN/.test(line)));
  assert.ok(!f.lines.some(line=>line===config.password||line===Buffer.from(config.password).toString('base64')));
  assert.equal(Buffer.from(f.bodies[0].split('\r\n\r\n')[1].replace(/\s/g,''),'base64').toString('utf8').trimEnd(),message.html);
});

for(const options of [{capabilities:'AUTH LOGIN PLAIN'},{capabilities:'X-EXPS GSSAPI NTLM'},{reject:true},{malformed:true}])test(`NTLM fails closed without fallback: ${JSON.stringify(options)}`,async t=>{
  const f=await fixture(t,options);
  await assert.rejects(()=>sendNtlmMail({...config,port:f.port},message));f.check();
  assert.ok(!f.lines.some(line=>/AUTH LOGIN|AUTH PLAIN|MAIL FROM:|^DATA$/i.test(line)));
  if(options.reject)assert.equal(f.tokens.length,2);
  if(options.malformed)assert.equal(f.tokens.length,1);
  assert.equal(f.bodies.length,0);
});


test('STARTTLS is required only when explicitly configured and never falls back to NTLM in clear',async t=>{
  const f=await fixture(t);
  await assert.rejects(()=>sendNtlmMail({...config,security:'starttls',port:f.port},message),/STARTTLS/);
  assert.ok(!f.lines.some(line=>line.startsWith('AUTH')));
});


test('relay dispatches NTLM explicitly and rejects cleartext LOGIN before opening a connection',async t=>{
  process.env.ED_SMTP_TEST_IMPORT='true';
  const {sendMail}=await import('../tools/local-smtp-relay.mjs');
  const f=await fixture(t);
  await sendMail({...config,port:f.port},message);f.check();
  assert.equal(f.tokens.length,2);
  await assert.rejects(()=>sendMail({...config,authMode:'login',port:f.port},message),/TLS/);
});


for(const stage of ['connection','ehlo','mail_from','rcpt_to','data'])test(`diagnostics identify ${stage} without exposing SMTP response text`,async t=>{
  const entries=[];
  t.mock.method(console,'error',(...args)=>entries.push(JSON.parse(args[1])));
  const f=await fixture(t,{failStage:stage});
  await assert.rejects(()=>sendNtlmMail({...config,port:f.port},message),error=>{
    assert.ok(!error.message.includes('PRIVATE_SERVER_TEXT'));return true;
  });f.check();
  assert.ok(entries.some(e=>e.stage===stage&&e.event==='error'&&e.smtp_code>=400));
  assert.equal(new Set(entries.map(e=>e.request_id)).size,1);
  const serialized=JSON.stringify(entries);
  for(const secret of ['PRIVATE_SERVER_TEXT',config.username,config.password,message.html,message.subject,...f.tokens.map(token=>token.toString('base64'))])assert.ok(!serialized.includes(secret));
});

test('successful stages include AUTH codes and both DATA replies, never NTLM tokens',async t=>{
  const entries=[];
  t.mock.method(console,'error',(...args)=>entries.push(JSON.parse(args[1])));
  const f=await fixture(t);
  await sendNtlmMail({...config,port:f.port},message);f.check();
  for(const [stage,code] of [['connection',220],['ehlo',250],['ntlm_negotiate',334],['auth',235],['mail_from',250],['rcpt_to',250],['data',354],['data',250]])assert.ok(entries.some(e=>e.stage===stage&&e.smtp_code===code));
  for(const token of f.tokens)assert.ok(!JSON.stringify(entries).includes(token.toString('base64')));
});

test('invalid challenge and authentication denial have separate stages',async t=>{
  const entries=[];
  t.mock.method(console,'error',(...args)=>entries.push(JSON.parse(args[1])));
  const malformed=await fixture(t,{malformed:true});
  await assert.rejects(()=>sendNtlmMail({...config,port:malformed.port},message));
  assert.ok(entries.some(e=>e.stage==='ntlm_negotiate'&&e.reason==='challenge'&&e.event==='error'));
  const denied=await fixture(t,{reject:true});
  await assert.rejects(()=>sendNtlmMail({...config,port:denied.port},message));
  assert.ok(entries.some(e=>e.stage==='auth'&&e.smtp_code===535&&e.enhanced_code==='5.7.3'));
});
