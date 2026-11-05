import {oidcCookie} from "../../../../../lib/auth-cookies";
import {keycloakConfig,keycloakDiscovery,keycloakPublicOrigin,randomBase64Url,sha256Base64Url} from "../../../../../lib/keycloak";



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
    headers.append("Set-Cookie",oidcCookie(config.publicOrigin,"ed_oidc_state",state));
    headers.append("Set-Cookie",oidcCookie(config.publicOrigin,"ed_oidc_nonce",nonce));
    headers.append("Set-Cookie",oidcCookie(config.publicOrigin,"ed_oidc_verifier",verifier));
    return new Response(null,{status:302,headers});
  }catch(error){
    const message=error instanceof Error?error.message:"No se pudo iniciar la conexión con Keycloak.";
    return Response.redirect(`${keycloakPublicOrigin(request)}?auth_error=${encodeURIComponent(message)}`,302);
  }
}
