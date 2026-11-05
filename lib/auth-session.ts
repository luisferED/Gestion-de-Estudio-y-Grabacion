import {sessionTokens} from "./auth-cookies";
import {sha256Base64Url} from "./keycloak";

export type SessionUser={id:number;email:string;name:string;program:string;role:string;active:boolean|number|string};
// SQLite imports may preserve boolean flags as text. Never use JS truthiness:
// in particular, the text "false" must not authorize a disabled user.
export function isActiveUser(value:unknown):boolean{
  return value===true||value===1||(typeof value==="string"&&["1","true"].includes(value.trim().toLowerCase()));
}
export async function getSession(database:import("@cloudflare/workers-types").D1Database,request:Request):Promise<SessionUser|null>{
  for(const token of sessionTokens(request)){
    const row=await database.prepare(
      "SELECT u.id,u.email,u.name,u.program,u.role,u.active FROM auth_sessions s JOIN users u ON lower(u.email)=lower(s.user_email) WHERE s.token=? AND s.expires_at>? AND (u.active=1 OR lower(trim(CAST(u.active AS TEXT)))='true')"
    ).bind("sha256:"+await sha256Base64Url(token),new Date().toISOString()).first<SessionUser>();
    if(row&&isActiveUser(row.active))return {...row,active:true};
  }
  return null;
}
