import {env} from "cloudflare:workers";
const prefix="aesgcm:v1:";
async function key(){
  const raw=(env as unknown as Record<string,string>).SMTP_ENCRYPTION_KEY||"";
  let bytes:Uint8Array<ArrayBuffer>;
  try{bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));}catch{throw new Error("SMTP_ENCRYPTION_KEY debe ser base64.");}
  if(bytes.length!==32)throw new Error("Configure SMTP_ENCRYPTION_KEY con 32 bytes aleatorios en base64.");
  return crypto.subtle.importKey("raw",bytes,"AES-GCM",false,["encrypt","decrypt"]);
}
export async function encryptSmtpPassword(value:string){
  if(!value||value.startsWith(prefix))return value;
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},await key(),new TextEncoder().encode(value)));
  return prefix+btoa(String.fromCharCode(...iv,...data));
}
export async function decryptSmtpPassword(value:string){
  if(!value)return "";
  if(!value.startsWith(prefix))throw new Error("Credencial SMTP sin cifrar; vuelva a guardarla desde Configuraci?n.");
  const bytes=Uint8Array.from(atob(value.slice(prefix.length)),c=>c.charCodeAt(0));
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:bytes.slice(0,12)},await key(),bytes.slice(12)));
}
