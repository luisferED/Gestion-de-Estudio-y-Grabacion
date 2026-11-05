import {and,asc,eq,gte,lt} from "drizzle-orm";
import {env} from "cloudflare:workers";
import {getDb} from "../../../db";
import {dutyAssignments,technicalStaff} from "../../../db/schema";
import {dutyDayPolicy} from "../../../lib/work-calendar";

const normalized=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toUpperCase();
const minutes=(value:string)=>{const [hour,minute]=value.split(":").map(Number);return hour*60+minute};
const isWeekend=(date:string)=>{const day=new Date(`${date}T12:00:00`).getDay();return day===0||day===6};
const present=(row:typeof dutyAssignments.$inferSelect)=>{const physicalMinutes=Math.max(0,minutes(row.endTime)-minutes(row.startTime));return {...row,turnCategory:isWeekend(row.date)||Boolean(row.holidayName)?"Turno extraordinario":"Turno ordinario",physicalHours:physicalMinutes/60,equivalentHours:physicalMinutes/60*row.multiplierX100/100}};
async function ensureTable(){await env.DB.prepare("CREATE TABLE IF NOT EXISTS duty_assignments (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, date text NOT NULL, staff_name text NOT NULL, role text NOT NULL, resource text NOT NULL, label text NOT NULL, start_time text NOT NULL, end_time text NOT NULL, day_type text DEFAULT 'ordinario' NOT NULL, holiday_name text DEFAULT '' NOT NULL, multiplier_x100 integer DEFAULT 100 NOT NULL, notes text DEFAULT '' NOT NULL, active integer DEFAULT true NOT NULL, created_by text DEFAULT '' NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_by text DEFAULT '' NOT NULL, updated_at text, cancelled_by text DEFAULT '' NOT NULL, cancelled_at text)").run();try{await env.DB.prepare("ALTER TABLE duty_assignments ADD COLUMN updated_by text DEFAULT '' NOT NULL").run()}catch{}try{await env.DB.prepare("ALTER TABLE duty_assignments ADD COLUMN updated_at text").run()}catch{}try{await env.DB.prepare("ALTER TABLE duty_assignments ADD COLUMN cancelled_by text DEFAULT '' NOT NULL").run()}catch{}try{await env.DB.prepare("ALTER TABLE duty_assignments ADD COLUMN cancelled_at text").run()}catch{}try{await env.DB.prepare("ALTER TABLE technical_staff ADD COLUMN photo_data text DEFAULT '' NOT NULL").run()}catch{}}

export async function GET(request:Request){
  try{
    
    const url=new URL(request.url),year=url.searchParams.get("year"),month=url.searchParams.get("month")||new Date().toISOString().slice(0,7),from=year?`${year}-01-01`:`${month}-01`,toDate=new Date(`${from}T12:00:00`);if(year)toDate.setFullYear(toDate.getFullYear()+1);else toDate.setMonth(toDate.getMonth()+1);
    const rows=await getDb().select().from(dutyAssignments).where(and(gte(dutyAssignments.date,from),lt(dutyAssignments.date,toDate.toISOString().slice(0,10)))).orderBy(asc(dutyAssignments.date),asc(dutyAssignments.startTime),asc(dutyAssignments.staffName));
    return Response.json({assignments:rows.map(present)});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"No se pudieron cargar los turnos asignados."},{status:500})}
}

export async function POST(request:Request){
  try{
    
    const payload=await request.json() as {date:string;label:string;resource:string;startTime:string;endTime:string;isHoliday?:boolean;holidayName?:string;notes?:string;staff?:{name:string;role:string}[]};
    if(!payload.date||!payload.label?.trim()||!payload.resource||!payload.startTime||!payload.endTime)return Response.json({error:"Complete fecha, motivo, espacio y horario."},{status:400});
    if(minutes(payload.startTime)>=minutes(payload.endTime))return Response.json({error:"La hora final debe ser posterior a la inicial."},{status:400});
    if(!payload.staff?.length)return Response.json({error:"Seleccione al menos una persona operativa."},{status:400});
    if(!payload.isHoliday&&!isWeekend(payload.date))return Response.json({error:"Los turnos extraordinarios solo se registran en fines de semana o feriados."},{status:400});
    const activeStaff=await getDb().select().from(technicalStaff).where(eq(technicalStaff.active,true)),allowed=new Set(activeStaff.filter(member=>normalized(member.role)!=="TECNICO").map(member=>`${member.name}|${member.role}`));
    const selected=payload.staff.filter(member=>allowed.has(`${member.name}|${member.role}`));
    if(!selected.length)return Response.json({error:"El turno debe asignarse a personal operativo. El rol Técnico no genera horas."},{status:400});
    const holiday=Boolean(payload.isHoliday),createdBy=String(request.headers.get("x-ed-user-email")||"");
    const values=selected.map(member=>{const policy=dutyDayPolicy(member.name,payload.date,holiday);return {date:payload.date,staffName:member.name,role:member.role,resource:payload.resource,label:payload.label.trim(),startTime:payload.startTime,endTime:payload.endTime,dayType:policy.dayType,holidayName:holiday?String(payload.holidayName||"Feriado").trim():"",multiplierX100:policy.multiplierX100,notes:String(payload.notes||"").trim(),active:true,createdBy}});
    const created=await getDb().insert(dutyAssignments).values(values).returning();
    return Response.json({assignments:created.map(present)},{status:201});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"No se pudo asignar el turno."},{status:500})}
}

export async function PATCH(request:Request){
  try{
    
    const payload=await request.json() as {id:number;action?:"restore";date:string;label:string;resource:string;startTime:string;endTime:string;isHoliday?:boolean;holidayName?:string;notes?:string;staffName:string;role:string};
    if(!payload.id)return Response.json({error:"Turno inválido."},{status:400});
    const db=getDb();
    if(payload.action==="restore"){
      const [before]=await db.select().from(dutyAssignments).where(eq(dutyAssignments.id,payload.id)).limit(1);
      if(!before)return Response.json({error:"Turno inexistente."},{status:404});
      if(before.active)return Response.json({error:"El turno ya se encuentra activo."},{status:409});
      const [assignment]=await db.update(dutyAssignments).set({active:true,cancelledBy:"",cancelledAt:null,updatedBy:String(request.headers.get("x-ed-user-email")||""),updatedAt:new Date().toISOString()}).where(eq(dutyAssignments.id,payload.id)).returning();
      return Response.json({assignment:present(assignment),restored:true});
    }
    if(!payload.date||!payload.label?.trim()||!payload.resource||!payload.startTime||!payload.endTime||!payload.staffName||!payload.role)return Response.json({error:"Complete fecha, actividad, espacio, horario y personal."},{status:400});
    if(minutes(payload.startTime)>=minutes(payload.endTime))return Response.json({error:"La hora final debe ser posterior a la inicial."},{status:400});
    if(!payload.isHoliday&&!isWeekend(payload.date))return Response.json({error:"Los turnos extraordinarios solo pueden quedar en fines de semana o feriados."},{status:400});
    const [before]=await db.select().from(dutyAssignments).where(eq(dutyAssignments.id,payload.id)).limit(1);
    if(!before)return Response.json({error:"Turno inexistente."},{status:404});
    if(!before.active)return Response.json({error:"No se puede editar un turno anulado."},{status:409});
    const activeStaff=await db.select().from(technicalStaff).where(eq(technicalStaff.active,true)),allowed=new Set(activeStaff.filter(member=>normalized(member.role)!=="TECNICO").map(member=>`${member.name}|${member.role}`));
    if(!allowed.has(`${payload.staffName}|${payload.role}`))return Response.json({error:"Seleccione una persona operativa activa y su función registrada."},{status:400});
    const holiday=Boolean(payload.isHoliday),policy=dutyDayPolicy(payload.staffName,payload.date,holiday);
    const [assignment]=await db.update(dutyAssignments).set({date:payload.date,staffName:payload.staffName,role:payload.role,resource:payload.resource,label:payload.label.trim(),startTime:payload.startTime,endTime:payload.endTime,dayType:policy.dayType,holidayName:holiday?String(payload.holidayName||"Feriado").trim():"",multiplierX100:policy.multiplierX100,notes:String(payload.notes||"").trim(),updatedBy:String(request.headers.get("x-ed-user-email")||""),updatedAt:new Date().toISOString()}).where(eq(dutyAssignments.id,payload.id)).returning();
    return Response.json({assignment:present(assignment)});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"No se pudo modificar el turno."},{status:500})}
}

export async function DELETE(request:Request){
  try{
    
    const payload=await request.json() as {id:number};
    if(!payload.id)return Response.json({error:"Turno inválido."},{status:400});
    const [assignment]=await getDb().update(dutyAssignments).set({active:false,cancelledBy:String(request.headers.get("x-ed-user-email")||""),cancelledAt:new Date().toISOString()}).where(eq(dutyAssignments.id,payload.id)).returning();
    if(!assignment)return Response.json({error:"Turno inexistente."},{status:404});
    return Response.json({assignment});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"No se pudo anular el turno."},{status:500})}
}
