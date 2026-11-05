import {APP_BASE_PATH,APP_COOKIE_PATH} from "./app-path";

function serialize(name:string,value:string,path:string,sameSite:"Strict"|"Lax",publicOrigin:string,maxAge:number){
  return name+"="+encodeURIComponent(value)+"; Path="+path+"; HttpOnly; SameSite="+sameSite+"; Max-Age="+maxAge
    +(publicOrigin.startsWith("https://")?"; Secure":"")
    +(maxAge===0?"; Expires=Thu, 01 Jan 1970 00:00:00 GMT":"");
}
export function sessionCookie(publicOrigin:string,token:string,maxAge=43200){
  return serialize("ed_session_v2",token,APP_COOKIE_PATH,"Strict",publicOrigin,maxAge);
}
export function oidcCookie(publicOrigin:string,name:string,value:string,maxAge=600){
  return serialize(name,value,APP_BASE_PATH+"/api/auth/keycloak","Lax",publicOrigin,maxAge);
}
export function clearOidcCookies(headers:Headers,publicOrigin:string){
  for(const name of ["ed_oidc_state","ed_oidc_nonce","ed_oidc_verifier"])headers.append("Set-Cookie",oidcCookie(publicOrigin,name,"",0));
}
export function clearLegacyAuthCookies(headers:Headers,publicOrigin:string){
  headers.append("Set-Cookie",serialize("ed_session","",APP_COOKIE_PATH,"Strict",publicOrigin,0));
  clearOidcCookies(headers,publicOrigin);
}
export function clearAuthCookies(headers:Headers,publicOrigin:string){
  headers.append("Set-Cookie",sessionCookie(publicOrigin,"",0));
  clearLegacyAuthCookies(headers,publicOrigin);
}
export function sessionTokens(request:Request){
  return [...new Set((request.headers.get("Cookie")||"").split(";").map(value=>value.trim())
    .filter(value=>value.startsWith("ed_session_v2=")).map(value=>value.slice(14)).filter(Boolean))];
}
