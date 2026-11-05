import {env} from "cloudflare:workers";
import {APP_BASE_PATH} from "../../../../../lib/app-path";
import {keycloakConfig,keycloakDiscovery,keycloakPublicOrigin,randomBase64Url,sha256Base64Url} from "../../../../../lib/keycloak";

const authCookie=(name:string,value:string)=>`${name}=${encodeURIComponent(value)}; Path=${APP_BASE_PATH}/api/auth/keycloak; HttpOnly; SameSite=Lax; Max-Age=600${String((env as unknown as Record<string,string>).KEYCLOAK_PUBLIC_ORIGIN||"").startsWith("https://")?"; Secure":""}`;

export async function GET(request:Request){
  try{
    const config=keycloakConfig(request);
    const discovery=await keycloakDiscovery(config.issuer);
    const state=randomBase64Url(),nonce=randomBase64Url(),verifier=randomBase64Url(64),challenge=await sha256Base64Url(verifier);
    const authorization=new URL(discovery.authorization_endpoint);
    const parameters=new URLSearchParams({client_id:config.clientId,redirect_uri:config.redirectUri,response_type:"code",scope:"openid profile email",state,nonce,code_challenge:challenge,code_challenge_method:"S256"});
    parameters.set("prompt","login");
    parameters.set("max_age","0");
    authorization.search=parameters.toString();
    const headers=new Headers({Location:authorization.toString(),"Cache-Control":"no-store"});
    headers.append("Set-Cookie",authCookie("ed_oidc_state",state));
    headers.append("Set-Cookie",authCookie("ed_oidc_nonce",nonce));
    headers.append("Set-Cookie",authCookie("ed_oidc_verifier",verifier));
    return new Response(null,{status:302,headers});
  }catch(error){
    const message=error instanceof Error?error.message:"No se pudo iniciar la conexión con Keycloak.";
    return Response.redirect(`${keycloakPublicOrigin(request)}?auth_error=${encodeURIComponent(message)}`,302);
  }
}
