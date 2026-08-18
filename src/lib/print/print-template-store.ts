// TradeOS ERP — Print template repository.
//
// Persists per-organization printable templates (PrintTemplate config as jsonb)
// for sales invoices and load forms. Read-only for renderers; the customizer
// uses save/delete/upsert.

import { createSupabaseService } from "@/lib/supabase/server";
import type { PrintDocumentType, PrintTemplate, PrintTemplateRow } from "./print-template-types";

const COLUMNS =
  "id, organization_id, doc_type, name, description, config, is_default, created_at, updated_at";

export class PrintTemplateRepository {
  async findByOrganization(
    organizationId: string,
    docType?: PrintDocumentType,
  ): Promise<PrintTemplateRow[]> {
    const supabase = createSupabaseService();
    let query = supabase
      .from("print_templates")
      .select(COLUMNS)
      .eq("organization_id", organizationId)
      .order("name", { ascending: true });
    if (docType) {
      query = query.eq("doc_type", docType);
    }
    const { data, error } = await query;
    if (error) {
      throw error;
    }
    return (data ?? []) as PrintTemplateRow[];
  }

  async findById(id: string): Promise<PrintTemplateRow | null> {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("print_templates")
      .select(COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return (data as PrintTemplateRow | null) ?? null;
  }

  /** Persist (or overwrite by name) a custom template for an organization. */
  async save(input: {
    organization_id: string;
    doc_type: PrintDocumentType;
    name: string;
    description?: string | null;
    config: PrintTemplate;
  }): Promise<PrintTemplateRow> {
    const supabase = createSupabaseService();
    const name = input.name.trim() || "Custom Template";
    const { data, error } = await supabase
      .from("print_templates")
      .upsert(
        {
          organization_id: input.organization_id,
          doc_type: input.doc_type,
          name,
          description: input.description ?? null,
          config: input.config,
          is_default: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,doc_type,name" },
      )
      .select(COLUMNS)
      .single();
    if (error) {
      throw error;
    }
    return data as PrintTemplateRow;
  }

  async delete(id: string, organizationId: string): Promise<void> {
    const supabase = createSupabaseService();
    const { error } = await supabase
      .from("print_templates")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId);
    if (error) {
      throw error;
    }
  }
}