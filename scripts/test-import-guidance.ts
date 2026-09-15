import assert from "node:assert/strict";
import { suggestImportMapping, validateSuggestions } from "../src/lib/import-export/ai-guidance";
import { suppliersImportConfig } from "../src/lib/import-export/entities/suppliers";
import type { ImportContext, ParsedRow } from "../src/lib/import-export/types";
async function main() {
  const fields = suppliersImportConfig.fields;
  assert.deepEqual(validateSuggestions([{ header: "Vendor", field: "supplier_name" }, { header: "Phone", field: "supplier_name" }, { header: "Unknown", field: "phone" }, { header: "Phone", field: "organization_id" }], ["Vendor", "Phone"], fields), [{ header: "Vendor", field: "supplier_name" }]);
  const send: typeof fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    const data = JSON.parse(body.contents[0].parts[0].text);
    assert.deepEqual(Object.keys(data).sort(), ["fields", "headers"]);
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ suggestions: [{ header: "Vendor", field: "supplier_name" }] }) }] } }] });
  };
  assert.equal((await suggestImportMapping(["Vendor"], fields, { GEMINI_API_KEY: "test-only" }, send))[0].field, "supplier_name");
  await assert.rejects(() => suggestImportMapping(["Vendor"], fields, {}, send), /not configured/);
  await assert.rejects(() => suggestImportMapping(["Vendor"], fields, { GEMINI_API_KEY: "test-only" }, async () => Response.json({}, { status: 429 })), /unavailable/);
  const payload = await suppliersImportConfig.buildUpsertPayload!({ values: { supplier_name: " Vendor ", phone: "00123", organization_id: "other-business" } } as unknown as ParsedRow, {} as ImportContext);
  assert.deepEqual(payload, { supplier_name: "Vendor", phone: "00123" });
  assert(!Object.hasOwn(payload, "is_active"), "Sparse updates must preserve existing settings");
  console.log("Import guidance: provider errors, heading-only request, unsupported/duplicate targets and supplier payload isolation passed.");
}
void main();
