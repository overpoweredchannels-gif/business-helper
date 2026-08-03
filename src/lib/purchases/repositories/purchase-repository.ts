import { createSupabaseService } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PurchaseTransactionRecord = {
  id: string;
  organization_id: string;
  supplier_id: string | null;
  invoice_number: string;
  purchase_date?: string | null;
  payment_type?: string | null;
  credit_due_date?: string | null;
  notes?: string | null;
  total_amount?: number | null;
  status?: string | null;
  invoice_type?: string | null;
  created_by_profile_id?: string | null;
  supplier_invoice_number?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type PurchaseItemRecord = {
  id: string;
  purchase_transaction_id: string;
  product_id: string | number;
  quantity: number;
  purchase_price: number;
  selling_price?: number | null;
  batch_number?: string | null;
  expiry_date?: string | null;
  created_at?: string;
};

export type NewPurchaseItem = {
  purchase_transaction_id: string;
  organization_id: string;
  product_id: string | number;
  quantity: number;
  purchase_price: number;
  selling_price?: number | null;
  batch_number?: string | null;
  expiry_date?: string | null;
};

export class PurchaseRepository {
  private readonly supabase: SupabaseClient;

  constructor(supabase: SupabaseClient = createSupabaseService()) {
    this.supabase = supabase;
  }

  async listTransactions(organizationId: string) {
    const { data, error } = await this.supabase
      .from("purchase_transactions")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return data as PurchaseTransactionRecord[];
  }

  async findTransactionById(organizationId: string, id: string) {
    const { data, error } = await this.supabase
      .from("purchase_transactions")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as PurchaseTransactionRecord | null;
  }

  async createTransaction(input: Omit<PurchaseTransactionRecord, "id" | "created_at" | "updated_at">) {
    const { data, error } = await this.supabase
      .from("purchase_transactions")
      .insert(input)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return data as PurchaseTransactionRecord;
  }

  async listItemsForTransaction(purchaseTransactionId: string) {
    const { data, error } = await this.supabase
      .from("purchase_items")
      .select("*")
      .eq("purchase_transaction_id", purchaseTransactionId)
      .order("id", { ascending: true });

    if (error) {
      throw error;
    }

    return data as PurchaseItemRecord[];
  }

  async addItems(items: NewPurchaseItem[]) {
    const { data, error } = await this.supabase.from("purchase_items").insert(items).select("id");

    if (error) {
      throw error;
    }

    return data as { id: string }[];
  }

  async deleteItemsForTransaction(purchaseTransactionId: string) {
    const { error } = await this.supabase
      .from("purchase_items")
      .delete()
      .eq("purchase_transaction_id", purchaseTransactionId);

    if (error) {
      throw error;
    }
  }

  async deleteTransaction(organizationId: string, id: string) {
    const { error } = await this.supabase
      .from("purchase_transactions")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId);

    if (error) {
      throw error;
    }
  }

  async findSupplierById(organizationId: string, supplierId: string) {
    const { data, error } = await this.supabase
      .from("suppliers")
      .select("id, supplier_name, outstanding_balance")
      .eq("id", supplierId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as { id: string; supplier_name: string; outstanding_balance: number | null } | null;
  }

  async findProductById(organizationId: string, productId: string | number) {
    const { data, error } = await this.supabase
      .from("products")
      .select("id, name")
      .eq("id", productId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as { id: string | number; name: string } | null;
  }

  async updateSupplierBalance(supplierId: string, newBalance: number) {
    const { error } = await this.supabase
      .from("suppliers")
      .update({
        outstanding_balance: newBalance,
        last_purchase_date: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", supplierId);

    if (error) {
      throw error;
    }
  }
}
