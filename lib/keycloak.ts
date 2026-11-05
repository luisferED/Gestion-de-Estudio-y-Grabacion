import {env} from "cloudflare:workers";
import {APP_BASE_PATH} from "./app-path";

type RuntimeConfig={KEYCLOAK_ISSUER?:string;KEYCLOAK_CLIENT_ID?:string;KEYCLOAK_CLIENT_SECRET?:string;KEYCLOAK_PUBLIC_ORIGIN?:string};
export type KeycloakDiscovery={issuer:string;authorization_endpoint:string;token_endpoint:string;userinfo_endpoint:string;jwks_uri:string;end_session_endpoint?:string};
export type KeycloakClaims={iss?:string;aud?:string|string[];exp?:number;nonce?:string;email?:string;email_verified?:boolean;preferred_username?:string;name?:string;[key:string]:unknown};

const encoder=new TextEncoder();
const decodeBase64Url=(value:string)=>{
  const normalized=value.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(value.length/4)*4,"=");
  const binary=atob(normalized),bytes=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
  return bytes;
};
const decodeJson=<T>(value:string)=>JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;

export const randomBase64Url=(size=32)=>{
  const bytes=crypto.getRandomValues(new Uint8Array(size));
  let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
};
export const sha256Base64Url=async(value:string)=>{
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(value)));
  let binary="";for(const byte of digest)binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
};

export function keycloakConfig(request:Request){
  const runtime=env as unknown as RuntimeConfig,requestUrl=new URL(request.url);
  const issuer=(runtime.KEYCLOAK_ISSUER||"").replace(/\/+$/,""),clientId=runtime.KEYCLOAK_CLIENT_ID||"",clientSecret=runtime.KEYCLOAK_CLIENT_SECRET||"",publicOrigin=(runtime.KEYCLOAK_PUBLIC_ORIGIN||`${requestUrl.origin}${APP_BASE_PATH}`).replace(/\/+$/,"");
  if(!issuer||!clientId)throw new Error("Keycloak no está configurado.");
  return {issuer,clientId,clientSecret,publicOrigin,redirectUri:`${publicOrigin}/api/auth/keycloak/callback`};
}

export function keycloakPublicOrigin(request:Request){
  const runtime=env as unknown as RuntimeConfig;
  return (runtime.KEYCLOAK_PUBLIC_ORIGIN||`${new URL(request.url).origin}${APP_BASE_PATH}`).replace(/\/+$/,"");
}

export async function keycloakDiscovery(issuer:string){
  const response=await fetch(`${issuer}/.well-known/openid-configuration`,{headers:{Accept:"application/json"}});
  if(!response.ok)throw new Error(`Keycloak no publicó su configuración OIDC (${response.status}).`);
  const discovery=await response.json() as KeycloakDiscovery;
  if(discovery.issuer!==issuer)throw new Error("El issuer publicado por Keycloak no coincide con el realm configurado.");
  return discovery;
}

export async function verifyIdToken(token:string,discovery:KeycloakDiscovery,clientId:string,nonce:string){
  const parts=token.split(".");
  if(parts.length!==3)throw new Error("Keycloak devolvió un token de identidad inválido.");
  const header=decodeJson<{alg?:string;kid?:string}>(parts[0]),claims=decodeJson<KeycloakClaims>(parts[1]);
  if(header.alg!=="RS256"||!header.kid)throw new Error("El token de identidad no utiliza una firma admitida.");
  const response=await fetch(discovery.jwks_uri,{headers:{Accept:"application/json"}});
  if(!response.ok)throw new Error("No se pudo obtener la clave pública de Keycloak.");
  const jwks=await response.json() as {keys:(JsonWebKey&{kid?:string})[]},jwk=jwks.keys.find(key=>key.kid===header.kid);
  if(!jwk)throw new Error("No se encontró la clave que firmó el token de Keycloak.");
  const publicKey=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  const valid=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",publicKey,decodeBase64Url(parts[2]),encoder.encode(`${parts[0]}.${parts[1]}`));
  if(!valid)throw new Error("La firma del token de Keycloak no es válida.");
  const audience=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(claims.iss!==discovery.issuer||!audience.includes(clientId))throw new Error("El token no fue emitido para esta plataforma.");
  if(typeof claims.sub!=="string"||!claims.sub)throw new Error("Token sin subject.");
  if(typeof claims.iat!=="number"||claims.iat*1000>Date.now()+60000)throw new Error("Token con iat inválido.");
  if(typeof claims.nbf==="number"&&claims.nbf*1000>Date.now()+60000)throw new Error("Token aún no válido.");
  if((audience.length>1||claims.azp!==undefined)&&claims.azp!==clientId)throw new Error("Authorized party no coincide.");
  if(typeof claims.exp!=="number"||!Number.isFinite(claims.exp)||claims.exp*1000<=Date.now())throw new Error("El token de Keycloak está vencido.");
  if(!claims.nonce||claims.nonce!==nonce)throw new Error("La respuesta de Keycloak no corresponde al inicio de sesión solicitado.");
  return claims;
}

export async function keycloakUserInfo(endpoint:string,accessToken:string){
  const response=await fetch(endpoint,{headers:{Authorization:`Bearer ${accessToken}`,Accept:"application/json"}});
  if(!response.ok)throw new Error("Keycloak validó la sesión, pero no permitió consultar el perfil.");
  return response.json() as Promise<KeycloakClaims>;
}
