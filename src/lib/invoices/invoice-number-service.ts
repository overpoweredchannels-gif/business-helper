// TradeOS ERP V2 — Sprint 1: Invoice Management Foundation
//
// InvoiceNumberService — the ONE reusable place every module calls to obtain
// a new invoice number. Numbers are generated atomically by the
// `next_invoice_number` Postgres function (see ./schema.sql), which is
// concurrency-safe by construction (see schema.sql comments). This service
// never generates numbers itself in application code — it only formats the
// integer returned by the database.
//
// Usage:
//   import { generateSalesInvoice } from "@/lib/invoices/invoice-number-service";
//   const invoiceNumber = await generateSalesInvoice(organizationId);
//
// Future modules (Sales Return, Purchase Return, etc.) must call the
// corresponding generate*() function here rather than duplicating numbering
// logic.

import { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseService } from "@/lib/supabase/server";
import type { InvoiceType } from "./types";

/** Prefix used for each invoice family. */
export const INVOICE_PREFIXES: Record<InvoiceType, string> = {
  sales: "S",
  purchase: "P",
  sales_return: "SRN",
  purchase_return: "PRN",
  purchase_order: "PO",
};

/** Number of zero-padded digits in the sequence portion per invoice type. */
export const INVOICE_SEQUENCE_PAD_LENGTH: Record<InvoiceType, number> = {
  sales: 6,
  purchase: 5,
  sales_return: 6,
  purchase_return: 6,
  purchase_order: 6,
};

/** Starting offset for sequence numbers per invoice type (added to DB counter). */
export const INVOICE_SEQUENCE_OFFSET: Record<InvoiceType, number> = {
  sales: 100000,
  purchase: 50000,
  sales_return: 0,
  purchase_return: 0,
  purchase_order: 0,
};

/**
 * Pure formatting helper — no I/O. Kept separate from the service class so it
 * can be unit tested without a database or mocked Supabase client.
 */
export function formatInvoiceNumber(invoiceType: InvoiceType, sequenceNumber: number): string {
  const prefix = INVOICE_PREFIXES[invoiceType];
  if (!prefix) {
    throw new Error(`formatInvoiceNumber: unknown invoice type "${invoiceType}"`);
  }
  if (!Number.isInteger(sequenceNumber) || sequenceNumber <= 0) {
    throw new Error(`formatInvoiceNumber: sequence number must be a positive integer, got "${sequenceNumber}"`);
  }
  const offset = INVOICE_SEQUENCE_OFFSET[invoiceType] ?? 0;
  const padLength = INVOICE_SEQUENCE_PAD_LENGTH[invoiceType] ?? 6;
  const displayNumber = sequenceNumber + offset;
  return `${prefix}-${String(displayNumber).padStart(padLength, "0")}`;
}

/**
 * Parses a full or partial invoice number and returns the digits portion
 * (with any leading zeros preserved as typed). Used by ledger search to
 * validate/normalize a query term; not required for formatting itself.
 */
export function extractSequenceDigits(invoiceNumber: string): string | null {
  const match = invoiceNumber.match(/(\d+)\s*$/);
  return match ? match[1] : null;
}

export class InvoiceNumberService {
  private readonly supabase: SupabaseClient;

  /**
   * Accepts an injectable Supabase client so unit tests can pass a mock
   * without needing real credentials or a live database. Defaults to the
   * service-role client used everywhere else in this codebase.
   */
  constructor(supabase?: SupabaseClient) {
    this.supabase = supabase ?? createSupabaseService();
  }

  /**
   * Atomically obtains the next sequence number for an organization +
   * invoice type from the database, then formats it. This is the only place
   * in the codebase allowed to decide what an invoice's number is.
   */
  async generateInvoiceNumber(organizationId: string, invoiceType: InvoiceType): Promise<string> {
    if (!organizationId || !String(organizationId).trim()) {
      throw new Error("InvoiceNumberService: organizationId is required to generate an invoice number");
    }
    if (!INVOICE_PREFIXES[invoiceType]) {
      throw new Error(`InvoiceNumberService: unknown invoice type "${invoiceType}"`);
    }

    const { data, error } = await this.supabase.rpc("next_invoice_number", {
      p_organization_id: organizationId,
      p_invoice_type: invoiceType,
    });

    if (error) {
      throw new Error(
        `InvoiceNumberService: failed to generate ${invoiceType} invoice number: ${error.message}`
      );
    }

    const sequenceNumber = Number(data);
    if (!Number.isInteger(sequenceNumber) || sequenceNumber <= 0) {
      throw new Error(
        `InvoiceNumberService: next_invoice_number RPC returned an invalid value for ${invoiceType}: ${String(data)}`
      );
    }

    return formatInvoiceNumber(invoiceType, sequenceNumber);
  }

  generateSalesInvoice(organizationId: string): Promise<string> {
    return this.generateInvoiceNumber(organizationId, "sales");
  }

  generatePurchaseInvoice(organizationId: string): Promise<string> {
    return this.generateInvoiceNumber(organizationId, "purchase");
  }

  generateSalesReturnInvoice(organizationId: string): Promise<string> {
    return this.generateInvoiceNumber(organizationId, "sales_return");
  }

  generatePurchaseReturnInvoice(organizationId: string): Promise<string> {
    return this.generateInvoiceNumber(organizationId, "purchase_return");
  }

  generatePurchaseOrder(organizationId: string): Promise<string> {
    return this.generateInvoiceNumber(organizationId, "purchase_order");
  }
}

let sharedInstance: InvoiceNumberService | null = null;

/** Lazily-constructed shared instance, mirroring the identity module's singleton pattern. */
export function getInvoiceNumberService(): InvoiceNumberService {
  if (!sharedInstance) {
    sharedInstance = new InvoiceNumberService();
  }
  return sharedInstance;
}

export async function generateSalesInvoice(organizationId: string): Promise<string> {
  return getInvoiceNumberService().generateSalesInvoice(organizationId);
}

export async function generatePurchaseInvoice(organizationId: string): Promise<string> {
  return getInvoiceNumberService().generatePurchaseInvoice(organizationId);
}

export async function generateSalesReturnInvoice(organizationId: string): Promise<string> {
  return getInvoiceNumberService().generateSalesReturnInvoice(organizationId);
}

export async function generatePurchaseReturnInvoice(organizationId: string): Promise<string> {
  return getInvoiceNumberService().generatePurchaseReturnInvoice(organizationId);
}

export async function generatePurchaseOrder(organizationId: string): Promise<string> {
  return getInvoiceNumberService().generatePurchaseOrder(organizationId);
}
