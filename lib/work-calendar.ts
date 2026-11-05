const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toUpperCase();
const RADIO_PM=new Set(["ANDRES SUAREZ","DAVID ESCOBAR"]);
export const BALANCE_START_MONTH="2026-08";

export const isRadioPmStaff=(name:string)=>RADIO_PM.has(normalize(name));
export const weeklyRestDay=(name:string)=>isRadioPmStaff(name)?6:0;
export const isWeeklyRestDate=(name:string,date:string)=>new Date(`${date}T12:00:00`).getDay()===weeklyRestDay(name);

export function workTargetDays(month:string,name:string,untilDate?:string){
  const from=new Date(`${month}-01T12:00:00`),to=new Date(from);to.setMonth(to.getMonth()+1);let days=0;
  for(const date=new Date(from);date<to&&(!untilDate||date<=new Date(`${untilDate}T12:00:00`));date.setDate(date.getDate()+1))if(date.getDay()!==weeklyRestDay(name))days++;
  return days;
}
export const workTargetHours=(month:string,name:string,untilDate?:string)=>workTargetDays(month,name,untilDate)*8;

export function dutyDayPolicy(name:string,date:string,isHoliday:boolean){
  const rest=isWeeklyRestDate(name,date),day=new Date(`${date}T12:00:00`).getDay(),ordinarySunday=day===0&&isRadioPmStaff(name);
  const multiplier=rest?3:isHoliday?2:1;
  const dayType=rest?(day===6?"descanso semanal (sábado)":"descanso semanal (domingo)"):isHoliday?(ordinarySunday?"domingo ordinario y feriado":"feriado"):ordinarySunday?"domingo ordinario":"ordinario";
  return {multiplierX100:multiplier*100,dayType,restDay:rest};
}
