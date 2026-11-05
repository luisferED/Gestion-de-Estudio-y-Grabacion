import { asc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { operatorShifts } from "../../../db/schema";

const defaults=[
  ["ÁLVARO CALIZAYA","REALIZADOR","radio","Turno AM","1,2,3,4,5","06:00","14:00"],
  ["IVÁN CANEDO","SONIDISTA","radio","Radio AM","1,2,3,4,5","06:00","09:00"],
  ["ÁNGEL BELTRÁN","SONIDISTA","radio","Radio AM","1,2,3,4,5","09:00","14:00"],
  ["ANDRÉS SUÁREZ","REALIZADOR","radio","Turno PM","1,2,3,4,5","14:00","22:00"],
  ["DAVID ESCOBAR","SONIDISTA","radio","Turno PM","1,2,3,4,5","14:00","22:00"],
  ["ÁLVARO CALIZAYA","REALIZADOR","radio","Sábado Radio","6","08:00","14:00"],
  ["IVÁN CANEDO","SONIDISTA","radio","Sábado Radio","6","08:00","14:00"],
  ["ANDRÉS SUÁREZ","REALIZADOR","radio","Domingo Radio PM","0","14:00","22:00"],
  ["DAVID ESCOBAR","SONIDISTA","radio","Domingo Radio PM","0","14:00","22:00"],
  ["GIAN FRANCO DELGADO","REALIZADOR","estudio","Estudio II AM","1,2,3,4,5","08:00","14:00"],
  ["ANDREA RIVERO","OPERADOR DE VTR","estudio","Estudio II AM","1,2,3,4,5","08:00","14:00"],
  ["LENNY MALDONADO","ASISTENTE DE SONIDO","estudio","Estudio II AM","1,2,3,4,5","08:00","14:00"],
  ["JUAN PABLO GIL","CAMARÓGRAFO","estudio","Estudio II AM","1,2,3,4,5","08:00","14:00"],
  ["IVÁN CANEDO","SONIDISTA","estudio","Estudio II AM","1,2,3,4,5","09:00","14:00"],
  ["DIEGO CISTERNAS","REALIZADOR","estudio","Estudio II PM","1,2,3,4,5","14:00","22:00"],
  ["ÁNGEL DORADO","SONIDISTA","estudio","Estudio II PM","1,2,3,4,5","14:00","22:00"],
  ["LENNY MALDONADO","ASISTENTE DE SONIDO","estudio","Cierre ON","1,2,3,4,5","20:00","22:00"],
  ["ANDREA RIVERO","OPERADOR DE VTR","estudio","Cierre ON","1,2,3,4,5","20:00","22:00"],
  ["GIAN FRANCO DELGADO","CAMARÓGRAFO","estudio","Cierre ON","1,2,3,4,5","20:00","22:00"],
  ["JUAN PABLO GIL","REALIZADOR","estudio","De Tu Taco","1,2,3,4,5","18:00","20:00"],
  ["ÁNGEL BELTRÁN","SONIDISTA","estudio","De Tu Taco","1,2,3,4,5","18:00","20:00"],
] as const;

const minutes=(value:string)=>{const [h,m]=value.split(":").map(Number);return h*60+m};
async function ensureTable(){await env.DB.prepare(`CREATE TABLE IF NOT EXISTS operator_shifts (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, staff_name text NOT NULL, role text NOT NULL, resource text NOT NULL, label text DEFAULT 'Turno operativo' NOT NULL, weekdays text DEFAULT '1,2,3,4,5' NOT NULL, start_time text NOT NULL, end_time text NOT NULL, active integer DEFAULT true NOT NULL)`).run()}
async function ensureSeed(){const db=getDb(),existing=await db.select().from(operatorShifts).limit(1);if(!existing.length){const values=defaults.map(([staffName,role,resource,label,weekdays,startTime,endTime])=>({staffName,role,resource,label,weekdays,startTime,endTime}));for(let index=0;index<values.length;index+=8)await db.insert(operatorShifts).values(values.slice(index,index+8))}await env.DB.prepare("UPDATE operator_shifts SET start_time='14:00',end_time='22:00',label='Domingo Radio PM' WHERE weekdays='0' AND start_time='06:00' AND end_time='22:00' AND staff_name IN ('ANDRÉS SUÁREZ','DAVID ESCOBAR')").run()}
function valid(p:{staffName?:string;role?:string;resource?:string;weekdays?:string;startTime?:string;endTime?:string}){if(!p.staffName?.trim()||!p.role?.trim()||!p.resource?.trim()||!p.weekdays?.trim()||!p.startTime||!p.endTime)return "Complete persona, función, espacio, días y horario.";if(minutes(p.startTime)>=minutes(p.endTime))return "La hora final debe ser posterior a la inicial.";return ""}

export async function GET(){try{if((env as unknown as Record<string,string>).SEED_DEMO_DATA==="true"){await ensureSeed();}return Response.json({shifts:await getDb().select().from(operatorShifts).orderBy(asc(operatorShifts.resource),asc(operatorShifts.staffName),asc(operatorShifts.startTime))})}catch(error){return Response.json({error:error instanceof Error?error.message:"No se pudieron cargar los turnos."},{status:500})}}

export async function POST(request:Request){try{const p=await request.json() as typeof operatorShifts.$inferInsert,issue=valid(p);if(issue)return Response.json({error:issue},{status:400});const [shift]=await getDb().insert(operatorShifts).values({...p,staffName:p.staffName.trim().toUpperCase(),label:p.label?.trim()||"Turno operativo",active:true}).returning();return Response.json({shift},{status:201})}catch(error){return Response.json({error:error instanceof Error?error.message:"No se pudo crear el turno."},{status:500})}}

export async function PATCH(request:Request){try{const p=await request.json() as typeof operatorShifts.$inferSelect,issue=valid(p);if(issue)return Response.json({error:issue},{status:400});const [shift]=await getDb().update(operatorShifts).set({staffName:p.staffName.trim().toUpperCase(),role:p.role,resource:p.resource,label:p.label?.trim()||"Turno operativo",weekdays:p.weekdays,startTime:p.startTime,endTime:p.endTime,active:p.active}).where(eq(operatorShifts.id,p.id)).returning();if(!shift)return Response.json({error:"Turno inexistente."},{status:404});return Response.json({shift})}catch(error){return Response.json({error:error instanceof Error?error.message:"No se pudo actualizar el turno."},{status:500})}}

export async function DELETE(request:Request){try{const p=await request.json() as {id:number};const [shift]=await getDb().delete(operatorShifts).where(eq(operatorShifts.id,p.id)).returning();if(!shift)return Response.json({error:"Turno inexistente."},{status:404});return Response.json({shift})}catch(error){return Response.json({error:error instanceof Error?error.message:"No se pudo eliminar el turno."},{status:500})}}
