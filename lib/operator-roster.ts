import {eq} from "drizzle-orm";
import {getDb} from "../db";
import {operatorShifts,technicalStaff} from "../db/schema";
export type OperatorAssignment={name:string;role:string;startTime:string;endTime:string};

type Rule=OperatorAssignment&{resources:string[];weekdays:number[];priority?:number;program?:string};

const WEEKDAYS=[1,2,3,4,5];
const STUDIOS=["radio","estudio"];
const rules:Rule[]=[
  {resources:["radio"],weekdays:WEEKDAYS,startTime:"06:00",endTime:"09:00",role:"REALIZADOR",name:"ÁLVARO CALIZAYA"},
  {resources:["radio"],weekdays:WEEKDAYS,startTime:"06:00",endTime:"09:00",role:"SONIDISTA",name:"IVÁN CANEDO"},
  {resources:["radio"],weekdays:WEEKDAYS,startTime:"09:00",endTime:"14:00",role:"REALIZADOR",name:"ÁLVARO CALIZAYA"},
  {resources:["radio"],weekdays:WEEKDAYS,startTime:"09:00",endTime:"14:00",role:"SONIDISTA",name:"ÁNGEL BELTRÁN"},
  {resources:["radio"],weekdays:WEEKDAYS,startTime:"14:00",endTime:"22:00",role:"REALIZADOR",name:"ANDRÉS SUÁREZ"},
  {resources:["radio"],weekdays:WEEKDAYS,startTime:"14:00",endTime:"22:00",role:"SONIDISTA",name:"DAVID ESCOBAR"},

  {resources:["estudio"],weekdays:WEEKDAYS,startTime:"08:00",endTime:"14:00",role:"REALIZADOR",name:"GIAN FRANCO DELGADO"},
  {resources:["estudio"],weekdays:WEEKDAYS,startTime:"08:00",endTime:"14:00",role:"OPERADOR DE VTR",name:"ANDREA RIVERO"},
  {resources:["estudio"],weekdays:WEEKDAYS,startTime:"08:00",endTime:"14:00",role:"ASISTENTE DE SONIDO",name:"LENNY MALDONADO"},
  {resources:["estudio"],weekdays:WEEKDAYS,startTime:"08:00",endTime:"14:00",role:"CAMARÓGRAFO",name:"JUAN PABLO GIL"},
  {resources:["estudio"],weekdays:WEEKDAYS,startTime:"09:00",endTime:"14:00",role:"SONIDISTA",name:"IVÁN CANEDO"},
  {resources:["estudio"],weekdays:WEEKDAYS,startTime:"14:00",endTime:"22:00",role:"REALIZADOR",name:"DIEGO CISTERNAS"},
  {resources:["estudio"],weekdays:WEEKDAYS,startTime:"14:00",endTime:"22:00",role:"SONIDISTA",name:"ÁNGEL DORADO"},
  {resources:["estudio"],weekdays:WEEKDAYS,startTime:"20:00",endTime:"22:00",role:"ASISTENTE DE SONIDO",name:"LENNY MALDONADO"},
  {resources:["estudio"],weekdays:WEEKDAYS,startTime:"20:00",endTime:"22:00",role:"OPERADOR DE VTR",name:"ANDREA RIVERO"},
  {resources:["estudio"],weekdays:WEEKDAYS,startTime:"20:00",endTime:"22:00",role:"CAMARÓGRAFO",name:"GIAN FRANCO DELGADO"},
  {resources:["estudio"],weekdays:WEEKDAYS,startTime:"18:00",endTime:"20:00",role:"REALIZADOR",name:"JUAN PABLO GIL",program:"DE TU TACO",priority:2},
  {resources:["estudio"],weekdays:WEEKDAYS,startTime:"18:00",endTime:"20:00",role:"SONIDISTA",name:"ÁNGEL BELTRÁN",program:"DE TU TACO",priority:2},

  {resources:["radio"],weekdays:[6],startTime:"08:00",endTime:"14:00",role:"REALIZADOR",name:"ÁLVARO CALIZAYA"},
  {resources:["radio"],weekdays:[6],startTime:"08:00",endTime:"14:00",role:"SONIDISTA",name:"IVÁN CANEDO"},
  {resources:["radio"],weekdays:[0],startTime:"14:00",endTime:"22:00",role:"REALIZADOR",name:"ANDRÉS SUÁREZ"},
  {resources:["radio"],weekdays:[0],startTime:"14:00",endTime:"22:00",role:"SONIDISTA",name:"DAVID ESCOBAR"},
];

const mins=(value:string)=>{const [h,m]=value.split(":").map(Number);return h*60+m};
const time=(value:number)=>`${String(Math.floor(value/60)).padStart(2,"0")}:${String(value%60).padStart(2,"0")}`;
const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().trim();
export function requiresManualAssignment(date:string,resource:string){return resource==="exteriores"||(resource==="estudio"&&new Date(`${date}T12:00:00`).getDay()===6)}

export async function assignOperators(date:string,resource:string,program:string,startTime:string,endTime:string,requestedRoles:string[]=[]):Promise<OperatorAssignment[]>{
  if(!date||!startTime||!endTime||!STUDIOS.includes(resource)||requiresManualAssignment(date,resource))return [];
  const day=new Date(`${date}T12:00:00`).getDay(),start=mins(startTime),end=mins(endTime),programKey=normalize(program||"");
  const db=getDb();
  const shifts=await db.select().from(operatorShifts).where(eq(operatorShifts.active,true));
  const people=await db.select().from(technicalStaff).where(eq(technicalStaff.active,true));
  const configured:Rule[]=shifts.filter(shift=>people.some(person=>person.name===shift.staffName&&normalize(person.role)===normalize(shift.role))).map(shift=>({
    name:shift.staffName,role:shift.role,startTime:shift.startTime,endTime:shift.endTime,
    resources:[shift.resource],weekdays:shift.weekdays.split(",").map(Number),
  }));
  const candidates=configured.filter(r=>r.resources.includes(resource)&&r.weekdays.includes(day)&&(!r.program||normalize(r.program)===programKey)&&mins(r.startTime)<end&&mins(r.endTime)>start);
  const result:OperatorAssignment[]=[];
  for(const role of [...new Set(candidates.map(r=>r.role))]){
    const roleRules=candidates.filter(r=>r.role===role),points=[...new Set([start,end,...roleRules.flatMap(r=>[Math.max(start,mins(r.startTime)),Math.min(end,mins(r.endTime))])])].sort((a,b)=>a-b);
    for(let i=0;i<points.length-1;i++){
      const a=points[i],b=points[i+1];if(a===b)continue;
      const active=roleRules.filter(r=>mins(r.startTime)<=a&&mins(r.endTime)>=b),priority=Math.max(-1,...active.map(r=>r.priority||1));
      for(const rule of active.filter(r=>(r.priority||1)===priority)){
        const previous=result[result.length-1];
        if(previous&&previous.name===rule.name&&previous.role===rule.role&&previous.endTime===time(a))previous.endTime=time(b);
        else result.push({name:rule.name,role:rule.role,startTime:time(a),endTime:time(b)});
      }
    }
  }
  const wanted=new Set(requestedRoles.map(normalize));
  return result.filter(a=>!wanted.size||wanted.has(normalize(a.role))).sort((a,b)=>a.startTime.localeCompare(b.startTime)||a.role.localeCompare(b.role));
}

export function theoreticalOperatorHours(month:string,untilDate?:string){
  const from=new Date(`${month}-01T12:00:00`),to=new Date(from);to.setMonth(to.getMonth()+1);
  const totals=new Map<string,{name:string;roles:Set<string>;theoreticalHours:number;shiftHours:number}>();
  for(const date=new Date(from);date<to&&(!untilDate||date<=new Date(`${untilDate}T12:00:00`));date.setDate(date.getDate()+1)){
    const daily=rules.filter(r=>r.weekdays.includes(date.getDay()));
    for(const name of [...new Set(daily.map(r=>r.name))]){
      const own=daily.filter(r=>r.name===name),current=totals.get(name)||{name,roles:new Set<string>(),theoreticalHours:0,shiftHours:0};
      own.forEach(r=>current.roles.add(r.role));current.theoreticalHours+=8;
      const intervals=own.map(r=>[mins(r.startTime),mins(r.endTime)] as [number,number]).sort((a,b)=>a[0]-b[0]);let covered=0,cursor=-1;
      for(const [start,end] of intervals){if(end<=cursor)continue;covered+=Math.max(0,end-Math.max(cursor,start));cursor=Math.max(cursor,end)}
      current.shiftHours+=Math.min(8,covered/60);totals.set(name,current);
    }
  }
  return totals;
}

export function assignmentHours(assignments:OperatorAssignment[]){return assignments.reduce((total,a)=>total+Math.max(0,mins(a.endTime)-mins(a.startTime)),0)/60}
