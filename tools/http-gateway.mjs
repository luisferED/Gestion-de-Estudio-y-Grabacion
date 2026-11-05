import http from 'node:http';
import {statSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve('dist/client');
const internalPort=Number(process.env.INTERNAL_APP_PORT||3001);
export function isPublicPath(raw){
  let pathname;
  try{pathname=decodeURIComponent(new URL(raw,'http://localhost').pathname)}catch{return false}
  if(pathname.includes('%')||pathname.includes('\\')||pathname.split('/').some(p=>p==='..'||p.startsWith('.'))||pathname.endsWith('.map'))return false;
  if(pathname==='/'||pathname==='/admin'||pathname.startsWith('/admin/')||pathname.startsWith('/api/')||['/auth/keycloak/login','/auth/keycloak/callback'].includes(pathname))return true;
  const file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+path.sep))return false;
  try{return statSync(file).isFile()}catch{return false}
}
export function createGateway(){
  const server=http.createServer(async(req,res)=>{
    if(!isPublicPath(req.url)){res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');return;}
    const chunks=[];let length=0;
    try{
      for await(const chunk of req){length+=chunk.length;if(length>5*1024*1024){res.writeHead(413);res.end('Payload too large');return}chunks.push(chunk)}
    }catch{res.destroy();return}
    const headers={...req.headers};
    for(const key of Object.keys(headers))if(key.startsWith('x-ed-user-')||['connection','transfer-encoding','upgrade','proxy-authorization','proxy-connection'].includes(key))delete headers[key];
    if(length)headers['content-length']=String(length);
    const upstream=http.request({hostname:'127.0.0.1',port:internalPort,method:req.method,path:req.url,headers},reply=>{
      const responseHeaders={...reply.headers};delete responseHeaders.connection;
      res.writeHead(reply.statusCode||502,responseHeaders);reply.pipe(res);
    });
    upstream.setTimeout(60000,()=>upstream.destroy(new Error('Upstream timeout')));
    upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503,{'Content-Type':'text/plain'});res.end('Application unavailable')});
    req.on('aborted',()=>upstream.destroy());
    if(length)upstream.write(Buffer.concat(chunks));upstream.end();
  });
  server.headersTimeout=10000;server.requestTimeout=30000;
  server.on('upgrade',(_req,socket)=>socket.destroy());
  return server;
}
if(process.env.ED_GATEWAY_TEST_IMPORT!=='true')createGateway().listen(Number(process.env.PORT||3000),process.env.HOST||'0.0.0.0',()=>console.log('[HTTP] Public gateway ready'));
