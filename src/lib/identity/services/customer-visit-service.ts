import { createSupabaseService } from "@/lib/supabase/server";
import { isWithinRadius } from "@/lib/maps/google-maps";
import { logAuditEvent } from "@/lib/identity/audit";
import type { ActorContext } from "@/lib/identity/types";

export interface VisitStartInput {
  employeeId: string;
  customerId: string;
  routeId?: string;
  stopId?: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface VisitNotesInput {
  visitId: string;
  notes: string;
  images?: Array<{ url: string; caption?: string }>;
}

export interface VisitFinishInput {
  visitId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  createDraftSale?: boolean;
  draftSaleData?: {
    customerId: string;
    items: Array<{
      productId: number;
      quantity: number;
      unitPrice: number;
      discount?: number;
    }>;
  };
}

export interface VisitResult {
  ok: boolean;
  error?: string;
  visit?: any;
}

export interface VisitListResult {
  ok: boolean;
  error?: string;
  visits?: any[];
}

const GPS_VERIFICATION_RADIUS_METERS = 100;

export class CustomerVisitService {
  /**
   * Start a customer visit - GPS verified
   */
  async startVisit(actor: ActorContext, input: VisitStartInput): Promise<VisitResult> {
    if (!actor.organizationId || !actor.profileId) {
      return { ok: false, error: "Organization context required" };
    }

    const supabase = createSupabaseService();

    // Verify employee belongs to organization
    const { data: employee } = await supabase
      .from("employees")
      .select("id, full_name, assigned_route_id")
      .eq("id", input.employeeId)
      .eq("organization_id", actor.organizationId)
      .maybeSingle();

    if (!employee) {
      return { ok: false, error: "Employee not found in this organization" };
    }

    // Verify customer belongs to organization
    const { data: customer } = await supabase
      .from("customers")
      .select("id, customer_name, latitude, longitude")
      .eq("id", input.customerId)
      .eq("organization_id", actor.organizationId)
      .maybeSingle();

    if (!customer) {
      return { ok: false, error: "Customer not found in this organization" };
    }

    // GPS verification - check if employee is within radius of customer
    if (customer.latitude != null && customer.longitude != null) {
      const isNear = isWithinRadius(
        { lat: input.latitude, lng: input.longitude },
        { lat: customer.latitude, lng: customer.longitude },
        GPS_VERIFICATION_RADIUS_METERS
      );

      if (!isNear) {
        return {
          ok: false,
          error: `GPS verification failed. You must be within ${GPS_VERIFICATION_RADIUS_METERS}m of the customer to start a visit.`,
        };
      }
    }

    // Check if there's already an in-progress visit for this employee
    const { data: existingVisit } = await supabase
      .from("customer_visits")
      .select("id")
      .eq("employee_id", input.employeeId)
      .eq("visit_status", "in_progress")
      .maybeSingle();

    if (existingVisit) {
      return { ok: false, error: "You already have an active visit. Finish it first." };
    }

    // Create visit record
    const { data: visit, error } = await supabase
      .from("customer_visits")
      .insert({
        organization_id: actor.organizationId,
        employee_id: input.employeeId,
        customer_id: input.customerId,
        route_id: input.routeId ?? employee.assigned_route_id ?? null,
        stop_id: input.stopId ?? null,
        visit_status: "in_progress",
        started_at: new Date().toISOString(),
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy: input.accuracy ?? null,
      })
      .select()
      .single();

    if (error) {
      return { ok: false, error: `Failed to start visit: ${error.message}` };
    }

    logAuditEvent({
      organizationId: actor.organizationId,
      actorProfileId: actor.profileId,
      actorEmail: actor.email,
      action: "visit_started",
      entityType: "customer_visit",
      entityId: visit.id,
      description: `${employee.full_name} started visit to ${customer.customer_name}`,
      success: true,
    });

    return { ok: true, visit };
  }

  /**
   * Add notes/images to an in-progress visit
   */
  async addVisitNotes(actor: ActorContext, input: VisitNotesInput): Promise<VisitResult> {
    if (!actor.organizationId) {
      return { ok: false, error: "Organization context required" };
    }

    const supabase = createSupabaseService();

    // Verify visit exists and belongs to organization
    const { data: visit } = await supabase
      .from("customer_visits")
      .select("id, employee_id, visit_status")
      .eq("id", input.visitId)
      .eq("organization_id", actor.organizationId)
      .maybeSingle();

    if (!visit) {
      return { ok: false, error: "Visit not found" };
    }

    if (visit.visit_status !== "in_progress") {
      return { ok: false, error: "Can only add notes to in-progress visits" };
    }

    // Verify employee owns this visit (or is owner)
    const isOwner = actor.isOwner;
    const isEmployee = await this.isEmployeeOfProfile(actor, visit.employee_id);

    if (!isOwner && !isEmployee) {
      return { ok: false, error: "Not authorized to update this visit" };
    }

    const { data: updated, error } = await supabase
      .from("customer_visits")
      .update({
        notes: input.notes,
        images: input.images ?? [],
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.visitId)
      .select()
      .single();

    if (error) {
      return { ok: false, error: `Failed to update visit: ${error.message}` };
    }

    return { ok: true, visit: updated };
  }

  /**
   * Finish a visit - GPS verified, optionally create draft sale
   */
  async finishVisit(actor: ActorContext, input: VisitFinishInput): Promise<VisitResult> {
    if (!actor.organizationId) {
      return { ok: false, error: "Organization context required" };
    }

    const supabase = createSupabaseService();

    // Verify visit exists and belongs to organization
    const { data: visit } = await supabase
      .from("customer_visits")
      .select("id, employee_id, customer_id, visit_status, started_at")
      .eq("id", input.visitId)
      .eq("organization_id", actor.organizationId)
      .maybeSingle();

    if (!visit) {
      return { ok: false, error: "Visit not found" };
    }

    if (visit.visit_status !== "in_progress") {
      return { ok: false, error: "Visit is not in progress" };
    }

    // Verify employee owns this visit (or is owner)
    const isOwner = actor.isOwner;
    const isEmployee = await this.isEmployeeOfProfile(actor, visit.employee_id);

    if (!isOwner && !isEmployee) {
      return { ok: false, error: "Not authorized to finish this visit" };
    }

    // GPS verification for finish
    const { data: customer } = await supabase
      .from("customers")
      .select("latitude, longitude")
      .eq("id", visit.customer_id)
      .maybeSingle();

    if (customer?.latitude != null && customer?.longitude != null) {
      const isNear = isWithinRadius(
        { lat: input.latitude, lng: input.longitude },
        { lat: customer.latitude, lng: customer.longitude },
        GPS_VERIFICATION_RADIUS_METERS * 2 // Slightly larger radius for finish
      );

      if (!isNear) {
        return {
          ok: false,
          error: `GPS verification failed. You must be near the customer to finish the visit.`,
        };
      }
    }

    // Update visit to completed
    const { data: updated, error } = await supabase
      .from("customer_visits")
      .update({
        visit_status: "completed",
        ended_at: new Date().toISOString(),
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy: input.accuracy ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.visitId)
      .select()
      .single();

    if (error) {
      return { ok: false, error: `Failed to finish visit: ${error.message}` };
    }

    // Create draft sale if requested
    let draftSale = null;
    if (input.createDraftSale && input.draftSaleData && input.draftSaleData.items.length > 0) {
      draftSale = await this.createDraftSaleFromVisit(
        actor,
        visit,
        input.draftSaleData
      );
    }

    logAuditEvent({
      organizationId: actor.organizationId,
      actorProfileId: actor.profileId,
      actorEmail: actor.email,
      action: "visit_completed",
      entityType: "customer_visit",
      entityId: visit.id,
      description: `Visit completed${draftSale ? " with draft sale" : ""}`,
      success: true,
    });

    return { ok: true, visit: { ...updated, draftSale } };
  }

  /**
   * Get today's visits for an employee
   */
  async getTodaysVisits(actor: ActorContext, employeeId?: string): Promise<VisitListResult> {
    if (!actor.organizationId) {
      return { ok: false, error: "Organization context required" };
    }

    const targetEmployeeId = employeeId ?? (await this.getEmployeeIdByProfile(actor));
    if (!targetEmployeeId) {
      return { ok: false, error: "No employee record linked to this profile" };
    }
    const supabase = createSupabaseService();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("customer_visits")
      .select(`
        id, customer_id, route_id, stop_id, visit_status, started_at, ended_at,
        latitude, longitude, accuracy, notes, images, created_at,
        customers!inner(customer_name, shop_name, phone, latitude, longitude)
      `)
      .eq("organization_id", actor.organizationId)
      .eq("employee_id", targetEmployeeId)
      .gte("created_at", todayStart.toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      return { ok: false, error: `Failed to load visits: ${error.message}` };
    }

    return { ok: true, visits: data ?? [] };
  }

  /**
   * Get all visits for owner (with filters)
   */
  async getVisitsForOwner(
    actor: ActorContext,
    filters: {
      status?: string;
      employeeId?: string;
      customerId?: string;
      dateFrom?: string;
      dateTo?: string;
      limit?: number;
    } = {}
  ): Promise<VisitListResult> {
    if (!actor.organizationId || !actor.isOwner) {
      return { ok: false, error: "Owner access required" };
    }

    const supabase = createSupabaseService();

    let query = supabase
      .from("customer_visits")
      .select(`
        id, employee_id, customer_id, route_id, stop_id, visit_status, started_at, ended_at,
        latitude, longitude, accuracy, notes, images, created_at,
        employees!inner(full_name),
        customers!inner(customer_name, shop_name, phone)
      `)
      .eq("organization_id", actor.organizationId)
      .order("created_at", { ascending: false });

    if (filters.status) {
      query = query.eq("visit_status", filters.status);
    }
    if (filters.employeeId) {
      query = query.eq("employee_id", filters.employeeId);
    }
    if (filters.customerId) {
      query = query.eq("customer_id", filters.customerId);
    }
    if (filters.dateFrom) {
      query = query.gte("created_at", filters.dateFrom);
    }
    if (filters.dateTo) {
      query = query.lte("created_at", filters.dateTo);
    }
    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;

    if (error) {
      return { ok: false, error: `Failed to load visits: ${error.message}` };
    }

    return { ok: true, visits: data ?? [] };
  }

  /**
   * Mark a planned visit as missed (owner/supervisor action)
   */
  async markVisitMissed(actor: ActorContext, visitId: string): Promise<VisitResult> {
    if (!actor.organizationId || !actor.isOwner) {
      return { ok: false, error: "Owner access required" };
    }

    const supabase = createSupabaseService();

    const { data: visit } = await supabase
      .from("customer_visits")
      .select("id, visit_status")
      .eq("id", visitId)
      .eq("organization_id", actor.organizationId)
      .maybeSingle();

    if (!visit) {
      return { ok: false, error: "Visit not found" };
    }

    if (visit.visit_status !== "planned") {
      return { ok: false, error: "Can only mark planned visits as missed" };
    }

    const { data: updated, error } = await supabase
      .from("customer_visits")
      .update({
        visit_status: "missed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", visitId)
      .select()
      .single();

    if (error) {
      return { ok: false, error: `Failed to mark visit missed: ${error.message}` };
    }

    return { ok: true, visit: updated };
  }

  /**
   * Check whether the given employee record belongs to the actor's profile.
   */
  private async isEmployeeOfProfile(actor: ActorContext, employeeId: string): Promise<boolean> {
    if (!actor.profileId) return false;
    const supabase = createSupabaseService();
    const { data } = await supabase
      .from("employees")
      .select("id, profile_id")
      .eq("id", employeeId)
      .eq("profile_id", actor.profileId)
      .eq("organization_id", actor.organizationId)
      .maybeSingle();
    return Boolean(data);
  }

  /**
   * Resolve the employee id for the actor's profile.
   */
  private async getEmployeeIdByProfile(actor: ActorContext): Promise<string | null> {
    if (!actor.profileId || !actor.organizationId) return null;
    const supabase = createSupabaseService();
    const { data } = await supabase
      .from("employees")
      .select("id")
      .eq("profile_id", actor.profileId)
      .eq("organization_id", actor.organizationId)
      .maybeSingle();
    return data?.id ?? null;
  }

  /**
   * Create draft sale from completed visit
   */
  private async createDraftSaleFromVisit(
    actor: ActorContext,
    visit: any,
    draftData: NonNullable<VisitFinishInput["draftSaleData"]>
  ): Promise<any> {
    const supabase = createSupabaseService();

    // Get employee profile for created_by
    const { data: employee } = await supabase
      .from("employees")
      .select("profile_id")
      .eq("id", visit.employee_id)
      .maybeSingle();

    const { data: sale, error } = await supabase
      .from("sales_orders")
      .insert({
        organization_id: actor.organizationId,
        customer_id: draftData.customerId,
        order_date: new Date().toISOString().split("T")[0],
        status: "draft",
        created_by_profile_id: employee?.profile_id ?? actor.profileId,
        notes: `Created from visit ${visit.id}`,
      })
      .select()
      .single();

    if (error) {
      console.error("Draft sale creation failed:", error);
      return null;
    }

    // Insert line items
    if (draftData.items.length > 0) {
      const items = draftData.items.map((item) => ({
        sales_order_id: sale.id,
        product_id: item.productId,
        quantity_ordered: item.quantity,
        quantity_delivered: 0,
        unit_price: item.unitPrice,
        discount: item.discount ?? 0,
      }));

      await supabase.from("sales_order_items").insert(items);
    }

    return sale;
  }
}

export function getCustomerVisitService(): CustomerVisitService {
  return new CustomerVisitService();
}