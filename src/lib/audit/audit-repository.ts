import { createSupabaseService } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuditRecordInput {
  organization_id: string;
  actor_profile_id?: string | null;
  actor_email?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  entity_label?: string | null;
  description?: string | null;
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
}

export class AuditRepository {
  private readonly supabase: SupabaseClient;

  constructor(supabase: SupabaseClient = createSupabaseService()) {
    this.supabase = supabase;
  }

  /**
   * Persists an audit entry into the audit_logs table. This is the
   * server-side audit trail used by service layers (the identity module's
   * in-memory logger remains for client-side flows).
   */
  async create(input: AuditRecordInput): Promise<void> {
    const { error } = await this.supabase.from("audit_logs").insert(input);

    if (error) {
      throw error;
    }
  }
}
