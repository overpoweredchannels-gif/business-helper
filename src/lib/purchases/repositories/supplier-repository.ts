import { createSupabaseService } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SupplierRecord = {
  id: string;
  organization_id: string;
  supplier_name: string;
  contact_person?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  city?: string | null;
  area?: string | null;
  notes?: string | null;
  credit_limit?: number | null;
  credit_days?: number | null;
  credit_policy?: string | null;
  preferred_payment_method?: string | null;
  allow_over_limit?: boolean | null;
  allow_overdue_sales?: boolean | null;
  is_active?: boolean | null;
  created_at?: string;
  updated_at?: string;
};

export class SupplierRepository {
  private readonly supabase: SupabaseClient;

  constructor(supabase: SupabaseClient = createSupabaseService()) {
    this.supabase = supabase;
  }

  async findByOrganization(organizationId: string) {
    const { data, error } = await this.supabase
      .from("suppliers")
      .select("*")
      .eq("organization_id", organizationId)
      .order("supplier_name", { ascending: true });

    if (error) {
      throw error;
    }

    return data as SupplierRecord[];
  }

  async findById(organizationId: string, id: string) {
    const { data, error } = await this.supabase
      .from("suppliers")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as SupplierRecord | null;
  }

  async create(input: Omit<SupplierRecord, "id" | "created_at" | "updated_at">) {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .from("suppliers")
      .insert({ ...input, created_at: now, updated_at: now })
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return data as SupplierRecord;
  }

  async update(organizationId: string, id: string, updates: Partial<SupplierRecord>) {
    const { data, error } = await this.supabase
      .from("suppliers")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", organizationId)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return data as SupplierRecord;
  }

  async remove(organizationId: string, id: string) {
    const { error } = await this.supabase
      .from("suppliers")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId);

    if (error) {
      throw error;
    }
  }

  async setActive(organizationId: string, id: string, isActive: boolean) {
    const { data, error } = await this.supabase
      .from("suppliers")
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", organizationId)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return data as SupplierRecord;
  }
}
