import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const permission = await requirePermission(request, "field_sales");
  if (!permission.allowed || !permission.actor || !permission.actor.profileId) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    return handleMultipart(request, permission.actor);
  }

  // JSON fallback: base64 data URL
  let body: { visitId?: string; dataUrl?: string; caption?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const { visitId, dataUrl, caption } = body;
  if (!visitId || !dataUrl) {
    return NextResponse.json({ ok: false, error: "visitId and dataUrl are required" }, { status: 400 });
  }
  if (!/^data:image\//.test(dataUrl)) {
    return NextResponse.json({ ok: false, error: "dataUrl must be a base64 data image" }, { status: 400 });
  }

  const base64 = dataUrl.split(",")[1];
  const mime = dataUrl.split(";")[0].split(":")[1] || "image/jpeg";
  const buffer = Buffer.from(base64, "base64");
  const ext = mime.split("/")[1] === "png" ? "png" : "jpg";

  return savePhoto(permission.actor.organizationId, permission.actor.profileId, visitId, buffer, mime, ext, caption ?? null);
}

async function handleMultipart(request: NextRequest, actor: { organizationId: string; profileId: string }) {
  const formData = await request.formData();
  const visitId = formData.get("visitId") as string | null;
  const file = formData.get("photo");
  const caption = (formData.get("caption") as string | null) || null;

  if (!visitId || !file || !(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "visitId and photo file are required" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "image/jpeg";
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";

  return savePhoto(actor.organizationId, actor.profileId, visitId, buffer, mime, ext, caption);
}

async function savePhoto(
  organizationId: string,
  profileId: string | undefined,
  visitId: string,
  buffer: Buffer,
  mime: string,
  ext: string,
  caption: string | null
) {
  const supabase = createSupabaseService();

  const { data: visit } = await supabase
    .from("customer_visits")
    .select("id, employee_id, images, visit_status")
    .eq("id", visitId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!visit) return NextResponse.json({ ok: false, error: "Visit not found" }, { status: 404 });
  if (visit.visit_status === "planned" || visit.visit_status === "cancelled") {
    return NextResponse.json({ ok: false, error: "Visit is not active; cannot add photos" }, { status: 400 });
  }

  // upload to storage bucket 'visit-photos' under org/visit/ timestamp
  const fileName = `${organizationId}/${visitId}/${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from("visit-photos").upload(fileName, buffer, { contentType: mime, upsert: false });

  if (uploadError) {
    return NextResponse.json({ ok: false, error: `Storage upload failed: ${uploadError.message}` }, { status: 500 });
  }

  const publicUrl = supabase.storage.from("visit-photos").getPublicUrl(fileName).data.publicUrl;
  const entry = { url: publicUrl, caption: caption ?? null, uploaded_by: profileId, uploaded_at: new Date().toISOString() };

  const existing = Array.isArray(visit.images) ? visit.images : [];
  const images = [...existing, entry];

  const { data: updated, error } = await supabase
    .from("customer_visits")
    .update({ images, updated_at: new Date().toISOString() })
    .eq("id", visitId)
    .select()
    .single();

  if (error) return NextResponse.json({ ok: false, error: `Failed to update visit: ${error.message}` }, { status: 400 });

  return NextResponse.json({ ok: true, photo: entry, visit: updated });
}