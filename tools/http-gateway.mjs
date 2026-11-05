import {configuredPublicOrigin,ORIGIN_PROOF_HEADER,signRequestOrigin} from "./request-origin.mjs";
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
// Wrangler's local proxy rewrites URL headers to HTTP. Restore only our own
// configured public HTTPS origin; never rewrite an external OIDC destination.
export function publicRedirectLocation(location,publicOrigin){
  try{
    const target=new URL(location,publicOrigin),publicUrl=new URL(publicOrigin);
    if(publicUrl.protocol==="https:"&&target.protocol==="http:"&&target.host===publicUrl.host&&!target.username&&!target.password){
      target.protocol=publicUrl.protocol;
      return target.href;
    }
  }catch{}
  return location;
}
export function createGateway(){
  const publicOrigin=configuredPublicOrigin(process.env.KEYCLOAK_PUBLIC_ORIGIN);
  const gatewaySecret=process.env.ED_GATEWAY_SECRET;
  if(!gatewaySecret||gatewaySecret.length<32)throw new Error("Internal gateway secret is missing");

  const server=http.createServer(async(req,res)=>{
    if(!isPublicPath(req.url)){res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');return;}
    const mutating=!["GET","HEAD","OPTIONS"].includes(req.method||"GET");
    // Validate the browser header before Wrangler rewrites URL-related headers.
    // Never infer the public origin from Host, Forwarded or X-Forwarded-*.
    if(mutating&&req.headers.origin!==publicOrigin){
      res.writeHead(403,{"Content-Type":"application/json","Cache-Control":"no-store"});
      res.end(JSON.stringify({error:"Origen de petición no autorizado."}));return;
    }
    const chunks=[];let length=0;
    try{
      for await(const chunk of req){length+=chunk.length;if(length>5*1024*1024){res.writeHead(413);res.end('Payload too large');return}chunks.push(chunk)}
    }catch{res.destroy();return}
    const headers={...req.headers};
    for(const key of Object.keys(headers))if(key===ORIGIN_PROOF_HEADER||key==='forwarded'||key.startsWith('x-forwarded-')||key.startsWith('x-ed-user-')||['connection','transfer-encoding','upgrade','proxy-authorization','proxy-connection'].includes(key))delete headers[key];
    if(mutating){
      const target=new URL(req.url||"/",publicOrigin);
      headers[ORIGIN_PROOF_HEADER]=await signRequestOrigin(gatewaySecret,publicOrigin,req.method||"GET",target.pathname+target.search);
    }
    if(length)headers['content-length']=String(length);
    const upstream=http.request({hostname:'127.0.0.1',port:internalPort,method:req.method,path:req.url,headers},reply=>{
      const responseHeaders={...reply.headers};delete responseHeaders.connection;
      if(typeof responseHeaders.location==="string"){
        responseHeaders.location=publicRedirectLocation(responseHeaders.location,publicOrigin);
      }
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
