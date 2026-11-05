// Local SMTP sink for disposable integration tests.
import net from 'node:net';
import {writeFileSync} from 'node:fs';
net.createServer(socket=>{
  socket.setEncoding('utf8');socket.write('220 fixture ESMTP\r\n');
  let buffer='',data=false,message='';
  socket.on('data',chunk=>{
    buffer+=chunk;
    while(buffer.includes('\n')){
      const index=buffer.indexOf('\n'),line=buffer.slice(0,index).replace(/\r$/,'');buffer=buffer.slice(index+1);
      if(data){
        if(line==='.'){data=false;writeFileSync('outputs/smtp-fixture-message.txt',message);socket.write('250 accepted\r\n');message='';}
        else message+=line+'\n';
      }else if(line.startsWith('EHLO'))socket.write('250-fixture\r\n250 SIZE 1048576\r\n');
      else if(line.startsWith('MAIL FROM')||line.startsWith('RCPT TO'))socket.write('250 ok\r\n');
      else if(line==='DATA'){data=true;socket.write('354 End with dot\r\n');}
      else if(line==='QUIT'){socket.end('221 Bye\r\n');}
      else socket.write('502 Not implemented\r\n');
    }
  });
}).listen(16682,'127.0.0.1');
