const NAME_ENCODING="percent-encoded-utf-8";
// Identity headers are internal only: the gateway and Worker remove client values.
export function setIdentityName(headers:Headers,name:string){
  headers.set("x-ed-user-name",encodeURIComponent(name));
  headers.set("x-ed-user-name-encoding",NAME_ENCODING);
}
export function requestIdentityName(request:Request){
  const value=request.headers.get("x-ed-user-name")||"";
  if(request.headers.get("x-ed-user-name-encoding")!==NAME_ENCODING)return value;
  try{return decodeURIComponent(value)}catch{return ""}
}
