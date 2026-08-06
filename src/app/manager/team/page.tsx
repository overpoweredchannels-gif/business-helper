"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { Users, Loader2, AlertCircle, Briefcase, Route as RouteIcon, ExternalLink } from "lucide-react";

interface Employee {
  id: string;
  full_name: string;
  designation?: string;
  employee_id?: string;
  phone?: string;
  assigned_route_id?: string | null;
}

export default function TeamPage() {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authorizedFetch("/api/identity/employees");
      const data = await res.json();
      const list = Array.isArray(data.employees) ? data.employees : Array.isArray(data) ? data : [];
      setEmployees(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const salesmen = employees.filter((e) => ["salesman", "field_officer", "collection_officer", "delivery_rider", "supervisor"].includes(e.designation ?? ""));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">Field Team</h1>
        <p className="text-sm text-body mt-1">Your field staff and their assignments. Click to view ledger.</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">
          <AlertCircle className="size-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-body">Loading team...</p>
        </div>
      ) : salesmen.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <Users className="size-8 text-light-text mx-auto mb-3" />
          <p className="text-sm text-body">No field staff yet. Invite staff from the main app.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {salesmen.map((e) => (
            <button
              key={e.id}
              onClick={() => router.push(`/manager/team/${e.id}`)}
              className="rounded-2xl border border-border bg-card p-5 text-left hover:border-primary/50 hover:shadow-sm transition-all cursor-pointer"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="size-11 rounded-xl bg-primary-light flex items-center justify-center font-heading font-bold text-lg text-primary">
                  {e.full_name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-foreground truncate">{e.full_name}</div>
                  <div className="text-xs text-body capitalize flex items-center gap-1">
                    <Briefcase className="size-3" /> {(e.designation ?? "staff").replace(/_/g, " ")}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 text-xs text-light-text">
                  <RouteIcon className="size-3" />
                  {e.assigned_route_id ? "Route assigned" : "No route assigned"}
                </div>
                <ExternalLink className="size-4 text-light-text hover:text-primary transition-colors" />
              </div>
              {e.phone && <div className="text-xs text-light-text mt-1">{e.phone}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}