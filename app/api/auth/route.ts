import {keycloakConfig,keycloakDiscovery,sha256Base64Url} from "../../../lib/keycloak";
import { env } from "cloudflare:workers";
import {APP_COOKIE_PATH} from "../../../lib/app-path";

type AppUser={id:number;email:string;name:string;program:string;role:string;active:number};

async function ensureTables(){
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS auth_sessions (token text PRIMARY KEY NOT NULL, user_email text NOT NULL, expires_at text NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)").run();
}
function cookie(request:Request,name:string){const value=request.headers.get("Cookie")||"";return value.split(";").map(item=>item.trim()).find(item=>item.startsWith(`${name}=`))?.slice(name.length+1)||""}
const sessionCookie=(token:string,maxAge?:number)=>`ed_session_v2=${token}; Path=${APP_COOKIE_PATH}; HttpOnly; SameSite=Strict${String((env as unknown as Record<string,string>).KEYCLOAK_PUBLIC_ORIGIN||"").startsWith("https://")?"; Secure":""}${maxAge===undefined?"":`; Max-Age=${maxAge}`}`;

export async function GET(request:Request){
  try{
    const runtime=env as unknown as Record<string,string>;
    const hostname=new URL(request.url).hostname,localHost=["localhost","127.0.0.1","::1"].includes(hostname);
    if(runtime.DEPLOYMENT_MODE!=="production"&&runtime.LOCAL_AUTH_BYPASS==="true"&&localHost)return Response.json({authenticated:true,localBypass:true,user:{id:0,email:"admin.local@eldeber",name:"Administrador local",program:"Operaciones · entorno local",role:"administrador",active:true}});
    
    const token=cookie(request,"ed_session_v2");
    if(!token)return Response.json({authenticated:false},{status:401});
    const now=new Date().toISOString();
    const row=await env.DB.prepare("SELECT u.id,u.email,u.name,u.program,u.role,u.active FROM auth_sessions s JOIN users u ON lower(u.email)=lower(s.user_email) WHERE s.token=? AND s.expires_at>? AND u.active=1").bind("sha256:"+await sha256Base64Url(token),now).first<AppUser>();
    if(!row)return Response.json({authenticated:false},{status:401,headers:{"Set-Cookie":sessionCookie("",0)}});
    return Response.json({authenticated:true,user:{...row,active:Boolean(row.active)}});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"No se pudo validar la sesión."},{status:500})}
}

export async function POST(){
  return Response.json({error:"Falta configurar el realm y el cliente autorizado de Keycloak."},{status:503});
}

export async function DELETE(request:Request){
  try{
    
    const token=cookie(request,"ed_session_v2");
    if(token)await env.DB.prepare("DELETE FROM auth_sessions WHERE token=?").bind("sha256:"+await sha256Base64Url(token)).run();
    const headers=new Headers();headers.append("Set-Cookie",sessionCookie("",0));headers.append("Set-Cookie",`ed_session=; Path=${APP_COOKIE_PATH}; HttpOnly; SameSite=Strict; Max-Age=0`);let logoutUrl:string|undefined;
    try{const config=keycloakConfig(request),discovery=await keycloakDiscovery(config.issuer);if(discovery.end_session_endpoint){const target=new URL(discovery.end_session_endpoint);target.searchParams.set("client_id",config.clientId);target.searchParams.set("post_logout_redirect_uri",config.publicOrigin+"/");logoutUrl=target.toString()}}catch{}
    return Response.json({ok:true,logoutUrl},{headers});
  }catch{const headers=new Headers();headers.append("Set-Cookie",sessionCookie("",0));headers.append("Set-Cookie",`ed_session=; Path=${APP_COOKIE_PATH}; HttpOnly; SameSite=Strict; Max-Age=0`);return Response.json({ok:true},{headers})}
}
