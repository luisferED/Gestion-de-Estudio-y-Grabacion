import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AuthGate from "./auth-context";
const sans=Geist({variable:"--font-sans",subsets:["latin"]}); const mono=Geist_Mono({variable:"--font-mono",subsets:["latin"]});
export const metadata:Metadata={title:"Gestión de Uso de Estudios y Grabaciones ED",description:"Gestión local de estudios, exteriores, personal y equipos de El Deber"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="es"><body className={`${sans.variable} ${mono.variable}`}><AuthGate>{children}</AuthGate></body></html>}
