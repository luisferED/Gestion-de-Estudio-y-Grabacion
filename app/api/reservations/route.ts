import { and, eq, lt, gt, asc, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { auditLogs, editingStaff, reservations, scheduleBlocks, smtpSettings, users } from "../../../db/schema";
import { assignOperators, requiresManualAssignment } from "../../../lib/operator-roster";
import { sendSmtpMail } from "../../../lib/smtp";

const FIXED = [
  { start: "08:00", end: "09:00", title: "Preparación Para Ellas", program: "Para Ellas", color: "#E9A2B5", kind: "preparación" },
  { start: "09:00", end: "11:00", title: "Para Ellas · En vivo", program: "Para Ellas", color: "#E9A2B5", kind: "en vivo" },
  { start: "11:00", end: "11:15", title: "Avance informativo y grabación avance informativo", program: "Avance informativo", color: "#E26954", kind: "vivo + grabación" },
  { start: "12:00", end: "12:15", title: "Grabación cápsulas Espectáculos · Cultura", program: "Noticiero", color: "#E5A23B", kind: "grabación" },
  { start: "12:30", end: "14:00", title: "Noticiero · En vivo", program: "Noticiero", color: "#4976BA", kind: "en vivo" },
  { start: "18:00", end: "20:00", title: "De tu taco · En vivo", program: "De tu taco", color: "#56A68A", kind: "en vivo" },
  { start: "20:00", end: "20:30", title: "Preparación editorial", program: "ON", color: "#8D6CC4", kind: "preparación" },
  { start: "20:30", end: "21:00", title: "Editorial ON", program: "ON", color: "#8D6CC4", kind: "grabación" },
  { start: "21:00", end: "22:00", title: "ON · En vivo", program: "ON", color: "#8D6CC4", kind: "en vivo" },
];
const CHANGE_REASONS=["Canceló el invitado","Falla de coordinación","No llegó el invitado","Falla técnica u operativa","Otro"];
const EQUIPMENT_NEEDS=["CÁMARAS","LUCES","MICRÓFONOS","AUDIO","INTERCOMUNICACIÓN","CABLEADO / ENERGÍA","MONITOREO / VTR","OTRO APOYO"];
const EDITING_ROLES=["EDITOR","CAMAROGRAFO","FILMAKER","CLIPEADOR"];
function validReason(reason:string,detail:string){return CHANGE_REASONS.includes(reason)&&(reason!=="Otro"||detail.trim().length>=3)}
function genericEquipment(value:unknown){return [...new Set(String(value||"").split(",").map(v=>v.trim().toUpperCase()).filter(v=>EQUIPMENT_NEEDS.includes(v)))].join(", ")}
function isTalentArea(value:unknown){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toUpperCase()==="TALENTO HUMANO"}
async function ensureUsageCategory(){
  const columns=[
    "ALTER TABLE reservations ADD COLUMN usage_category text DEFAULT 'grabación' NOT NULL",
    "ALTER TABLE reservations ADD COLUMN approval_by text DEFAULT '' NOT NULL",
    "ALTER TABLE reservations ADD COLUMN approval_at text",
    "ALTER TABLE reservations ADD COLUMN denial_reason text DEFAULT '' NOT NULL",
    "ALTER TABLE reservations ADD COLUMN sound_set_people integer DEFAULT 0 NOT NULL",
    "ALTER TABLE reservations ADD COLUMN sound_microphones integer DEFAULT 0 NOT NULL",
    "ALTER TABLE reservations ADD COLUMN sound_instrument_lines integer DEFAULT 0 NOT NULL",
    "ALTER TABLE reservations ADD COLUMN sound_own_system integer DEFAULT false NOT NULL",
    "ALTER TABLE reservations ADD COLUMN editing_requests text DEFAULT '[]' NOT NULL",
    "ALTER TABLE reservations ADD COLUMN assigned_editing_staff text DEFAULT '[]' NOT NULL",
  ];
  for(const statement of columns)try{await env.DB.prepare(statement).run()}catch{}
}
function editingRoles(value:unknown){const values=Array.isArray(value)?value:String(value||"").split(",");return [...new Set(values.map(item=>normalized(item)).filter(item=>EDITING_ROLES.includes(item)))]}
function parseEditing(value:string){try{return JSON.parse(value||"[]") as {role:string;name:string}[]}catch{return []}}

function minutes(value: string) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
const normalized=(value:unknown)=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toUpperCase();
const isSoundsProgram=(value:unknown)=>normalized(value)==="SONIDOS DE LA REDACCION";
const addMinutes=(value:string,amount:number)=>{const total=minutes(value)+amount;return `${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`};
const blocksCalendar=(status:string)=>!["cancelada","denegada"].includes(status);
const recordingBuffer=(usageCategory:unknown)=>normalized(usageCategory||"GRABACION")==="GRABACION"?15:0;
// La agenda se opera en Bolivia (UTC-4). Una baja o reprogramación hecha desde
// dos horas antes del inicio ya no deja margen operativo para reutilizar el espacio.
const boliviaNow=()=>new Date(Date.now()-4*60*60*1000);
const countsAsStoppedTime=(date:string,startTime:string)=>{
  const now=boliviaNow();
  return date===now.toISOString().slice(0,10)&&now.getUTCHours()*60+now.getUTCMinutes()>=minutes(startTime)-120;
};
const privilegedReservationRoles=["administrador","jefe_operaciones","jefe_produccion","productor"];
const operationalAssignmentRoles=["administrador","jefe_operaciones","productor"];

function validate(payload: Record<string, unknown>) {
  const required = ["title", "program", "locationType", "date", "startTime", "endTime", "requester", "requesterEmail"];
  for (const field of required) if (!String(payload[field] ?? "").trim()) return `Falta completar: ${field}`;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.date))||Number.isNaN(Date.parse(String(payload.date))))return "Fecha no valida.";
  if(!["radio","estudio","exteriores"].includes(String(payload.locationType)))return "Espacio no valido.";
  if(![payload.startTime,payload.endTime].every(t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(t))))return "Horario no valido.";
  const start = String(payload.startTime);
  const end = String(payload.endTime);
  if (minutes(start) >= minutes(end)) return "La hora de fin debe ser posterior a la hora de inicio.";
  if (minutes(start) < 360 || minutes(end) > 1320) return "Las reservas deben estar entre las 06:00 y las 22:00.";
  if(payload.locationType==="estudio"){
    const startMin=minutes(start),endMin=minutes(end); // franja protegida 11:00 (660) – 12:30 (750): solo reservable dentro de 11:00–12:00 (720)
    if(startMin<750&&endMin>660&&(startMin<660||endMin>720))return "Estudio II: en la franja de 11:00 a 12:30 solo se puede reservar de 11:00 a 12:00.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(payload.requesterEmail))) return "El correo del solicitante no es válido.";
  if(isSoundsProgram(payload.program)){
    const people=Number(payload.soundSetPeople),microphones=Number(payload.soundMicrophones),lines=Number(payload.soundInstrumentLines),ownSystem=payload.soundOwnSystem===true||payload.soundOwnSystem==="on"||payload.soundOwnSystem==="true";
    if(!Number.isInteger(people)||people<1)return "Sonidos de la Redacción: indique cuántas personas estarán en set.";
    if(!ownSystem&&(!Number.isInteger(microphones)||microphones<0))return "Sonidos de la Redacción: indique cuántos micrófonos se utilizarán.";
    if(!ownSystem&&(!Number.isInteger(lines)||lines<0))return "Sonidos de la Redacción: indique cuántas líneas de instrumento se utilizarán.";
  }
  return null;
}
async function fixedConflict(payload:Record<string,unknown>){const resource=String(payload.locationType);if(resource==="exteriores")return null;const day=new Date(`${payload.date}T12:00:00`).getDay();const rows=await getDb().select().from(scheduleBlocks).where(and(eq(scheduleBlocks.active,true),eq(scheduleBlocks.resource,resource)));const source=rows.length?rows.filter(r=>r.weekdays.split(",").includes(String(day))).map(r=>({title:r.title,start:r.startTime,end:addMinutes(r.endTime,normalized(r.kind).includes("GRABACION")?15:0),scheduledEnd:r.endTime})):[];return source.find(i=>minutes(String(payload.startTime))<minutes(i.end)&&minutes(String(payload.endTime))>minutes(i.start))||null}
async function reservationConflict(payload:Record<string,unknown>,excludeId=0){const rows=await getDb().select().from(reservations).where(and(eq(reservations.date,String(payload.date)),eq(reservations.locationType,String(payload.locationType))));const start=minutes(String(payload.startTime)),end=minutes(String(payload.endTime))+recordingBuffer(payload.usageCategory);return rows.find(row=>row.id!==excludeId&&blocksCalendar(row.status)&&start<minutes(row.endTime)+recordingBuffer(row.usageCategory)&&end>minutes(row.startTime))||null}
function fixedConflictResponse(clash:{title:string;start:string;end:string}){return Response.json({error:`La grabación se solapará con “${clash.title}” (${clash.start}–${clash.end}) de la grilla fija. Puede registrarla con la advertencia; quedará pendiente hasta que Jefe de Producción la apruebe.`,code:"FIXED_OVERLAP_CONFIRMATION_REQUIRED",override:clash},{status:409})}

async function notify(payload: Record<string, unknown>, id: number, options:{recipients?:string[];kind?:"reservation"|"cancellation"|"denial"}={}) {
  const kind=options.kind||(String(payload.title).startsWith("CANCELACIÓN:")?"cancellation":"reservation"),isCancellation=kind==="cancellation",isDenial=kind==="denial";
  const subject=`${isDenial?"Solicitud rechazada":isCancellation?"Grabación cancelada":"Nueva reserva"} #${id}: ${payload.title}`;
  const heading=isDenial?"Solicitud de grabación rechazada":isCancellation?"Cancelación de grabación":"Nueva reserva de grabación",detail=isDenial?`<p><b>Motivo del rechazo:</b> ${payload.notes||"Sin detalle"}</p>`:isCancellation?`<p><b>Detalle de la cancelación:</b> ${payload.notes||"Sin detalle"}</p>`:"";
  const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body><h2>${heading}</h2><p><b>${payload.title}</b> · ${payload.program}</p><p>${payload.date}, ${payload.startTime}–${payload.endTime}</p><p>Lugar: ${payload.locationType}${payload.locationDetail ? ` · ${payload.locationDetail}` : ""}</p><p>Solicita: ${payload.requester} · ${payload.requesterEmail}</p>${detail}${!isDenial?`<p><b>Personal requerido:</b> ${payload.crewDetail||(isTalentArea(payload.requestingArea)?"No requerido":"Pendiente de definición por Operaciones")}</p><p><b>Asignación operativa:</b> ${payload.assignedOperatorsText||"Pendiente de definición por Operaciones"}</p><p><b>Necesidades generales de equipo:</b> ${payload.equipment || "Sin equipos solicitados"}</p>`:""}<p>Gestión de Uso de Estudios y Grabaciones ED · EL DEBER</p></body></html>`;
  let smtp:typeof smtpSettings.$inferSelect|undefined;try{[smtp]=await getDb().select().from(smtpSettings).where(eq(smtpSettings.id,1)).limit(1)}catch{}
  const configuredRecipients=smtp?.recipients.split(/[;,\n]/).map(value=>value.trim()).filter(Boolean)||[],to=options.recipients?.filter(Boolean).length?options.recipients.filter(Boolean):configuredRecipients;
  if(smtp?.enabled){if(!to.length)return "pendiente_configuracion";await sendSmtpMail(smtp,{to,subject,html});return "enviado"}
  const runtime = env as unknown as Record<string, string>;
  const relayUrl = runtime.CORPORATE_SMTP_RELAY_URL;
  const relayKey = runtime.CORPORATE_SMTP_RELAY_KEY;
  const recipients = options.recipients?.filter(Boolean).length?options.recipients.filter(Boolean):runtime.NOTIFICATION_EMAILS?.split(",").map((v) => v.trim()).filter(Boolean);
  if (!relayUrl || !recipients?.length) return "pendiente_configuracion";
  const response = await fetch(relayUrl, {
    method: "POST",
    headers: { ...(relayKey ? { Authorization: `Bearer ${relayKey}` } : {}), "Content-Type": "application/json" },
    body: JSON.stringify({
      smtp: { host: runtime.SMTP_HOST, port: Number(runtime.SMTP_PORT || 587), secure: runtime.SMTP_SECURE === "true", username: runtime.SMTP_USERNAME },
      from: runtime.MAIL_FROM || runtime.SMTP_USERNAME,
      to: recipients,
      subject,
      html,
    }),
  });
  if (!response.ok) throw new Error("La reserva se guardó, pero el correo no pudo enviarse.");
  return "enviado";
}

export async function GET(request: Request) {
  try {
    
    const url = new URL(request.url);
    const from = url.searchParams.get("from") ?? "0000-01-01";
    const to = url.searchParams.get("to") ?? "9999-12-31";
    const rows = await getDb().select().from(reservations).where(and(gt(reservations.date, from < "0000-01-02" ? "" : from), lt(reservations.date, to))).orderBy(asc(reservations.date), asc(reservations.startTime));
    return Response.json({ reservations: rows.map(r=>({...r,assignedOperators:JSON.parse(r.assignedOperators||"[]"),editingRequests:editingRoles(r.editingRequests),assignedEditingStaff:parseEditing(r.assignedEditingStaff)})), fixed: [] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo cargar la agenda." }, { status: error instanceof Error && error.message.includes("RESERVATION_TIME_CONFLICT") ? 409 : 500 });
  }
}

export async function POST(request: Request) {
  try {
    
    const payload = await request.json() as Record<string, unknown>;
    const issue = validate(payload);
    if (issue) return Response.json({ error: issue }, { status: 400 });
    const actor=await activeActor(String(request.headers.get("x-ed-user-email")||""));
    if(!actor)return Response.json({error:"No se pudo identificar al usuario que registra la solicitud."},{status:403});
    if(!privilegedReservationRoles.includes(actor.role)){payload.requesterEmail=actor.email;payload.requester=actor.name;}
    const fixedClash=await fixedConflict(payload);if(fixedClash&&payload.allowFixedOverride!==true)return fixedConflictResponse(fixedClash)
    const db = getDb();
    const activeExisting=await reservationConflict(payload);
    if (activeExisting) return Response.json({ error: `Horario no disponible: coincide con “${activeExisting.title}” (${activeExisting.startTime}–${activeExisting.endTime}) e incluye 15 minutos operativos posteriores.` }, { status: 409 });
    const talentRequest=isTalentArea(payload.requestingArea),requestedRoles=talentRequest?[]:String(payload.crewDetail||"").split(",").map(v=>v.trim()).filter(Boolean),assignedOperators=talentRequest?[]:await assignOperators(String(payload.date),String(payload.locationType),String(payload.program),String(payload.startTime),String(payload.endTime),requestedRoles);
    if(talentRequest&&payload.locationType==="estudio")payload.usageCategory="actividades internas";
    const [saved] = await db.insert(reservations).values({
      title: String(payload.program), program: String(payload.program), requestingArea:String(payload.requestingArea||"PRODUCCIÓN"), locationType: String(payload.locationType), usageCategory:payload.locationType==="estudio"?String(payload.usageCategory||"grabación"):"grabación", locationDetail: payload.locationType==="exteriores"?String(payload.locationDetail ?? ""):"", date: String(payload.date), startTime: String(payload.startTime), endTime: String(payload.endTime), requester: String(payload.requester), requesterEmail: String(payload.requesterEmail), requesterPhone: String(payload.requesterPhone ?? ""), crew: requestedRoles.length, crewDetail: requestedRoles.join(", "), assignedOperators:JSON.stringify(assignedOperators), equipment: talentRequest?"":payload.locationType==="exteriores"?genericEquipment(payload.equipment):"", requirements: String(payload.requirements ?? ""), notes: String(payload.notes ?? ""), color: String(payload.color ?? "#4976BA"),status:"pendiente",soundSetPeople:isSoundsProgram(payload.program)?Number(payload.soundSetPeople):0,soundMicrophones:isSoundsProgram(payload.program)&&!payload.soundOwnSystem?Number(payload.soundMicrophones):0,soundInstrumentLines:isSoundsProgram(payload.program)&&!payload.soundOwnSystem?Number(payload.soundInstrumentLines):0,soundOwnSystem:isSoundsProgram(payload.program)&&Boolean(payload.soundOwnSystem),editingRequests:JSON.stringify(payload.locationType==="exteriores"?[]:editingRoles(payload.editingRoles)),assignedEditingStaff:"[]",
    }).returning();
    await db.insert(auditLogs).values({reservationId:saved.id,action:"creación",actorEmail:actor.email,actorName:actor.name,changes:JSON.stringify({estado:{after:"pendiente"},horario:{after:{date:saved.date,startTime:saved.startTime,endTime:saved.endTime,resource:saved.locationType}},programa:{after:saved.program},...(fixedClash?{solapamientoGrillaFija:{after:fixedClash}}:{})})});
    let emailStatus = "pendiente_configuracion",emailError="";
    const assignedOperatorsText=assignedOperators.map(a=>`${a.role}: ${a.name} (${a.startTime}–${a.endTime})`).join("; ");
    try { emailStatus = await notify({...payload,equipment:saved.equipment,crewDetail:saved.crewDetail,assignedOperatorsText}, saved.id); } catch(error) { emailStatus = "error";emailError=error instanceof Error?error.message:"No se pudo enviar el correo."; }
    return Response.json({ reservation:{...saved,assignedOperators}, emailStatus,emailError }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo guardar la reserva." }, { status: error instanceof Error && error.message.includes("RESERVATION_TIME_CONFLICT") ? 409 : 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    
    const payload = await request.json() as Record<string, unknown>;
    const id = Number(payload.id);
    if (!id) return Response.json({ error: "Solicitud inválida." }, { status: 400 });
    if(payload.action==="approve"||payload.action==="deny"){
      const actorEmail=String(request.headers.get("x-ed-user-email")||"").trim().toLowerCase(),db=getDb(),[actor]=await db.select().from(users).where(and(eq(users.email,actorEmail),eq(users.active,true))).limit(1);
      if(!actor||!["productor","jefe_produccion","administrador","jefe_operaciones"].includes(actor.role))return Response.json({error:"Solo Productor, Jefe de Producción, Administrador o Jefe de Operaciones puede aprobar o denegar reservas."},{status:403});
      const [before]=await db.select().from(reservations).where(eq(reservations.id,id)).limit(1);if(!before)return Response.json({error:"Solicitud inexistente."},{status:404});
      if(["cancelada","completada"].includes(before.status))return Response.json({error:"Esta solicitud ya no puede ser revisada."},{status:409});
      const approved=payload.action==="approve",reason=String(payload.reason||"").trim();if(!approved&&reason.length<3)return Response.json({error:"Indique el motivo de la denegación."},{status:400});
      const fixedClash=approved?await fixedConflict({locationType:before.locationType,date:before.date,startTime:before.startTime,endTime:before.endTime}):null;
      if(fixedClash&&!["jefe_produccion","administrador"].includes(actor.role))return Response.json({error:`Esta solicitud se solapa con “${fixedClash.title}”. Debe ser aprobada por Jefe de Producción.`},{status:403});
      const status=approved?"aprobada":"denegada",[saved]=await db.update(reservations).set({status,approvalBy:actor.email,approvalAt:new Date().toISOString(),denialReason:approved?"":reason}).where(eq(reservations.id,id)).returning();
      await db.insert(auditLogs).values({reservationId:id,action:approved?"aprobación":"denegación",actorEmail:actor.email,actorName:actor.name,changes:JSON.stringify({status:{before:before.status,after:status},motivo:{after:approved?"Aprobada por Jefatura de Producción":reason},...(fixedClash?{solapamientoGrillaFija:{after:fixedClash}}:{})})});
      let emailStatus="no_aplica",emailError="";
      if(!approved)try{emailStatus=await notify({...before,title:`RECHAZADA: ${before.title}`,notes:reason},before.id,{kind:"denial",recipients:[before.requesterEmail]})}catch(error){emailStatus="error";emailError=error instanceof Error?error.message:"No se pudo enviar el correo de rechazo."}
      return Response.json({reservation:{...saved,assignedOperators:JSON.parse(saved.assignedOperators||"[]")},emailStatus,emailError});
    }
    if(payload.action==="assign-editing"){
      const actorEmail=String(request.headers.get("x-ed-user-email")||"").trim().toLowerCase(),db=getDb(),[actor]=await db.select().from(users).where(and(eq(users.email,actorEmail),eq(users.active,true))).limit(1);
      if(!actor||!["editor","productor","administrador","jefe_operaciones"].includes(actor.role))return Response.json({error:"Solo el rol Editor, Productor u Operaciones puede designar personal de edición."},{status:403});
      const [before]=await db.select().from(reservations).where(eq(reservations.id,id)).limit(1);if(!before)return Response.json({error:"Solicitud inexistente."},{status:404});
      const requested=editingRoles(before.editingRequests),assignments=(Array.isArray(payload.assignments)?payload.assignments:[]) as {role?:string;name?:string}[];
      const cleaned=assignments.map(item=>({role:normalized(item.role),name:String(item.name||"").trim().toUpperCase()})).filter(item=>requested.includes(item.role)&&item.name);
      if(cleaned.length!==requested.length||new Set(cleaned.map(item=>item.role)).size!==cleaned.length)return Response.json({error:"Designe una persona activa para cada función de edición solicitada."},{status:400});
      const people=await db.select().from(editingStaff);if(cleaned.some(item=>!people.some(person=>person.active&&person.role===item.role&&person.name===item.name)))return Response.json({error:"Una de las personas seleccionadas no está activa en el catálogo de edición."},{status:400});
      const [saved]=await db.update(reservations).set({assignedEditingStaff:JSON.stringify(cleaned)}).where(eq(reservations.id,id)).returning();
      await db.insert(auditLogs).values({reservationId:id,action:"asignación de edición",actorEmail:actor.email,actorName:actor.name,changes:JSON.stringify({personalEdicion:{before:parseEditing(before.assignedEditingStaff),after:cleaned}})});
      return Response.json({reservation:{...saved,assignedOperators:JSON.parse(saved.assignedOperators||"[]"),editingRequests:requested,assignedEditingStaff:cleaned}});
    }
    const issue = validate(payload);
    if (issue) return Response.json({ error: issue }, { status: 400 });
    const fixedClash=await fixedConflict(payload);if(fixedClash&&payload.allowFixedOverride!==true)return fixedConflictResponse(fixedClash)
    const actorEmail = String(request.headers.get("x-ed-user-email")||payload.actorEmail || "").trim().toLowerCase();
    const db = getDb();
    const [actor] = await db.select().from(users).where(and(eq(users.email, actorEmail), eq(users.active, true))).limit(1);
    if (!actor) return Response.json({ error: "Seleccione un usuario corporativo activo para registrar el cambio." }, { status: 403 });
    const [before] = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
    if (!before) return Response.json({ error: "La solicitud ya no existe." }, { status: 404 });
    if(!privilegedReservationRoles.includes(actor.role)&&actor.email!==before.requesterEmail)return Response.json({error:"Solo el solicitante o un Productor puede modificar esta solicitud."},{status:403});
    if(!privilegedReservationRoles.includes(actor.role)){payload.requesterEmail=before.requesterEmail;payload.requester=before.requester;}
    const conflict=await reservationConflict(payload,id);
    if (conflict) return Response.json({ error: `Horario no disponible: coincide con “${conflict.title}” (${conflict.startTime}–${conflict.endTime}) e incluye 15 minutos operativos posteriores.` }, { status: 409 });
    const dateChanged=before.date!==String(payload.date),timeChanged=before.startTime!==String(payload.startTime)||before.endTime!==String(payload.endTime),scheduleChanged=dateChanged||timeChanged,reason=String(payload.rescheduleReason||""),detail=String(payload.rescheduleDetail||"");
    if(scheduleChanged&&!validReason(reason,detail))return Response.json({error:"Indique un motivo válido para el cambio de fecha u horario. Si elige Otro, debe especificarlo."},{status:400});
    const canManageOperations=operationalAssignmentRoles.includes(actor.role),talentRequest=isTalentArea(payload.requestingArea),requestedRoles=talentRequest?[]:String(payload.crewDetail||"").split(",").map(v=>v.trim()).filter(Boolean);
    if(talentRequest&&payload.locationType==="estudio")payload.usageCategory="actividades internas";
    const manualAssignments=Array.isArray(payload.manualAssignments)?payload.manualAssignments as {name:string;role:string;startTime:string;endTime:string}[]:[];
    const manual=requiresManualAssignment(String(payload.date),String(payload.locationType));
    const assignedOperators=talentRequest?[]:manual?(canManageOperations?manualAssignments.filter(a=>a.name?.trim()&&requestedRoles.includes(a.role)).map(a=>({...a,name:a.name.trim().toUpperCase(),startTime:String(payload.startTime),endTime:String(payload.endTime)})):(JSON.parse(before.assignedOperators||"[]") as {name:string;role:string;startTime:string;endTime:string}[]).filter(a=>requestedRoles.includes(a.role)).map(a=>({...a,startTime:String(payload.startTime),endTime:String(payload.endTime)}))):await assignOperators(String(payload.date),String(payload.locationType),String(payload.program),String(payload.startTime),String(payload.endTime),requestedRoles);
    const nextEditingRequests=payload.locationType==="exteriores"?[]:editingRoles(payload.editingRoles);
    const values = { title:String(payload.program), program:String(payload.program), requestingArea:String(payload.requestingArea||"PRODUCCIÓN"), locationType:String(payload.locationType), usageCategory:payload.locationType==="estudio"?String(payload.usageCategory||"grabación"):"grabación", locationDetail:payload.locationType==="exteriores"?String(payload.locationDetail||""):"", date:String(payload.date), startTime:String(payload.startTime), endTime:String(payload.endTime), requester:String(payload.requester), requesterEmail:String(payload.requesterEmail), requesterPhone:String(payload.requesterPhone||""), crew:requestedRoles.length, crewDetail:requestedRoles.join(", "), assignedOperators:JSON.stringify(assignedOperators), equipment:talentRequest?"":payload.locationType==="exteriores"?genericEquipment(payload.equipment):"", requirements:String(payload.requirements||""), notes:String(payload.notes||""), color:String(payload.color||"#4976BA"),status:"pendiente",approvalBy:"",approvalAt:null,denialReason:"",soundSetPeople:isSoundsProgram(payload.program)?Number(payload.soundSetPeople):0,soundMicrophones:isSoundsProgram(payload.program)&&!payload.soundOwnSystem?Number(payload.soundMicrophones):0,soundInstrumentLines:isSoundsProgram(payload.program)&&!payload.soundOwnSystem?Number(payload.soundInstrumentLines):0,soundOwnSystem:isSoundsProgram(payload.program)&&Boolean(payload.soundOwnSystem),editingRequests:JSON.stringify(nextEditingRequests),assignedEditingStaff:JSON.stringify(parseEditing(before.assignedEditingStaff).filter(item=>nextEditingRequests.includes(normalized(item.role)))),...(scheduleChanged?{rescheduleReason:reason,rescheduleDetail:detail}:{}) };
    const changes: Record<string,{before:unknown;after:unknown}> = {};
    for (const [key,value] of Object.entries(values)) if (String(before[key as keyof typeof before] ?? "") !== String(value ?? "")) changes[key] = { before: before[key as keyof typeof before], after: value };
    const [saved] = await db.update(reservations).set(values).where(eq(reservations.id,id)).returning();
    const stoppedTime=scheduleChanged&&countsAsStoppedTime(before.date,before.startTime);
    if(scheduleChanged){changes.horarioOriginal={before:null,after:{date:before.date,startTime:before.startTime,endTime:before.endTime,resource:before.locationType,program:before.program,requester:before.requester,requesterEmail:before.requesterEmail}};changes.horasParadas={before:null,after:stoppedTime};}
    if(fixedClash)changes.solapamientoGrillaFija={before:null,after:fixedClash};
    await db.insert(auditLogs).values({ reservationId:id, action:scheduleChanged?"reprogramación":"edición", actorEmail:actor.email, actorName:actor.name, changes:JSON.stringify(changes) });
    return Response.json({ reservation:{...saved,assignedOperators} });
  } catch(error) { return Response.json({ error:error instanceof Error?error.message:"No se pudo editar la solicitud." },{status:error instanceof Error&&error.message.includes("RESERVATION_TIME_CONFLICT")?409:500}); }
}

async function activeActor(email:string){return (await getDb().select().from(users).where(and(eq(users.email,email.trim().toLowerCase()),eq(users.active,true))).limit(1))[0]}

export async function DELETE(request:Request){
  try{const p=await request.json() as {id:number;actorEmail:string;reason:string;detail:string};if(!validReason(p.reason||"",p.detail||""))return Response.json({error:"Seleccione el motivo de cancelación. Si elige Otro, debe especificarlo."},{status:400});const db=getDb(),actor=await activeActor(String(request.headers.get("x-ed-user-email")||p.actorEmail||""));if(!actor)return Response.json({error:"Seleccione un usuario corporativo activo."},{status:403});const [before]=await db.select().from(reservations).where(eq(reservations.id,p.id)).limit(1);if(!before)return Response.json({error:"Solicitud inexistente."},{status:404});if(!privilegedReservationRoles.includes(actor.role)&&actor.email!==before.requesterEmail)return Response.json({error:"Solo el solicitante o un Productor puede cancelar esta solicitud."},{status:403});const stoppedTime=countsAsStoppedTime(before.date,before.startTime),sameDay=before.date===boliviaNow().toISOString().slice(0,10);const [saved]=await db.update(reservations).set({status:"cancelada",cancelledAt:sql`CURRENT_TIMESTAMP`,cancellationReason:p.reason,cancellationDetail:p.detail||"",sameDayCancellation:sameDay}).where(eq(reservations.id,p.id)).returning();await db.insert(auditLogs).values({reservationId:p.id,action:"cancelación",actorEmail:actor.email,actorName:actor.name,changes:JSON.stringify({status:{before:before.status,after:"cancelada"},motivo:{after:p.reason},detalle:{after:p.detail||""},cancelacionMismoDia:{after:sameDay},horarioAfectado:{after:{date:before.date,startTime:before.startTime,endTime:before.endTime,resource:before.locationType,program:before.program,requester:before.requester,requesterEmail:before.requesterEmail}},horasParadas:{after:stoppedTime}})});let emailStatus="pendiente_configuracion";try{emailStatus=await notify({...before,title:`CANCELACIÓN: ${before.title}`,notes:`Motivo: ${p.reason}${p.detail?` · ${p.detail}`:""}`},before.id)}catch{emailStatus="error"}return Response.json({reservation:saved,emailStatus})}catch(error){return Response.json({error:error instanceof Error?error.message:"No se pudo cancelar."},{status:error instanceof Error&&error.message.includes("RESERVATION_TIME_CONFLICT")?409:500})}
}

export async function PUT(request:Request){
  try{const p=await request.json() as {id:number;actorEmail:string;actualStartTime:string;actualEndTime?:string;action?:string;delayReason?:string};const db=getDb(),actor=await activeActor(p.actorEmail||"");if(!actor)return Response.json({error:"Seleccione un usuario corporativo activo."},{status:403});const [before]=await db.select().from(reservations).where(eq(reservations.id,p.id)).limit(1);if(!before)return Response.json({error:"Solicitud inexistente."},{status:404});if(p.action==="delay"){const delay=Math.max(0,minutes(p.actualStartTime)-minutes(before.startTime));if(!delay)return Response.json({error:"La nueva hora debe ser posterior a la programada."},{status:400});const [saved]=await db.update(reservations).set({status:"retrasada",actualStartTime:p.actualStartTime,delayMinutes:delay,delayReason:p.delayReason||""}).where(eq(reservations.id,p.id)).returning();await db.insert(auditLogs).values({reservationId:p.id,action:"retraso",actorEmail:actor.email,actorName:actor.name,changes:JSON.stringify({inicioProgramado:{after:before.startTime},inicioReal:{after:p.actualStartTime},minutosPerdidos:{after:delay},motivo:{after:p.delayReason||""}})});return Response.json({reservation:saved})}if(!p.actualEndTime||minutes(p.actualStartTime)>=minutes(p.actualEndTime))return Response.json({error:"La hora real de fin debe ser posterior."},{status:400});const delay=Math.max(before.delayMinutes||0,minutes(p.actualStartTime)-minutes(before.startTime));const [saved]=await db.update(reservations).set({status:"completada",actualStartTime:p.actualStartTime,actualEndTime:p.actualEndTime,delayMinutes:delay}).where(eq(reservations.id,p.id)).returning();await db.insert(auditLogs).values({reservationId:p.id,action:"finalización",actorEmail:actor.email,actorName:actor.name,changes:JSON.stringify({status:{after:"completada"},actualStartTime:{after:p.actualStartTime},actualEndTime:{after:p.actualEndTime},delayMinutes:{after:delay}})});return Response.json({reservation:saved})}catch(error){return Response.json({error:error instanceof Error?error.message:"No se pudo actualizar el uso."},{status:error instanceof Error&&error.message.includes("RESERVATION_TIME_CONFLICT")?409:500})}
}
