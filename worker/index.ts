import {sha256Base64Url} from "../lib/keycloak";
/** Cloudflare Worker entry point for the vinext-starter template. */
import handler from "vinext/server/app-router-entry";
import {APP_BASE_PATH} from "../lib/app-path";

interface Env { ASSETS?: {fetch(request:Request):Promise<Response>}; DB: import("@cloudflare/workers-types").D1Database; }

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const runtime = env as unknown as Record<string,string>;
    // Never trust identity headers from an external request.
    const cleanHeaders = new Headers(request.headers);
    for (const key of [...cleanHeaders.keys()]) if (key.toLowerCase().startsWith("x-ed-user-")) cleanHeaders.delete(key);
    request = new Request(request, {headers:cleanHeaders});
    const publicOrigin = runtime.KEYCLOAK_PUBLIC_ORIGIN || url.origin;
    if (!["GET","HEAD","OPTIONS"].includes(request.method)) {
      if (request.headers.get("Origin") !== new URL(publicOrigin).origin)
        return Response.json({error:"Origen de petición no autorizado."},{status:403});
      if(Number(request.headers.get("Content-Length")||0)>5*1024*1024) return new Response("Payload too large",{status:413});
      const reader=request.body?.getReader();
      const chunks:Uint8Array[]=[];let length=0;
      if(reader) while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>5*1024*1024){await reader.cancel();return new Response("Payload too large",{status:413});}chunks.push(part.value);}
      const body=new Uint8Array(length);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
      if(length && request.headers.get("Content-Type")?.split(";")[0]!=="application/json") return new Response("JSON required",{status:415});
      if(length){
        let payload:unknown;try{payload=JSON.parse(new TextDecoder().decode(body));}catch{return new Response("Invalid JSON",{status:400});}
        const validMedia=(value:unknown):boolean=>{
          if(!value||typeof value!=="object")return true;
          return Object.entries(value).every(([key,item])=>{
            if(["photoData","logoData"].includes(key))return item===""||(typeof item==="string"&&item.length<3*1024*1024&&/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(item));
            return validMedia(item);
          });
        };
        if(!validMedia(payload))return new Response("Use PNG, JPEG, WEBP or GIF below 2 MB",{status:400});
      }
      request = new Request(request,{body});
    }
    try { url.pathname = decodeURIComponent(url.pathname).replace(/\/+/g,"/"); } catch {
      return new Response("Invalid path",{status:400});
    }
    const hasBasePath = url.pathname === APP_BASE_PATH || url.pathname.startsWith(`${APP_BASE_PATH}/`);
    const appPath = (hasBasePath ? url.pathname.slice(APP_BASE_PATH.length) || "/" : url.pathname).replace(/\/+$/, "") || "/";

    if (appPath === "/_vinext/image") return new Response("Image optimization binding unavailable; use unoptimized images.",{status:404});

    if(appPath === "/api/health") {
      try {
        await env.DB.prepare("SELECT count(*) FROM ed_migrations").first();
        await env.DB.prepare("SELECT count(*) FROM users").first();
        return Response.json({ok:true,database:"ok"},{headers:{"Cache-Control":"no-store"}});
      } catch {return Response.json({ok:false,database:"error"},{status:503});}
    }
    const publicAuth=["/api/auth","/api/auth/keycloak/login","/api/auth/keycloak/callback"];
    if((appPath.startsWith("/api/")&&!publicAuth.includes(appPath)) || appPath==="/admin" || appPath.startsWith("/admin/")){
      try{
        const token=(request.headers.get("Cookie")||"").split(";").map(value=>value.trim()).find(value=>value.startsWith("ed_session_v2="))?.slice(14)||"";
        const session=token?await env.DB.prepare("SELECT u.email,u.name,u.role FROM auth_sessions s JOIN users u ON lower(u.email)=lower(s.user_email) WHERE s.token=? AND s.expires_at>? AND u.active=1").bind("sha256:"+await sha256Base64Url(token),new Date().toISOString()).first<{email:string;name:string;role:string}>():null;
        if(!session)return Response.json({error:"Debe iniciar sesión con su cuenta corporativa."},{status:401});
        const mutating=!["GET","HEAD","OPTIONS"].includes(request.method);
        const pathMatches=(path:string)=>appPath===path||appPath.startsWith(path+"/");
        const adminRole=["administrador","jefe_operaciones","productor"].includes(session.role);
        const productionChiefRole=session.role==="jefe_produccion";
        const metricsRole=["administrador","jefe_operaciones"].includes(session.role);
        const central=["/api/users","/api/staff","/api/work-shifts","/api/duty-shifts","/api/smtp-settings","/api/reservations/purge"];
        if(central.some(pathMatches)&&!["administrador","jefe_operaciones"].includes(session.role))
          return Response.json({error:"Acceso exclusivo de Administración y Operaciones."},{status:403});
        if(pathMatches("/admin")&&!metricsRole)return Response.json({error:"Administración no autorizada."},{status:403});
        if(pathMatches("/api/metrics")&&!metricsRole)return Response.json({error:"Métricas no autorizadas."},{status:403});
        if(mutating&&pathMatches("/api/users")&&session.role!=="administrador")
          return Response.json({error:"Solo Administrador puede modificar usuarios y roles."},{status:403});
        const catalogs=["/api/programs","/api/schedule","/api/inventory","/api/editing-staff"];
        if(mutating&&catalogs.some(pathMatches)&&!metricsRole)
          return Response.json({error:"Modificación de catálogo no autorizada."},{status:403});
        if(productionChiefRole&&pathMatches("/api/editing-staff")&&mutating)
          return Response.json({error:"Configuración central no autorizada."},{status:403});
        const operatorRole=session.role==="operador";
        const producerRole=session.role==="productor";
        if(request.method==="PUT"&&appPath==="/api/reservations"&&!adminRole&&!operatorRole)return Response.json({error:"Solo Operaciones o un usuario Operador puede registrar retrasos y finalizaciones."},{status:403});
        if(operatorRole&&appPath==="/api/reservations"&&!["GET","HEAD","OPTIONS","PUT","DELETE"].includes(request.method))return Response.json({error:"El rol Operador solo puede registrar retrasos, finalizaciones o cancelaciones."},{status:403});
        if(producerRole&&appPath==="/api/reservations"&&!["GET","HEAD","OPTIONS","POST","PATCH","DELETE"].includes(request.method))return Response.json({error:"El rol Productor puede solicitar, aprobar, reprogramar, anular o cancelar reservas."},{status:403});
        if(session.role==="editor"&&appPath==="/api/reservations"&&!["GET","HEAD","OPTIONS","PATCH"].includes(request.method))return Response.json({error:"El rol Editor solo puede consultar y designar personal de edición."},{status:403});
        if(session.role==="visor"&&mutating)return Response.json({error:"El rol Visor solo puede consultar la agenda."},{status:403});
        const headers=new Headers(request.headers);headers.set("x-ed-user-email",session.email);headers.set("x-ed-user-role",session.role);headers.set("x-ed-user-name",session.name);
        request=new Request(request,{headers});
      }catch{
        return Response.json({error:"Debe iniciar sesión con su cuenta corporativa."},{status:401});
      }
    }

    const response = await handler.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options","nosniff");
    headers.set("Referrer-Policy","same-origin");
    headers.set("X-Frame-Options","DENY");
    if(appPath.startsWith("/api/")||appPath.startsWith("/admin")) headers.set("Cache-Control","no-store");
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  },
};

export default worker;
