import { createSupabaseService } from "@/lib/supabase/server";
import { Employee } from "@/lib/tradeos/types";
export { EMPLOYEE_DESIGNATIONS, isEmployeeDesignation } from "../staff-roles";

export type EmployeeInput = Partial<Employee>;

const EMPLOYEE_COLUMNS = `
  id, organization_id, profile_id, employee_id, full_name, phone, cnic, email,
  designation, department, joining_date, status, assigned_supervisor_id,
  assigned_territory_id, assigned_route_id, photo_url, emergency_contact,
  is_active, created_at, updated_at, invite_status
`;

export class EmployeeRepository {
  constructor(private readonly createClient = createSupabaseService) {}

  /** Server-only invitation lookup; general employee projections omit invite secrets. */
  async findForInvitation(id: string, organizationId: string): Promise<Employee | null> {
    const { data, error } = await this.createClient().from("employees")
      .select(`${EMPLOYEE_COLUMNS}, login_id, hidden_email, invite_code, invite_expires_at`)
      .eq("id", id).eq("organization_id", organizationId).maybeSingle();
    if (error) throw error;
    return data as Employee | null;
  }

  async findByOrganization(organizationId: string): Promise<Employee[]> {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("employees")
      .select(EMPLOYEE_COLUMNS)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []) as Employee[];
  }

  async findById(id: string, organizationId?: string): Promise<Employee | null> {
    const supabase = createSupabaseService();
    let query = supabase.from("employees").select(EMPLOYEE_COLUMNS).eq("id", id);
    if (organizationId) {
      query = query.eq("organization_id", organizationId);
    }
    const { data, error } = await query.maybeSingle();

    if (error) {
      throw error;
    }

    return (data as Employee | null) ?? null;
  }

  async create(input: EmployeeInput): Promise<Employee> {
    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("employees")
      .insert(input)
      .select(EMPLOYEE_COLUMNS)
      .single();

    if (error) {
      throw error;
    }

    return data as Employee;
  }

async update(id: string, updates: EmployeeInput, organizationId?: string): Promise<Employee> {
    const supabase = createSupabaseService();
    let query = supabase
      .from("employees")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(EMPLOYEE_COLUMNS);
    if (organizationId) {
      query = query.eq("organization_id", organizationId);
    }
    const { data, error } = await query.single();

    if (error) {
      throw error;
    }

    return data as Employee;
  }

async remove(id: string, organizationId?: string): Promise<void> {
    const supabase = createSupabaseService();
    let query = supabase.from("employees").delete().eq("id", id);
    if (organizationId) {
      query = query.eq("organization_id", organizationId);
    }
    const { error } = await query;
    if (error) {
      throw error;
    }
  }
}
