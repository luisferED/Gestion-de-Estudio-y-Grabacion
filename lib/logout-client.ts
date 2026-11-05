export async function logoutSession(
  fetcher:typeof globalThis.fetch,
  localLogout:()=>void,
  navigate:(url:string)=>void,
){
  const response=await fetcher("/api/auth",{
    method:"DELETE",credentials:"same-origin",cache:"no-store",
    headers:{"Content-Type":"application/json"},body:"{}",
  });
  const result=await response.json() as {ok?:boolean;logoutUrl?:string;error?:string};
  if(!response.ok||result.ok!==true||!result.logoutUrl)
    throw new Error(result.error||"No se pudo cerrar la sesion. Vuelva a intentarlo.");
  localLogout();
  navigate(result.logoutUrl);
}
