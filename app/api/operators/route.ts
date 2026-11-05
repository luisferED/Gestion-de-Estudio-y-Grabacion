import { assignOperators, requiresManualAssignment } from "../../../lib/operator-roster";

export async function GET(request:Request){
  const url=new URL(request.url),date=url.searchParams.get("date")||"",resource=url.searchParams.get("resource")||"",program=url.searchParams.get("program")||"",start=url.searchParams.get("start")||"",end=url.searchParams.get("end")||"",roles=(url.searchParams.get("roles")||"").split("|").filter(Boolean);
  return Response.json({assignments:await assignOperators(date,resource,program,start,end,roles),mode:requiresManualAssignment(date,resource)?"jefe_operaciones":"automatico"});
}
