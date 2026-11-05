import {getSession} from "../../../lib/auth-session";
import {keycloakConfig,keycloakDiscovery,keycloakPublicOrigin,sha256Base64Url} from "../../../lib/keycloak";
import {env} from "cloudflare:workers";
import {clearAuthCookies,sessionCookie,sessionTokens} from "../../../lib/auth-cookies";

const noStore={"Cache-Control":"no-store, max-age=0",Pragma:"no-cache"};
export async function GET(request:Request){
  try{
    const runtime=env as unknown as Record<string,string>;
    const hostname=new URL(request.url).hostname,localHost=["localhost","127.0.0.1","::1"].includes(hostname);
    if(runtime.DEPLOYMENT_MODE!=="production"&&runtime.LOCAL_AUTH_BYPASS==="true"&&localHost)
      return Response.json({authenticated:true,localBypass:true,user:{id:0,email:"admin.local@eldeber",name:"Administrador local",program:"Operaciones",role:"administrador",active:true}},{headers:noStore});
    const row=await getSession(env.DB,request);
    if(row)return Response.json({authenticated:true,user:row},{headers:noStore});
    return Response.json({authenticated:false},{status:401,headers:{...noStore,"Set-Cookie":sessionCookie(keycloakPublicOrigin(request),"",0)}});
  }catch{return Response.json({error:"No se pudo validar la sesion."},{status:503,headers:noStore})}
}
export async function POST(){
  return Response.json({error:"Utilice el inicio de sesion corporativo Keycloak."},{status:503,headers:noStore});
}
type LogoutHint={id_token_hint:string;end_session_endpoint:string};
export async function DELETE(request:Request){
  let hints:LogoutHint[]=[];
  try{
    const statements=await Promise.all(sessionTokens(request).map(async token=>
      env.DB.prepare("DELETE FROM auth_sessions WHERE token IN (?,?) RETURNING id_token_hint,end_session_endpoint")
        .bind("sha256:"+await sha256Base64Url(token),token)));
    // A D1 batch is transactional. Never claim success if revocation failed.
    if(statements.length){
      const results=await env.DB.batch<LogoutHint>(statements);
      if(results.some(result=>!result.success))throw new Error("Revocation failed");
      hints=results.flatMap(result=>result.results||[]);
    }
  }catch{
    return Response.json({ok:false,error:"No se pudo invalidar la sesion en la base de datos. Intente salir nuevamente."},{status:503,headers:noStore});
  }
  const publicOrigin=keycloakPublicOrigin(request);
  const headers=new Headers({...noStore,"Referrer-Policy":"no-referrer"});
  clearAuthCookies(headers,publicOrigin);
  try{
    const config=keycloakConfig(request),issuer=new URL(config.issuer);
    const matching=hints.find(hint=>{
      try{const target=new URL(hint.end_session_endpoint);return target.origin===issuer.origin&&target.pathname.startsWith(issuer.pathname+"/")}catch{return false}
    });
    let endpoint=matching?.end_session_endpoint;
    if(!endpoint){
      try{endpoint=(await keycloakDiscovery(config.issuer)).end_session_endpoint}catch{/* The standard Keycloak realm endpoint remains available as a redirect target. */}
    }
    const target=new URL(endpoint||config.issuer+"/protocol/openid-connect/logout");
    target.searchParams.set("client_id",config.clientId);
    target.searchParams.set("post_logout_redirect_uri",config.publicOrigin+"/");
    if(matching?.id_token_hint)target.searchParams.set("id_token_hint",matching.id_token_hint);
    return Response.json({ok:true,logoutUrl:target.toString()},{headers});
  }catch{
    // Local revocation succeeded; make the SSO failure visible on the login page.
    return Response.json({ok:true,logoutUrl:publicOrigin+"/?auth_error="+encodeURIComponent("Sesion local cerrada. No se pudo preparar el cierre SSO de Keycloak.")},{headers});
  }
}
