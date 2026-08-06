"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { Store, Loader2, Search, Save, AlertCircle, CheckCircle2, MapPin, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Customer {
  id: string;
  customer_name: string;
  shop_name: string | null;
  phone: string | null;
  area: string | null;
  city: string | null;
  is_active: boolean | null;
  assigned_salesman_id: string | null;
  assigned_territory_id: string | null;
  visit_frequency: string | null;
  priority: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface Employee {
  id: string;
  full_name: string;
  designation?: string;
}

interface Territory {
  id: string;
  name: string;
}

const FIELD_STAFF = ["salesman", "field_officer", "collection_officer", "delivery_rider", "supervisor"];

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unassigned" | "assigned">("all");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cRes, eRes, tRes] = await Promise.all([
        authorizedFetch("/api/customers"),
        authorizedFetch("/api/identity/employees"),
        authorizedFetch("/api/territories"),
      ]);
      const cData = await cRes.json();
      const eData = await eRes.json();
      const tData = await tRes.json();
      if (cData.error) setError(cData.error);
      else setCustomers(cData.customers ?? []);
      const emps = Array.isArray(eData.employees) ? eData.employees : Array.isArray(eData) ? eData : [];
      setEmployees(emps.filter((e: Employee) => FIELD_STAFF.includes(e.designation ?? "")));
      setTerritories(tData.territories ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = customers.filter((c) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      c.customer_name.toLowerCase().includes(q) ||
      (c.shop_name ?? "").toLowerCase().includes(q) ||
      (c.phone ?? "").includes(q);
    if (!matchesSearch) return false;
    if (filter === "unassigned") return !c.assigned_salesman_id;
    if (filter === "assigned") return !!c.assigned_salesman_id;
    return true;
  });

  const startEdit = (c: Customer) => {
    setEditingId(c.id);
    setForm({
      assigned_salesman_id: c.assigned_salesman_id ?? "",
      assigned_territory_id: c.assigned_territory_id ?? "",
      visit_frequency: c.visit_frequency ?? "weekly",
      priority: c.priority ?? "medium",
      latitude: c.latitude != null ? String(c.latitude) : "",
      longitude: c.longitude != null ? String(c.longitude) : "",
    });
  };

  const save = async (c: Customer) => {
    setSavingId(c.id);
    setMessage(null);
    try {
      const res = await authorizedFetch(`/api/customers/${c.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: c.customer_name,
          assigned_salesman_id: form.assigned_salesman_id || null,
          assigned_territory_id: form.assigned_territory_id || null,
          visit_frequency: form.visit_frequency,
          priority: form.priority,
          latitude: form.latitude !== "" ? Number(form.latitude) : null,
          longitude: form.longitude !== "" ? Number(form.longitude) : null,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save");
      setMessage({ type: "ok", text: "Assignment saved." });
      setEditingId(null);
      await load();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">Customers</h1>
        <p className="text-sm text-body mt-1">Assign salesmen, territories, priority, and visit frequency to each customer.</p>
      </div>

      {message && (
        <div className={cn(
          "flex items-start gap-2 rounded-2xl border p-4 text-sm",
          message.type === "ok" ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive-bg text-destructive",
        )}>
          {message.type === "ok" ? <CheckCircle2 className="size-4 mt-0.5 shrink-0" /> : <AlertCircle className="size-4 mt-0.5 shrink-0" />}
          {message.text}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">
          <AlertCircle className="size-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customers..."
            className="w-full h-11 rounded-lg border border-input bg-card pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="flex gap-2">
          {(["all", "unassigned", "assigned"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "h-11 px-4 rounded-lg border text-sm font-medium",
                filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card text-body border-input hover:bg-muted",
              )}
            >
              {f === "all" ? "All" : f === "unassigned" ? "Unassigned" : "Assigned"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-body">Loading customers...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <Store className="size-8 text-light-text mx-auto mb-3" />
          <p className="text-sm text-body">No customers found.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-light-text">
                  <th className="px-5 py-3 font-medium">Customer</th>
                  <th className="px-3 py-3 font-medium">Salesman</th>
                  <th className="px-3 py-3 font-medium">Territory</th>
                  <th className="px-3 py-3 font-medium">Frequency</th>
                  <th className="px-3 py-3 font-medium">Priority</th>
                  <th className="px-3 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((c) => {
                  const isEditing = editingId === c.id;
                  const salesman = employees.find((e) => e.id === (isEditing ? form.assigned_salesman_id : c.assigned_salesman_id));
                  return (
                    <tr key={c.id} className="hover:bg-muted/40">
                      <td className="px-5 py-3">
                        <div className="font-medium text-foreground">{c.shop_name || c.customer_name}</div>
                        <div className="text-xs text-body">
                          {c.area && c.city ? `${c.area}, ${c.city}` : c.city || c.area || c.phone || ""}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {isEditing ? (
                          <select
                            value={form.assigned_salesman_id}
                            onChange={(e) => setForm({ ...form, assigned_salesman_id: e.target.value })}
                            className="h-10 rounded-lg border border-input bg-card px-2 text-sm text-foreground appearance-none"
                          >
                            <option value="">Unassigned</option>
                            {employees.map((e) => (
                              <option key={e.id} value={e.id}>{e.full_name}</option>
                            ))}
                          </select>
                        ) : (
                          <span className={cn("text-foreground", !c.assigned_salesman_id && "text-light-text")}>
                            {salesman?.full_name ?? "Unassigned"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {isEditing ? (
                          <select
                            value={form.assigned_territory_id}
                            onChange={(e) => setForm({ ...form, assigned_territory_id: e.target.value })}
                            className="h-10 rounded-lg border border-input bg-card px-2 text-sm text-foreground appearance-none"
                          >
                            <option value="">None</option>
                            {territories.map((t) => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-foreground">
                            {territories.find((t) => t.id === c.assigned_territory_id)?.name ?? "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {isEditing ? (
                          <select
                            value={form.visit_frequency}
                            onChange={(e) => setForm({ ...form, visit_frequency: e.target.value })}
                            className="h-10 rounded-lg border border-input bg-card px-2 text-sm text-foreground appearance-none"
                          >
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                            <option value="none">None</option>
                          </select>
                        ) : (
                          <span className="capitalize">{c.visit_frequency ?? "weekly"}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {isEditing ? (
                          <select
                            value={form.priority}
                            onChange={(e) => setForm({ ...form, priority: e.target.value })}
                            className="h-10 rounded-lg border border-input bg-card px-2 text-sm text-foreground appearance-none"
                          >
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                          </select>
                        ) : (
                          <span
                            className={cn(
                              "px-2 py-0.5 rounded-full text-[11px] font-medium capitalize",
                              c.priority === "high" ? "bg-destructive/10 text-destructive" :
                              c.priority === "low" ? "bg-muted text-muted-foreground" : "bg-warning/10 text-warning",
                            )}
                          >
                            {c.priority ?? "medium"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {isEditing ? (
                          <div className="inline-flex gap-1.5">
                            <button
                              onClick={() => save(c)}
                              disabled={savingId === c.id}
                              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
                            >
                              {savingId === c.id ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                              Save
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input px-3 text-xs font-medium text-body hover:bg-muted"
                            >
                              <X className="size-3.5" /> Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(c)}
                            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input px-3 text-xs font-medium text-foreground hover:bg-muted"
                          >
                            <MapPin className="size-3.5" /> Assign
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
