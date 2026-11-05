import {isActiveUser} from "../../../../../lib/auth-session";
import {env} from "cloudflare:workers";
import {clearOidcCookies,clearLegacyAuthCookies,sessionCookie} from "../../../../../lib/auth-cookies";
import {keycloakConfig,keycloakDiscovery,keycloakPublicOrigin,keycloakUserInfo,randomBase64Url,verifyIdToken,sha256Base64Url} from "../../../../../lib/keycloak";

type LocalUser={id:number;email:string;name:string;program:string;role:string;active:number|string|boolean};
const cookie=(request:Request,name:string)=>{const raw=(request.headers.get("Cookie")||"").split(";").map(value=>value.trim()).find(value=>value.startsWith(`${name}=`))?.slice(name.length+1)||"";try{return decodeURIComponent(raw)}catch{return ""}};
const errorRedirect=(request:Request,message:string)=>{const headers=new Headers({Location:`${keycloakPublicOrigin(request)}?auth_error=${encodeURIComponent(message)}`,"Cache-Control":"no-store"});clearOidcCookies(headers,keycloakPublicOrigin(request));return new Response(null,{status:302,headers})};

export async function GET(request:Request){
  try{
    const url=new URL(request.url),remoteError=url.searchParams.get("error");
    if(remoteError)return errorRedirect(request,url.searchParams.get("error_description")||"Keycloak canceló el inicio de sesión.");
    const code=url.searchParams.get("code")||"",returnedState=url.searchParams.get("state")||"",expectedState=cookie(request,"ed_oidc_state"),nonce=cookie(request,"ed_oidc_nonce"),verifier=cookie(request,"ed_oidc_verifier");
    if(!code||!returnedState||!expectedState||returnedState!==expectedState||!nonce||!verifier)return errorRedirect(request,"La respuesta de Keycloak no superó la validación de seguridad.");
    const config=keycloakConfig(request),discovery=await keycloakDiscovery(config.issuer);
    const form=new URLSearchParams({grant_type:"authorization_code",client_id:config.clientId,code,redirect_uri:config.redirectUri,code_verifier:verifier});
    if(config.clientSecret)form.set("client_secret",config.clientSecret);
    const tokenResponse=await fetch(discovery.token_endpoint,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},body:form.toString()});
    const tokens=await tokenResponse.json() as {access_token?:string;id_token?:string;error?:string;error_description?:string};
    if(!tokenResponse.ok||!tokens.access_token||!tokens.id_token)throw new Error(tokens.error_description||tokens.error||"Keycloak rechazó el código de autorización.");
    const claims=await verifyIdToken(tokens.id_token,discovery,config.clientId,nonce),profile=await keycloakUserInfo(discovery.userinfo_endpoint,tokens.access_token);
    if(!claims.sub || profile.sub!==claims.sub) throw new Error("Identidad de UserInfo no coincide.");
    if(claims.email_verified!==true || profile.email_verified!==true) throw new Error("El correo corporativo debe estar verificado.");
    const email=String(claims.email||"").trim().toLowerCase();
    if(String(profile.email||"").trim().toLowerCase()!==email) throw new Error("Correo de UserInfo no coincide.");
    if(!email)throw new Error("La cuenta de Keycloak no tiene un correo corporativo asociado.");
    let user=await env.DB.prepare("SELECT id,email,name,program,role,active FROM users WHERE lower(email)=?").bind(email).first<LocalUser>();
    if(!user){
      const profileName=String(profile.name||claims.name||profile.preferred_username||claims.preferred_username||email.split("@")[0]).trim();
      await env.DB.prepare("INSERT OR IGNORE INTO users (email,name,program,role,active) VALUES (?,?,?,?,1)").bind(email,profileName||email,"PRODUCCIÓN","produccion").run();
      user=await env.DB.prepare("SELECT id,email,name,program,role,active FROM users WHERE lower(email)=?").bind(email).first<LocalUser>();
    }
    if(!user||!isActiveUser(user.active))throw new Error(`La cuenta ${email} está validada, pero fue desactivada en la plataforma. Comuníquese con Operaciones.`);
    const token=randomBase64Url(48),maxAge=12*60*60,expiresAt=new Date(Date.now()+maxAge*1000).toISOString();
    await env.DB.prepare("INSERT INTO auth_sessions (token,user_email,expires_at,id_token_hint,end_session_endpoint) VALUES (?,?,?,?,?)").bind("sha256:"+await sha256Base64Url(token),user.email,expiresAt,tokens.id_token,discovery.end_session_endpoint||"").run();
    // The calendar is the application home for every role. Administration remains
    // a separate protected page reached explicitly from the Dashboard button.
    const destination="/";
    console.info("[auth] callback session committed",JSON.stringify({destination,secure:config.publicOrigin.startsWith("https://")}));

    const headers=new Headers({Location:`${config.publicOrigin}${destination}?auth_success=1`,"Cache-Control":"no-store","X-ED-Auth-Result":"session-created"});
    clearLegacyAuthCookies(headers,config.publicOrigin);
    headers.append("Set-Cookie",sessionCookie(config.publicOrigin,token,maxAge));
    return new Response(null,{status:302,headers});
  }catch(error){
    return errorRedirect(request,error instanceof Error?error.message:"No se pudo completar el inicio de sesión corporativo.");
  }
}
