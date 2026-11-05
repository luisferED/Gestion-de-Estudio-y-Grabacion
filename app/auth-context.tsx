"use client";

import {createContext,useContext,useEffect,useState} from "react";
import {appFetch as fetch,appPath,APP_BASE_PATH} from "../lib/app-path";

export type AuthUser={id:number;email:string;name:string;program:string;role:string;active:boolean};
type AuthValue={user:AuthUser|null;checking:boolean;logout:()=>Promise<void>};
const AuthContext=createContext<AuthValue>({user:null,checking:true,logout:async()=>{}});

export const useAuth=()=>useContext(AuthContext);

export default function AuthGate({children}:{children:React.ReactNode}){
  const [user,setUser]=useState<AuthUser|null>(null),[checking,setChecking]=useState(true);
  useEffect(()=>{const url=new URL(window.location.href),loginCompleted=url.searchParams.get("auth_success")==="1";if(loginCompleted){sessionStorage.setItem("ed_authenticated_tab","1");url.searchParams.delete("auth_success");history.replaceState(null,"",`${url.pathname}${url.search}${url.hash}`)}const tabAuthorized=loginCompleted||sessionStorage.getItem("ed_authenticated_tab")==="1";fetch("/api/auth").then(async response=>{const data=await response.json();if(response.ok){if(data.localBypass)sessionStorage.setItem("ed_authenticated_tab","1");setUser(data.user)}else if(!data.localBypass)sessionStorage.removeItem("ed_authenticated_tab")}).finally(()=>setChecking(false))},[]);
  const logout=async()=>{sessionStorage.removeItem("ed_authenticated_tab");const response=await fetch("/api/auth",{method:"DELETE"});const result=await response.json();setUser(null);if(result.logoutUrl)window.location.href=result.logoutUrl};
  if(checking)return <div className="auth-loading"><span>ED</span><p>Validando sesión corporativa…</p></div>;
  if(!user){const authError=typeof window!=="undefined"?new URLSearchParams(window.location.search).get("auth_error"):"";return <main className="login-shell"><section className="login-card"><div className="login-brand"><span>ED</span><div><b>GESTIÓN DE USO DE ESTUDIOS Y GRABACIONES ED</b><small>Acceso corporativo</small></div></div><p>Ingrese con su cuenta corporativa mediante el servicio central de identidad.</p>{authError&&<div className="login-error">{authError}</div>}<a className="keycloak-login" href={appPath(authError?"/api/auth/keycloak/login?fresh=1":"/api/auth/keycloak/login")}>{authError?"Intentar con otra cuenta":"Ingresar con cuenta corporativa"}</a>{authError&&<small className="login-retry-note">Keycloak volverá a solicitar usuario y contraseña.</small>}<footer><i/> Identidad corporativa · Keycloak</footer></section></main>}
  const adminPath=typeof window!=="undefined"&&window.location.pathname.startsWith(`${APP_BASE_PATH}/admin`),canAdmin=["administrador","jefe_operaciones"].includes(user.role);
  if(adminPath&&!canAdmin)return <main className="login-shell"><section className="login-card access-denied"><div className="login-brand"><span>ED</span><div><b>Acceso restringido</b><small>{user.name}</small></div></div><p>Su cuenta está validada, pero el panel de control requiere el rol Administrador o Jefe de Operaciones.</p><button onClick={()=>window.location.href=appPath("/")}>Volver a la agenda</button><button className="secondary" onClick={logout}>Cerrar sesión</button></section></main>;
  return <AuthContext.Provider value={{user,checking:false,logout}}><div className="auth-session-chip"><span>{user.name}</span><small>{user.role.replaceAll("_"," ")}</small><button onClick={logout}>Salir</button></div>{children}</AuthContext.Provider>;
}
