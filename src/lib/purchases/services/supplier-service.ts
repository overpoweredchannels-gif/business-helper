import { SupplierRepository, SupplierRecord } from "../repositories/supplier-repository";
import { AuditRepository } from "@/lib/audit/audit-repository";
import { validateSupplierInput, normalizeOptionalText, normalizeOptionalNumber } from "../validation";
import type { ActorContext } from "../../identity/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export class SupplierService {
  constructor(
    private readonly repository = new SupplierRepository(),
    private readonly audit = new AuditRepository(),
  ) {}

  static withSupabase(supabase: SupabaseClient): SupplierService {
    return new SupplierService(new SupplierRepository(supabase), new AuditRepository(supabase));
  }

  async listSuppliers(actor: ActorContext) {
    if (!actor.organizationId) {
      throw new Error("Organization context required");
    }

    return this.repository.findByOrganization(actor.organizationId);
  }

  async getSupplier(actor: ActorContext, supplierId: string) {
    if (!actor.organizationId) {
      throw new Error("Organization context required");
    }

    const supplier = await this.repository.findById(actor.organizationId, supplierId);
    if (!supplier) {
      throw new Error("Supplier not found");
    }
    return supplier;
  }

  async createSupplier(actor: ActorContext, input: Record<string, unknown>) {
    if (!actor.organizationId) {
      throw new Error("Organization context required");
    }

    const validation = validateSupplierInput(input);
    if (!validation.ok) {
      throw new Error(validation.errors.join("; "));
    }

    const supplier = await this.repository.create({
      organization_id: actor.organizationId,
      supplier_name: normalizeOptionalText(input.supplier_name) as string,
      contact_person: normalizeOptionalText(input.contact_person),
      phone: normalizeOptionalText(input.phone),
      whatsapp: normalizeOptionalText(input.whatsapp),
      city: normalizeOptionalText(input.city),
      area: normalizeOptionalText(input.area),
      notes: normalizeOptionalText(input.notes),
      credit_limit: normalizeOptionalNumber(input.credit_limit),
      credit_days: normalizeOptionalNumber(input.credit_days),
      credit_policy: normalizeOptionalText(input.credit_policy),
      preferred_payment_method: normalizeOptionalText(input.preferred_payment_method),
      allow_over_limit: input.allow_over_limit === undefined ? null : Boolean(input.allow_over_limit),
      allow_overdue_sales: input.allow_overdue_sales === undefined ? null : Boolean(input.allow_overdue_sales),
    });

    await this.audit.create({
      organization_id: actor.organizationId,
      actor_profile_id: actor.profileId,
      actor_email: actor.email,
      action: "supplier_created",
      entity_type: "supplier",
      entity_id: supplier.id,
      entity_label: supplier.supplier_name,
      description: `Created supplier ${supplier.supplier_name}`,
      new_values: { supplier_name: supplier.supplier_name },
    });

    return supplier;
  }

  async updateSupplier(actor: ActorContext, supplierId: string, input: Record<string, unknown>) {
    if (!actor.organizationId) {
      throw new Error("Organization context required");
    }

    const existing = await this.repository.findById(actor.organizationId, supplierId);
    if (!existing) {
      throw new Error("Supplier not found");
    }

    const merged = { ...existing, ...input };
    const validation = validateSupplierInput(merged);
    if (!validation.ok) {
      throw new Error(validation.errors.join("; "));
    }

    const updates: Partial<SupplierRecord> = {};
    const fields: Array<[keyof SupplierRecord, unknown]> = [
      ["supplier_name", input.supplier_name],
      ["contact_person", input.contact_person],
      ["phone", input.phone],
      ["whatsapp", input.whatsapp],
      ["city", input.city],
      ["area", input.area],
      ["notes", input.notes],
      ["credit_policy", input.credit_policy],
      ["preferred_payment_method", input.preferred_payment_method],
    ];
    for (const [field, value] of fields) {
      if (value !== undefined) {
        updates[field] = normalizeOptionalText(value) as never;
      }
    }
    if (input.credit_limit !== undefined) {
      updates.credit_limit = normalizeOptionalNumber(input.credit_limit);
    }
    if (input.credit_days !== undefined) {
      updates.credit_days = normalizeOptionalNumber(input.credit_days);
    }
    if (input.allow_over_limit !== undefined) {
      updates.allow_over_limit = Boolean(input.allow_over_limit);
    }
    if (input.allow_overdue_sales !== undefined) {
      updates.allow_overdue_sales = Boolean(input.allow_overdue_sales);
    }

    const supplier = await this.repository.update(actor.organizationId, supplierId, updates);

    await this.audit.create({
      organization_id: actor.organizationId,
      actor_profile_id: actor.profileId,
      actor_email: actor.email,
      action: "supplier_updated",
      entity_type: "supplier",
      entity_id: supplier.id,
      entity_label: supplier.supplier_name,
      description: `Updated supplier ${supplier.supplier_name}`,
      old_values: { supplier_name: existing.supplier_name },
      new_values: updates,
    });

    return supplier;
  }

  async deleteSupplier(actor: ActorContext, supplierId: string) {
    if (!actor.organizationId) {
      throw new Error("Organization context required");
    }

    const existing = await this.repository.findById(actor.organizationId, supplierId);
    if (!existing) {
      throw new Error("Supplier not found");
    }

    await this.repository.setActive(actor.organizationId, supplierId, false);

    await this.audit.create({
      organization_id: actor.organizationId,
      actor_profile_id: actor.profileId,
      actor_email: actor.email,
      action: "supplier_archived",
      entity_type: "supplier",
      entity_id: supplierId,
      entity_label: existing.supplier_name,
      description: `Archived supplier ${existing.supplier_name}`,
      old_values: { supplier_name: existing.supplier_name, is_active: true },
      new_values: { is_active: false },
    });
  }

  async restoreSupplier(actor: ActorContext, supplierId: string) {
    if (!actor.organizationId) {
      throw new Error("Organization context required");
    }

    const existing = await this.repository.findById(actor.organizationId, supplierId);
    if (!existing) {
      throw new Error("Supplier not found");
    }

    await this.repository.setActive(actor.organizationId, supplierId, true);

    await this.audit.create({
      organization_id: actor.organizationId,
      actor_profile_id: actor.profileId,
      actor_email: actor.email,
      action: "supplier_restored",
      entity_type: "supplier",
      entity_id: supplierId,
      entity_label: existing.supplier_name,
      description: `Restored supplier ${existing.supplier_name}`,
      old_values: { is_active: false },
      new_values: { is_active: true },
    });
  }
}
