import { and, gte, lt } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, dutyAssignments, operatorShifts, reservations, scheduleBlocks, technicalStaff } from "../../../db/schema";
import { programs } from "../../../db/schema";
import {workTargetDays,workTargetHours} from "../../../lib/work-calendar";
import { env } from "cloudflare:workers";

const mins=(v:string|null)=>{if(!v)return 0;const [h,m]=v.split(":").map(Number);return h*60+m};
const duration=(start:string|null,end:string|null)=>Math.max(0,mins(end)-mins(start));
const normalizeRole=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toUpperCase();
const countsAsOperational=(role:string)=>normalizeRole(role)!=="TECNICO";
const unionMinutes=(intervals:[number,number][])=>{let total=0,cursor=-1;for(const [start,end] of intervals.sort((a,b)=>a[0]-b[0])){if(end<=cursor)continue;total+=Math.max(0,end-Math.max(cursor,start));cursor=Math.max(cursor,end)}return total};
const parseChanges=(value:string)=>{try{return JSON.parse(value||"{}")}catch{return {}}};
async function ensureMetricsColumns(){
  try{await env.DB.prepare("ALTER TABLE reservations ADD COLUMN usage_category text DEFAULT 'grabación' NOT NULL").run()}catch{}
  for(const statement of ["ALTER TABLE reservations ADD COLUMN approval_by text DEFAULT '' NOT NULL","ALTER TABLE reservations ADD COLUMN approval_at text","ALTER TABLE reservations ADD COLUMN denial_reason text DEFAULT '' NOT NULL","ALTER TABLE reservations ADD COLUMN sound_set_people integer DEFAULT 0 NOT NULL","ALTER TABLE reservations ADD COLUMN sound_microphones integer DEFAULT 0 NOT NULL","ALTER TABLE reservations ADD COLUMN sound_instrument_lines integer DEFAULT 0 NOT NULL","ALTER TABLE reservations ADD COLUMN sound_own_system integer DEFAULT false NOT NULL"])try{await env.DB.prepare(statement).run()}catch{}
  try{await env.DB.prepare("ALTER TABLE schedule_blocks ADD COLUMN assigned_staff text DEFAULT '[]' NOT NULL").run()}catch{}
  try{await env.DB.prepare("ALTER TABLE technical_staff ADD COLUMN photo_data text DEFAULT '' NOT NULL").run()}catch{}
}

export async function GET(request:Request){
  try{
    
    const u=new URL(request.url),month=u.searchParams.get("month")||new Date().toISOString().slice(0,7),from=`${month}-01`,next=new Date(`${from}T12:00:00`);next.setMonth(next.getMonth()+1);const to=next.toISOString().slice(0,10);
    const rows=await getDb().select().from(reservations).where(and(gte(reservations.date,from),lt(reservations.date,to)));
    const cancelled=rows.filter(r=>r.status==="cancelada"),active=rows.filter(r=>!["cancelada","denegada","pendiente"].includes(r.status)),completed=rows.filter(r=>r.status==="completada"),today=new Date(Date.now()-4*60*60*1000).toISOString().slice(0,10);
    const hours=(list:typeof rows,a:"startTime"|"actualStartTime",b:"endTime"|"actualEndTime")=>list.reduce((n,r)=>n+duration(r[a],r[b]),0)/60;
    // Las horas paradas se conservan en la bitácora: así una reprogramación no
    // pierde el horario original ni altera el reporte cuando cambie de mes.
    const disruptionRows=(await getDb().select().from(auditLogs)).flatMap(log=>{
      const changes=parseChanges(log.changes),slot=changes.horarioAfectado?.after||changes.horarioOriginal?.after;
      if(!changes.horasParadas?.after||!slot||typeof slot.date!=="string"||slot.date<from||slot.date>=to)return [];
      const current=rows.find(row=>row.id===log.reservationId);
      return [{id:`${log.id}`,reservationId:log.reservationId,date:slot.date,program:String(slot.program||current?.program||"Sin programa"),resource:String(slot.resource||current?.locationType||"estudio"),startTime:String(slot.startTime||""),endTime:String(slot.endTime||""),requester:String(slot.requester||current?.requester||""),requesterEmail:String(slot.requesterEmail||current?.requesterEmail||""),reason:String(changes.motivo?.after||current?.cancellationReason||changes.rescheduleReason?.after||"Reprogramación"),detail:String(changes.detalle?.after||changes.rescheduleDetail?.after||"") }];
    });
    const lostReservations=disruptionRows.map(c=>{
      const start=mins(c.startTime),end=mins(c.endTime),overlaps=active.filter(r=>r.date===c.date&&r.locationType===c.resource&&mins(r.startTime)<end&&mins(r.endTime)>start).map(r=>[Math.max(start,mins(r.startTime)),Math.min(end,mins(r.endTime))] as [number,number]).sort((a,b)=>a[0]-b[0]);
      let covered=0,cursor=start;for(const [a,b] of overlaps){if(b<=cursor)continue;covered+=Math.max(0,b-Math.max(cursor,a));cursor=Math.max(cursor,b)}const lostMinutes=Math.max(0,end-start-covered);
      return {...c,lostHours:lostMinutes/60};
    }).filter(item=>item.lostHours>0);
    const uncoveredCancelledMinutes=lostReservations.reduce((total,item)=>total+item.lostHours*60,0);
    const delayMinutes=rows.reduce((n,r)=>n+(r.delayMinutes||0),0),lostHours=uncoveredCancelledMinutes/60,delayHours=delayMinutes/60,actualHours=hours(completed,"actualStartTime","actualEndTime");
    const overtimeHours=completed.reduce((total,r)=>total+Math.max(0,duration(r.actualStartTime,r.actualEndTime)-duration(r.startTime,r.endTime)),0)/60;
    const efficiencyPct=(actualHours+lostHours+delayHours)>0?actualHours/(actualHours+lostHours+delayHours)*100:0;
    const logos=new Map((await getDb().select().from(programs)).map(p=>[p.name,p.logoData]));
    const byProgramMap=rows.reduce((acc,r)=>{acc[r.program]??={program:r.program,logoData:logos.get(r.program)||"",requests:0,requestedHours:0,actualHours:0,overtimeHours:0,lostHours:0};acc[r.program].requests++;acc[r.program].requestedHours+=duration(r.startTime,r.endTime)/60;if(r.status==="completada"){const requested=duration(r.startTime,r.endTime),actual=duration(r.actualStartTime,r.actualEndTime);acc[r.program].actualHours+=actual/60;acc[r.program].overtimeHours+=Math.max(0,actual-requested)/60}acc[r.program].lostHours+=(r.delayMinutes||0)/60;return acc},{} as Record<string,{program:string;logoData:string;requests:number;requestedHours:number;actualHours:number;overtimeHours:number;lostHours:number}>);
    for(const item of lostReservations){byProgramMap[item.program]??={program:item.program,logoData:logos.get(item.program)||"",requests:0,requestedHours:0,actualHours:0,overtimeHours:0,lostHours:0};byProgramMap[item.program].lostHours+=item.lostHours}
    const byProgram=Object.values(byProgramMap);
    const byRequester=Object.values(rows.reduce((acc,r)=>{const key=r.requesterEmail;acc[key]??={name:r.requester,email:key,area:r.requestingArea,requests:0,cancelled:0,hours:0};acc[key].requests++;if(r.status==="cancelada")acc[key].cancelled++;else acc[key].hours+=duration(r.startTime,r.endTime)/60;return acc},{} as Record<string,{name:string;email:string;area:string;requests:number;cancelled:number;hours:number}>));
    const cutoff=month===today.slice(0,7)?today:undefined;
    const expectedHours=workTargetHours(month,"PERSONAL GENERAL",cutoff);
    const operatorMap=new Map<string,{name:string;roles:Set<string>;theoreticalHours:number;shiftHours:number;extraordinaryHours:number;extraordinaryEquivalentHours:number}>();
    const staffRows=(await getDb().select().from(technicalStaff)).filter(s=>s.active&&countsAsOperational(s.role));
    for(const member of staffRows)operatorMap.set(member.name,{name:member.name,roles:new Set([member.role]),theoreticalHours:workTargetHours(month,member.name,cutoff),shiftHours:0,extraordinaryHours:0,extraordinaryEquivalentHours:0});
    const activeShifts=(await getDb().select().from(operatorShifts)).filter(shift=>shift.active&&countsAsOperational(shift.role));
    for(let date=new Date(`${from}T12:00:00`);date<next&&(!cutoff||date<=new Date(`${cutoff}T12:00:00`));date.setDate(date.getDate()+1)){
      const day=date.getDay();
      for(const name of [...new Set(activeShifts.filter(shift=>shift.weekdays.split(",").includes(String(day))).map(shift=>shift.staffName))]){
        const own=activeShifts.filter(shift=>shift.staffName===name&&shift.weekdays.split(",").includes(String(day))),current=operatorMap.get(name)||{name,roles:new Set<string>(),theoreticalHours:workTargetHours(month,name,cutoff),shiftHours:0,extraordinaryHours:0,extraordinaryEquivalentHours:0};
        own.forEach(shift=>current.roles.add(shift.role));current.shiftHours+=unionMinutes(own.map(shift=>[mins(shift.startTime),mins(shift.endTime)] as [number,number]))/60;operatorMap.set(name,current);
      }
    }
    try{for(const duty of (await getDb().select().from(dutyAssignments)).filter(item=>item.active&&item.date>=from&&item.date<to&&countsAsOperational(item.role))){const current=operatorMap.get(duty.staffName)||{name:duty.staffName,roles:new Set<string>(),theoreticalHours:workTargetHours(month,duty.staffName,cutoff),shiftHours:0,extraordinaryHours:0,extraordinaryEquivalentHours:0};current.roles.add(duty.role);current.extraordinaryHours+=duration(duty.startTime,duty.endTime)/60;current.extraordinaryEquivalentHours+=duration(duty.startTime,duty.endTime)/60*(duty.multiplierX100||100)/100;operatorMap.set(duty.staffName,current)}}catch{}
    const studioLivePrograms=new Set(["PARA ELLAS","NOTICIERO MEDIO DIA","DE TU TACO","ON"]),normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
    const allBlocks=(await getDb().select().from(scheduleBlocks)).filter(b=>b.active),liveBlocks=allBlocks.filter(b=>(b.resource==="radio"&&b.kind.toLowerCase().includes("vivo"))||(b.resource==="estudio"&&studioLivePrograms.has(normalize(b.program))&&normalize(b.title).includes("EN VIVO")));
    const liveByResource:{[key:string]:{uses:number;minutes:number}}={radio:{uses:0,minutes:0},estudio:{uses:0,minutes:0}};
    const capacityByResource:{[key:string]:{openMinutes:number;occupiedFixedMinutes:number;livePlannedMinutes:number;recordingFixedMinutes:number}}={radio:{openMinutes:0,occupiedFixedMinutes:0,livePlannedMinutes:0,recordingFixedMinutes:0},estudio:{openMinutes:0,occupiedFixedMinutes:0,livePlannedMinutes:0,recordingFixedMinutes:0},exteriores:{openMinutes:0,occupiedFixedMinutes:0,livePlannedMinutes:0,recordingFixedMinutes:0}};
    for(let date=new Date(`${from}T12:00:00`);date<next&&(!cutoff||date<=new Date(`${cutoff}T12:00:00`));date.setDate(date.getDate()+1)){
      for(const resourceName of ["radio","estudio","exteriores"]){
        const capacity=capacityByResource[resourceName],openStart=resourceName==="radio"?6*60:resourceName==="estudio"?8*60:0,openEnd=resourceName==="exteriores"?0:22*60;capacity.openMinutes+=Math.max(0,openEnd-openStart);
        const daily=allBlocks.filter(b=>b.resource===resourceName&&b.weekdays.split(",").includes(String(date.getDay()))),dailyLive=liveBlocks.filter(b=>b.resource===resourceName&&b.weekdays.split(",").includes(String(date.getDay()))),dailyRecording=daily.filter(b=>b.kind.toLowerCase().includes("grabación")&&!dailyLive.some(l=>l.id===b.id));
        capacity.occupiedFixedMinutes+=unionMinutes(daily.map(b=>[Math.max(openStart,mins(b.startTime)),Math.min(openEnd,mins(b.endTime))] as [number,number]));
        capacity.livePlannedMinutes+=unionMinutes(dailyLive.map(b=>[Math.max(openStart,mins(b.startTime)),Math.min(openEnd,mins(b.endTime))] as [number,number]));
        capacity.recordingFixedMinutes+=unionMinutes(dailyRecording.map(b=>[Math.max(openStart,mins(b.startTime)),Math.min(openEnd,mins(b.endTime))] as [number,number]));
      }
      for(const block of allBlocks.filter(b=>b.weekdays.split(",").includes(String(date.getDay())))){
        const isLive=liveBlocks.some(l=>l.id===block.id);
        if(isLive){liveByResource[block.resource].uses++;liveByResource[block.resource].minutes+=duration(block.startTime,block.endTime)}
        // Los bloques fijos aportan uso del espacio; las horas del personal se calculan exclusivamente desde la grilla de turnos.
      }
    }
    const byOperator=[...operatorMap.values()].map(o=>({...o,roles:[...o.roles].join(", "),monthlyWorkdays:workTargetDays(month,o.name,cutoff),monthlyTargetHours:o.theoreticalHours,periodWeeks:o.theoreticalHours/48,regularHours:o.shiftHours,liveHours:0,recordingHours:0,actualHours:o.shiftHours,missingShiftHours:Math.max(0,o.theoreticalHours-o.shiftHours),coveragePct:o.theoreticalHours?o.shiftHours/o.theoreticalHours*100:0,utilizationPct:100})).sort((a,b)=>b.shiftHours-a.shiftHours||b.extraordinaryHours-a.extraordinaryHours||a.name.localeCompare(b.name));
    const countReasons=(field:"cancellationReason"|"rescheduleReason")=>Object.entries(rows.reduce((a,r)=>{const reason=r[field]||"Sin especificar";if((field==="cancellationReason"&&r.status!=="cancelada")||(field==="rescheduleReason"&&!r.rescheduleReason))return a;a[reason]=(a[reason]||0)+1;return a},{} as Record<string,number>)).map(([label,value])=>({label,value}));
    const resource=(name:string)=>{const live=liveByResource[name]||{uses:0,minutes:0},capacity=capacityByResource[name],bookings=active.filter(r=>r.locationType===name),allRequests=rows.filter(r=>r.locationType===name),done=completed.filter(r=>r.locationType===name),doneInternal=done.filter(r=>r.usageCategory!=="grabación"),doneRecording=done.filter(r=>r.usageCategory==="grabación"),liveCapacityHours=capacity.livePlannedMinutes/60,recordingRequestedHours=hours(allRequests,"startTime","endTime"),recordingCapacityHours=name==="exteriores"?recordingRequestedHours:Math.max(0,capacity.openMinutes-capacity.livePlannedMinutes)/60,internalActualHours=name==="estudio"?hours(doneInternal,"actualStartTime","actualEndTime"):0,recordingActualHours=hours(doneRecording,"actualStartTime","actualEndTime")+(name==="exteriores"?0:capacity.recordingFixedMinutes/60),recordingUnusedHours=Math.max(0,recordingCapacityHours-recordingActualHours-internalActualHours);return {uses:bookings.length+live.uses,hours:hours(bookings,"startTime","endTime")+live.minutes/60,liveHours:live.minutes/60,liveCapacityHours,liveEffectiveHours:live.minutes/60,liveUtilizationPct:liveCapacityHours?live.minutes/60/liveCapacityHours*100:0,recordingCapacityHours,recordingRequestedHours,recordingActualHours,internalActualHours,internalUtilizationPct:recordingCapacityHours?internalActualHours/recordingCapacityHours*100:0,recordingUnusedHours,recordingUtilizationPct:recordingCapacityHours?recordingActualHours/recordingCapacityHours*100:0,cancelled:cancelled.filter(r=>r.locationType===name).length}};
    return Response.json({month,total:rows.length,cancelled:cancelled.length,completed:completed.length,requestedHours:hours(rows,"startTime","endTime"),effectiveHours:actualHours,actualHours,overtimeHours,lostHours,lostReservations,delayHours,efficiencyPct,operatorWeeklyTargetHours:48,operatorMonthlyTargetHours:expectedHours,operatorPeriodWeeks:expectedHours/48,byResource:{estudio:resource("estudio"),radio:resource("radio"),exteriores:resource("exteriores")},byProgram,byRequester,byOperator,cancellationReasons:countReasons("cancellationReason"),rescheduleReasons:countReasons("rescheduleReason")});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"No se pudieron calcular las métricas."},{status:500})}
}
