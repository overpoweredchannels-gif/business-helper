import { recognizeDocument } from "@/lib/print/recognize-document";
import { NextResponse } from "next/server";
import { recognizeSpreadsheetReference } from "@/lib/print/spreadsheet-reference";
import { requirePermission } from "@/lib/identity/authorization";
import { type PrintDocumentType } from "@/lib/print/print-template-types";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const permission = await requirePermission(request, "sales_manage");
  if (!permission.allowed || !permission.actor) return NextResponse.json({ ok: false, error: "Print template management permission required" }, { status: 403 });
  try {
    const form = await request.formData(); const docType = form.get("doc_type") as PrintDocumentType; const file = form.get("file");
    if (!["sales_invoice", "load_form"].includes(docType) || !(file instanceof File) || file.size > 3 * 1024 * 1024 || file.size === 0) throw new Error("Choose an invoice/load form reference up to 3 MB");
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["pdf", "png", "jpg", "jpeg", "webp", "xlsx", "xls", "xml", "ods"].includes(ext ?? "")) throw new Error("Use PDF, PNG, JPEG, WebP, Excel, ODS or Excel XML");
    const buffer = Buffer.from(await file.arrayBuffer());
    if (["xlsx", "xls", "xml", "ods"].includes(ext!)) {
      return NextResponse.json({ ok: true, ...recognizeSpreadsheetReference(buffer, docType) });
    }
    const mime = ext === "pdf" ? "application/pdf" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
    return NextResponse.json({ ok: true, ...await recognizeDocument(buffer, mime, docType) });
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not analyze reference" }, { status: 400 }); }
}
