import { and, asc, eq, ne } from "drizzle-orm";
import { getDb } from "../../../db";
import { users } from "../../../db/schema";

export async function GET() {
  try { return Response.json({ users: await getDb().select().from(users).orderBy(asc(users.program), asc(users.name)) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "No se pudieron cargar los usuarios." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const p = await request.json() as Record<string, unknown>;
    const email=String(p.email||"").trim().toLowerCase(), name=String(p.name||"").trim(), program=String(p.program||"").trim(), role=String(p.role||"solicitante");
    if(!["produccion","productor","jefe_produccion","operador","editor","jefe_operaciones","administrador","visor"].includes(role)) return Response.json({error:"Rol no valido."},{status:400});
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({error:"Correo no valido."},{status:400});
    if(!email||!name||!program) return Response.json({error:"Nombre, correo corporativo y programa son obligatorios."},{status:400});
    const [user]=await getDb().insert(users).values({email,name,program,role}).returning();
    return Response.json({user},{status:201});
  } catch(error) { return Response.json({error:error instanceof Error?error.message:"No se pudo crear el usuario."},{status:500}); }
}

export async function PATCH(request: Request) {
  try {
    const p=await request.json() as {id:number;name?:string;email?:string;program?:string;active?:boolean;role?:string};
    if(!p.id) return Response.json({error:"El usuario es obligatorio."},{status:400});
    const db=getDb(),[current]=await db.select().from(users).where(eq(users.id,p.id)).limit(1);
    if(!current)return Response.json({error:"Usuario no encontrado."},{status:404});
    const values:{name?:string;email?:string;program?:string;active?:boolean;role?:string}={};
    if(p.name!==undefined){const name=String(p.name).trim();if(!name)return Response.json({error:"El nombre no puede quedar vacío."},{status:400});values.name=name}
    if(p.program!==undefined){const program=String(p.program).trim();if(!program)return Response.json({error:"El área no puede quedar vacía."},{status:400});values.program=program}
    if(p.email!==undefined){const email=String(p.email).trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return Response.json({error:"Ingrese un correo corporativo válido."},{status:400});const existing=await db.select().from(users).where(and(eq(users.email,email),ne(users.id,p.id))).limit(1);if(existing.length)return Response.json({error:"Ese correo ya está registrado para otro usuario."},{status:409});values.email=email}
    if(typeof p.active==="boolean") values.active=p.active;
    if(p.role!==undefined) {
      const allowedRoles=["produccion","productor","jefe_produccion","operador","editor","jefe_operaciones","administrador","visor"];
      if(!allowedRoles.includes(p.role)) return Response.json({error:"El nivel de acceso seleccionado no es válido."},{status:400});
      values.role=p.role;
    }
    if(Object.keys(values).length===0) return Response.json({error:"No hay cambios para guardar."},{status:400});
    const removesLastAdmin=current.active&&current.role==="administrador"&&((values.active===false)||(values.role!==undefined&&values.role!=="administrador"));
    if(removesLastAdmin){const activeAdmins=await db.select().from(users).where(and(eq(users.role,"administrador"),eq(users.active,true)));if(activeAdmins.length<=1)return Response.json({error:"Debe conservarse al menos un Administrador activo."},{status:409})}
    const [user]=await db.update(users).set(values).where(eq(users.id,p.id)).returning();
    return Response.json({user});
  }
  catch(error) { return Response.json({error:error instanceof Error?error.message:"No se pudo actualizar el usuario."},{status:500}); }
}

export async function DELETE(request:Request){
  try{
    const {id}=await request.json() as {id:number};
    if(!id)return Response.json({error:"El usuario es obligatorio."},{status:400});
    const db=getDb(),[current]=await db.select().from(users).where(eq(users.id,id)).limit(1);
    if(!current)return Response.json({error:"Usuario no encontrado."},{status:404});
    if(current.active&&current.role==="administrador"){const activeAdmins=await db.select().from(users).where(and(eq(users.role,"administrador"),eq(users.active,true)));if(activeAdmins.length<=1)return Response.json({error:"No se puede eliminar el último Administrador activo."},{status:409})}
    await db.delete(users).where(eq(users.id,id));
    return Response.json({ok:true,id});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"No se pudo eliminar el usuario."},{status:500})}
}
