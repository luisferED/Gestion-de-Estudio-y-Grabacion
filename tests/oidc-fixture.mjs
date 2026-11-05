// Isolated local identity provider fixture. Never deploy this file.
import http from 'node:http';
import {generateKeyPairSync,sign,createHash,randomUUID} from 'node:crypto';
const issuer=process.env.TEST_ISSUER||'http://127.0.0.1:16681/realms/test';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'fixture-key',alg:'RS256',use:'sig'};
const codes=new Map(),tokens=new Map();
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,issuer),send=(status,obj)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(obj))};
  const endpoint=name=>issuer+'/'+name;
  if(url.pathname.endsWith('/.well-known/openid-configuration'))return send(200,{issuer,authorization_endpoint:endpoint('authorize'),token_endpoint:endpoint('token'),userinfo_endpoint:endpoint('userinfo'),jwks_uri:endpoint('keys'),end_session_endpoint:endpoint('logout')});
  if(url.pathname.endsWith('/keys'))return send(200,{keys:[jwk]});
  if(url.pathname.endsWith('/authorize')){
    if(url.searchParams.get('code_challenge_method')!=='S256'||url.searchParams.get('response_type')!=='code')return send(400,{error:'PKCE required'});
    const code=randomUUID();codes.set(code,Object.fromEntries(url.searchParams));
    const target=new URL(url.searchParams.get('redirect_uri'));
    target.searchParams.set('code',code);target.searchParams.set('state',url.searchParams.get('state'));
    res.writeHead(302,{Location:target.href});return res.end();
  }
  if(url.pathname.endsWith('/token')){
    let body='';for await(const chunk of req)body+=chunk;
    const p=new URLSearchParams(body),saved=codes.get(p.get('code'));codes.delete(p.get('code'));
    if(!saved||p.get('client_secret')!=='fixture-only'||p.get('redirect_uri')!==saved.redirect_uri||createHash('sha256').update(p.get('code_verifier')||'').digest('base64url')!==saved.code_challenge)return send(400,{error:'invalid_grant'});
    const user=saved.test_user||'newuser@example.test',mode=saved.test_mode||'',now=Math.floor(Date.now()/1000);
    const claims={iss:issuer,aud:saved.client_id,sub:'fixture:'+user,iat:now,exp:now+300,nonce:saved.nonce,email:user,email_verified:true,name:user.split('@')[0]};
    if(mode==='nonce')claims.nonce='incorrect';
    if(mode==='expired')claims.exp=now-1;
    if(mode==='audience')claims.aud='incorrect';
    if(mode==='unverified')claims.email_verified=false;
    const input=b64({alg:'RS256',kid:'fixture-key'})+'.'+b64(claims);
    let signature=sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url');
    if(mode==='signature')signature='A'.repeat(signature.length);
    const access=randomUUID();tokens.set(access,{...claims,...(mode==='subject'?{sub:'wrong-subject'}:{})});
    return send(200,{access_token:access,id_token:input+'.'+signature,token_type:'Bearer'});
  }
  if(url.pathname.endsWith('/userinfo')){
    const claims=tokens.get((req.headers.authorization||'').replace('Bearer ',''));
    return send(claims?200:401,claims||{error:'invalid_token'});
  }
  if(url.pathname.endsWith('/logout')){
    res.writeHead(302,{Location:url.searchParams.get('post_logout_redirect_uri')||'/'});return res.end();
  }
  send(404,{error:'fixture route not found'});
});
server.listen(Number(process.env.TEST_OIDC_PORT||16681),'0.0.0.0');
