const encoder=new TextEncoder();
export const ORIGIN_PROOF_HEADER="x-ed-origin-proof";
/** @param {string|undefined} value */
export function configuredPublicOrigin(value){
  if(!value)throw new Error("KEYCLOAK_PUBLIC_ORIGIN is required");
  const url=new URL(value.trim());
  if(!["https:","http:"].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=="/")
    throw new Error("KEYCLOAK_PUBLIC_ORIGIN must be an absolute HTTP(S) origin");
  return url.origin;
}
/** @param {string} secret */
async function key(secret){
  return crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
}
/** @param {Uint8Array} bytes */
function encode(bytes){return btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"")}
/** @param {string} value */
function decode(value){return Uint8Array.from(atob(value.replaceAll("-","+").replaceAll("_","/")),c=>c.charCodeAt(0))}
/** @param {string} secret @param {string} origin @param {string} method @param {string} target */
export async function signRequestOrigin(secret,origin,method,target){
  const payload=encode(encoder.encode(JSON.stringify({origin,method,target,at:Date.now()})));
  const signature=new Uint8Array(await crypto.subtle.sign("HMAC",await key(secret),encoder.encode(payload)));
  return payload+"."+encode(signature);
}
/** @param {string|null} proof @param {string} secret @param {string} origin @param {string} method @param {string} target */
export async function verifyRequestOrigin(proof,secret,origin,method,target){
  try{
    if(!proof||proof.length>8192||secret.length<32)return false;
    const parts=proof.split(".");if(parts.length!==2)return false;
    const payload=JSON.parse(new TextDecoder().decode(decode(parts[0])));
    if(payload.origin!==origin||payload.method!==method||payload.target!==target||
       !Number.isSafeInteger(payload.at)||Math.abs(Date.now()-payload.at)>30000)return false;
    return await crypto.subtle.verify("HMAC",await key(secret),decode(parts[1]),encoder.encode(parts[0]));
  }catch{return false}
}
