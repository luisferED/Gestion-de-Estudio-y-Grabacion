"use client";

import {createContext,useContext,useEffect,useRef,useState} from "react";
import {appFetch as fetch,appPath,APP_BASE_PATH} from "../lib/app-path";

import {logoutSession} from "../lib/logout-client";

export type AuthUser={id:number;email:string;name:string;program:string;role:string;active:boolean};
type AuthValue={user:AuthUser|null;checking:boolean;logout:()=>Promise<void>};
const AuthContext=createContext<AuthValue>({user:null,checking:true,logout:async()=>{}});

export const useAuth=()=>useContext(AuthContext);

export default function AuthGate({children}:{children:React.ReactNode}){
  const [user,setUser]=useState<AuthUser|null>(null),[checking,setChecking]=useState(true);
  const authEpoch=useRef(0),loggingOut=useRef(false);
  useEffect(()=>{
    const controller=new AbortController(),epoch=authEpoch.current;
    const url=new URL(window.location.href);
    if(url.searchParams.get("auth_success")==="1"){
      url.searchParams.delete("auth_success");
      history.replaceState(null,"",url.pathname+url.search+url.hash);
    }
    fetch("/api/auth",{credentials:"same-origin",cache:"no-store",signal:controller.signal})
      .then(async response=>{
        const data=await response.json();
        if(epoch!==authEpoch.current)return;
        setUser(response.ok?data.user:null);
      }).catch(()=>{if(epoch===authEpoch.current)setUser(null)})
      .finally(()=>{if(epoch===authEpoch.current)setChecking(false)});
    const restored=(event:PageTransitionEvent)=>{if(event.persisted)window.location.reload()};
    window.addEventListener("pageshow",restored);
    return ()=>{controller.abort();window.removeEventListener("pageshow",restored)};
  },[]);
  const logout=async()=>{
    if(loggingOut.current)return;
    loggingOut.current=true;
    authEpoch.current++;
    try{
      await logoutSession(fetch,()=>{sessionStorage.removeItem("ed_authenticated_tab");setUser(null)},url=>window.location.replace(url));
    }catch(error){
      window.alert(error instanceof Error?error.message:"No se pudo cerrar la sesion.");
    }finally{loggingOut.current=false;setChecking(false)}
  };
  if(checking)return <div className="auth-loading"><span>ED</span><p>Validando sesión corporativa…</p></div>;
  if(!user){const authError=typeof window!=="undefined"?new URLSearchParams(window.location.search).get("auth_error"):"";return <main className="login-shell"><section className="login-card"><div className="login-brand"><span>ED</span><div><b>GESTIÓN DE USO DE ESTUDIOS Y GRABACIONES ED</b><small>Acceso corporativo</small></div></div><p>Ingrese con su cuenta corporativa mediante el servicio central de identidad.</p>{authError&&<div className="login-error">{authError}</div>}<a className="keycloak-login" href={appPath(authError?"/api/auth/keycloak/login?fresh=1":"/api/auth/keycloak/login")}>{authError?"Intentar con otra cuenta":"Ingresar con cuenta corporativa"}</a>{authError&&<small className="login-retry-note">Keycloak volverá a solicitar usuario y contraseña.</small>}<footer><i/> Identidad corporativa · Keycloak</footer></section></main>}
  const adminPath=typeof window!=="undefined"&&window.location.pathname.startsWith(`${APP_BASE_PATH}/admin`),canAdmin=["administrador","jefe_operaciones"].includes(user.role);
  if(adminPath&&!canAdmin)return <main className="login-shell"><section className="login-card access-denied"><div className="login-brand"><span>ED</span><div><b>Acceso restringido</b><small>{user.name}</small></div></div><p>Su cuenta está validada, pero el panel de control requiere el rol Administrador o Jefe de Operaciones.</p><button onClick={()=>window.location.href=appPath("/")}>Volver a la agenda</button><button className="secondary" onClick={logout}>Cerrar sesión</button></section></main>;
  return <AuthContext.Provider value={{user,checking:false,logout}}><div className="auth-session-chip"><span>{user.name}</span><small>{user.role.replaceAll("_"," ")}</small><button onClick={logout}>Salir</button></div>{children}</AuthContext.Provider>;
}
