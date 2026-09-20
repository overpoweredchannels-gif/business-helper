import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";
import { readImportFile } from "@/lib/import-export/processor";

export const runtime = "nodejs";
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 20;
const ALLOWED = /\.(csv|xlsx|xls|ods|xml|txt|pdf|png|jpg|jpeg|webp)$/i;

export async function POST(request: NextRequest) {
  const access = await requirePermission(request, "import_export");
  if (!access.allowed || !access.actor?.organizationId || !access.actor.profileId) {
    return NextResponse.json({ ok: false, error: "Historical archive access required" }, { status: 403 });
  }

  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    if (files.length === 0) return NextResponse.json({ ok: false, error: "Choose at least one archive file." }, { status: 400 });
    if (files.length > MAX_FILES) return NextResponse.json({ ok: false, error: `Upload up to ${MAX_FILES} files at a time.` }, { status: 400 });

    const supabase = createSupabaseService();
    const saved: Array<{ id: string; fileName: string; rowCount: number }> = [];
    for (const file of files) {
      if (!file.name || !ALLOWED.test(file.name)) throw new Error(`Unsupported archive file: ${file.name}`);
      if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error(`${file.name} must be larger than 0 and no more than 50 MB.`);
      const buffer = Buffer.from(await file.arrayBuffer());
      let searchText = file.name;
      let rowCount = 0;
      if (/\.(csv|xlsx|xls|ods|xml)$/i.test(file.name)) {
        const parsed = await readImportFile(file);
        rowCount = parsed.rows.length;
        searchText = [file.name, ...parsed.headers, ...parsed.rows.flat()].join(" ").slice(0, 2_000_000);
      } else if (/\.txt$/i.test(file.name)) {
        searchText = `${file.name} ${(await file.text()).slice(0, 2_000_000)}`;
      }
      const path = `${access.actor.organizationId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const upload = await supabase.storage.from("historical-archive").upload(path, buffer, { contentType: file.type || "application/octet-stream", upsert: false });
      if (upload.error) throw new Error(`Could not save ${file.name}: ${upload.error.message}`);
      const inserted = await supabase.from("historical_archive_files").insert({ organization_id: access.actor.organizationId, file_name: file.name, content_type: file.type || "application/octet-stream", file_size_bytes: file.size, storage_path: path, search_text: searchText, row_count: rowCount, uploaded_by: access.actor.profileId }).select("id").single();
      if (inserted.error || !inserted.data?.id) {
        await supabase.storage.from("historical-archive").remove([path]);
        throw new Error(`Could not index ${file.name}. Run the historical archive migration, then retry.`);
      }
      saved.push({ id: inserted.data.id, fileName: file.name, rowCount });
    }
    return NextResponse.json({ ok: true, files: saved });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Historical archive upload failed." }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  const access = await requirePermission(request, "import_export");
  if (!access.allowed || !access.actor?.organizationId) return NextResponse.json({ ok: false, error: "Historical archive access required" }, { status: 403 });
  const query = request.nextUrl.searchParams.get("keyword")?.trim() ?? "";
  if (query.length > 200) return NextResponse.json({ ok: false, error: "Search is limited to 200 characters." }, { status: 400 });
  let requestQuery = createSupabaseService().from("historical_archive_files").select("id,file_name,content_type,file_size_bytes,row_count,uploaded_at,search_text", { count: "exact" }).eq("organization_id", access.actor.organizationId).order("uploaded_at", { ascending: false }).limit(100);
  if (query) requestQuery = requestQuery.ilike("search_text", `%${query.replace(/[\\%_]/g, "\\$&")}%`);
  const result = await requestQuery;
  if (result.error) return NextResponse.json({ ok: false, error: "Historical archive storage is not installed yet. Run 20260920_historical_archive.sql." }, { status: 503 });
  const files = (result.data ?? []).map(file => ({ ...file, excerpt: query ? file.search_text.slice(Math.max(0, file.search_text.toLowerCase().indexOf(query.toLowerCase()) - 100), query.length + 200) : "" , search_text: undefined }));
  return NextResponse.json({ ok: true, files, count: result.count ?? 0 });
}
