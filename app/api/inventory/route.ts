import {env} from "cloudflare:workers";
import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { inventoryItems } from "../../../db/schema";
const INITIAL=[
  ["Cámara OBSBOT",4,"unidad"],["Pedestal de cámara",4,"unidad"],["Switch PoE",1,"unidad"],["Set de micrófonos corbateros Hollyland",2,"set"],["OBS Talent",2,"unidad"],["Set de luces portátiles (4 luces, 4 pedestales y 4 fuentes)",1,"set"],["Luz SL300",3,"unidad"],["Luz SA150",1,"unidad"],["Difusor bola china",4,"unidad"],["Pedestal para SL300",3,"unidad"],["Pedestal para SA150",1,"unidad"],["Interfaz Focusrite",2,"unidad"],["Intercom",4,"unidad"],["Set Shure PSM 300 (1 TX y 2 RX)",1,"set"],["Cable de red",null,"unidad"],["Extensor eléctrico",null,"unidad"]
] as const;
async function seed(){const db=getDb(),r=await db.select().from(inventoryItems).limit(1);if(!r.length)await db.insert(inventoryItems).values(INITIAL.map(([name,stock,unit])=>({name,stock,unit})))}
export async function GET(){try{if((env as unknown as Record<string,string>).SEED_DEMO_DATA==="true"){await seed();}return Response.json({items:await getDb().select().from(inventoryItems).orderBy(asc(inventoryItems.name))})}catch(e){return Response.json({error:e instanceof Error?e.message:"No se pudo cargar Pañol."},{status:500})}}
export async function POST(request:Request){try{const p=await request.json() as {name:string;stock:number|null;unit:string};const [item]=await getDb().insert(inventoryItems).values(p).returning();return Response.json({item},{status:201})}catch(e){return Response.json({error:e instanceof Error?e.message:"No se pudo agregar."},{status:500})}}
export async function PATCH(request:Request){try{const p=await request.json() as {id:number;name:string;stock:number|null;unit:string;active:boolean};const [item]=await getDb().update(inventoryItems).set(p).where(eq(inventoryItems.id,p.id)).returning();return Response.json({item})}catch(e){return Response.json({error:e instanceof Error?e.message:"No se pudo actualizar."},{status:500})}}
