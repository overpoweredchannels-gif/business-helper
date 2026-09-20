import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";
import { validHistoryDate } from "@/lib/import-export/entities/historical-sales";

export async function GET(request: NextRequest) {
  const access = await requirePermission(request, "import_export");
  if (!access.allowed || !access.actor?.organizationId) return NextResponse.json({error:"Import/history access required"},{status:403});
  const params=request.nextUrl.searchParams;
  const page=Number(params.get("page")??0);
  const kind=params.get("kind");
  const party=params.get("party");
  const partyType=params.get("party_type");
  const keyword=params.get("keyword")?.trim();
  const from=params.get("from"),to=params.get("to");
  if (!Number.isInteger(page)||page<0||page>100000 || (kind&&!['sale','purchase','customer_payment','supplier_payment'].includes(kind)) || (party&&!/^[0-9a-f-]{36}$/i.test(party)) || (partyType&&!['customer','supplier'].includes(partyType)) || (keyword && keyword.length > 200) || (from&&!validHistoryDate(from)) || (to&&!validHistoryDate(to)) || (from&&to&&from>to)) return NextResponse.json({error:"Invalid history filters"},{status:400});
  let query=createSupabaseService().from("historical_records").select("id,kind,source_system,record_number,party_id,party_name,record_date,cutover_date,total_amount,related_id,source_file,payload,imported_at",{count:"exact"}).eq("organization_id",access.actor.organizationId);
  const partyName=params.get("party_name")?.trim();
  if(partyName) query=query.ilike("party_name",`%${partyName.replace(/[\\%_]/g,"\\$&")}%`);
  if(keyword) {
    const safe=keyword.replace(/[\\%_]/g,"\\$&");
    query=query.or(`party_name.ilike.%${safe}%,record_number.ilike.%${safe}%,source_system.ilike.%${safe}%,source_file.ilike.%${safe}%,payload::text.ilike.%${safe}%`);
  }
  if(kind) query=query.eq("kind",kind);
  if(party) query=query.eq("party_id",party);
  if(partyType) query=query.in("kind",partyType==="customer"?["sale","customer_payment"]:["purchase","supplier_payment"]);
  if(from) query=query.gte("record_date",from);
  if(to) query=query.lte("record_date",to);
  const result=await query.order("record_date",{ascending:false}).order("id").range(page*50,page*50+49);
  if(result.error) return NextResponse.json({error:["42P01","PGRST205"].includes(result.error.code)?"Historical storage is not installed yet. Run 20260918_historical_records.sql in Supabase, then refresh.":"Could not load history. Try again."},{status:503});
  return NextResponse.json({records:result.data??[],count:result.count??0});
}
