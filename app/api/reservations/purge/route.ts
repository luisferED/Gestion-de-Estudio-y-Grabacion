import {requestIdentityName} from "../../../../lib/request-identity";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLogs, reservations } from "../../../../db/schema";

export async function DELETE(request:Request){
  try{
    const payload=await request.json() as {id:number};
    const role=String(request.headers.get("x-ed-user-role")||"").trim().toLowerCase();
    if(role!=="administrador")return Response.json({error:"Solo el perfil Administrador puede eliminar registros definitivamente."},{status:403});
    if(!payload.id)return Response.json({error:"Solicitud inválida."},{status:400});
    const db=getDb();
    const [record]=await db.select().from(reservations).where(eq(reservations.id,payload.id)).limit(1);
    if(!record)return Response.json({error:"La solicitud ya no existe."},{status:404});
    await db.insert(auditLogs).values({reservationId:record.id,action:"eliminacion definitiva",actorEmail:request.headers.get("x-ed-user-email")||"",actorName:requestIdentityName(request),changes:JSON.stringify({deleted:record})});
    await db.delete(reservations).where(eq(reservations.id,record.id));
    return Response.json({ok:true,id:record.id});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"No se pudo eliminar la solicitud."},{status:500});
  }
}
