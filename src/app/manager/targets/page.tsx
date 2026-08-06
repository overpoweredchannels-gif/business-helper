"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { Target as TargetIcon, Loader2, AlertCircle, CheckCircle2, ChevronDown, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Employee {
  id: string;
  full_name: string;
  designation?: string;
  employee_id?: string;
}

interface Target {
  id: string;
  employee_id: string;
  period: string;
  metric: string;
  target_value: number;
  start_date: string;
  end_date: string;
  employees?: { full_name?: string } | null;
}

export default function TargetsPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const [showNew, setShowNew] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("monthly");
  const [metric, setMetric] = useState<"revenue" | "orders" | "customers" | "products" | "collections">("revenue");
  const [targetValue, setTargetValue] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [empRes, tarRes] = await Promise.all([
        authorizedFetch("/api/identity/employees"),
        authorizedFetch("/api/targets"),
      ]);
      const empData = await empRes.json();
      const tarData = await tarRes.json();
      if (Array.isArray(empData.employees)) setEmployees(empData.employees);
      else if (Array.isArray(empData)) setEmployees(empData);
      if (tarData.ok) setTargets(tarData.targets ?? []);
      else setError(tarData.error || "Failed to load targets");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const val = Number(targetValue);
      if (!employeeId) throw new Error("Select an employee");
      if (!val || val <= 0) throw new Error("Enter a valid target value");
      const res = await authorizedFetch("/api/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, period, metric, targetValue: val }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to set target");
      setMessage({ type: "ok", text: "Target set and the employee was notified." });
      setShowNew(false);
      setEmployeeId(""); setTargetValue("");
      await load();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to set target" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading font-bold text-2xl text-foreground">Sales Targets</h1>
          <p className="text-sm text-body mt-1">Set daily, weekly, or monthly targets for your team. They'll be notified in-app.</p>
        </div>
        <button
          onClick={() => setShowNew(!showNew)}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          {showNew ? <Trash2 className="size-4" /> : <Plus className="size-4" />}
          {showNew ? "Close" : "Set target"}
        </button>
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

      {showNew && (
        <div className="rounded-2xl border border-border bg-card p-6 grid gap-5">
          <h2 className="font-semibold text-foreground">New target</h2>

          <div>
            <label className="text-sm font-medium text-foreground">Employee</label>
            <div className="relative mt-1.5">
              <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="w-full h-11 rounded-lg border border-input bg-card px-3.5 pr-10 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring appearance-none"
              >
                <option value="">Select employee...</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.full_name} {e.designation ? `(${e.designation})` : ""}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-foreground">Period</label>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as any)}
                className="w-full mt-1.5 h-11 rounded-lg border border-input bg-card px-3.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring appearance-none"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Metric</label>
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value as any)}
                className="w-full mt-1.5 h-11 rounded-lg border border-input bg-card px-3.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring appearance-none"
              >
                <option value="revenue">Revenue</option>
                <option value="orders">Orders</option>
                <option value="customers">Customers</option>
                <option value="products">Products</option>
                <option value="collections">Collections</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Target value</label>
            <input
              type="number"
              min="0"
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              placeholder={metric === "revenue" ? "e.g. 500000" : "e.g. 20"}
              className="w-full mt-1.5 h-11 rounded-lg border border-input bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <button
            onClick={submit}
            disabled={saving}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-primary-foreground font-medium disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <TargetIcon className="size-4" />}
            {saving ? "Saving..." : "Set target"}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-body">Loading targets...</p>
        </div>
      ) : targets.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <TargetIcon className="size-8 text-light-text mx-auto mb-3" />
          <p className="text-sm text-body">No targets set yet.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card divide-y divide-border">
          {targets.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 px-5 py-4">
              <div>
                <div className="font-medium text-foreground">{t.employees?.full_name ?? "Employee"}</div>
                <div className="text-xs text-body capitalize">
                  {t.period} · {t.metric} · {t.start_date} to {t.end_date}
                </div>
              </div>
              <div className="font-heading font-bold text-foreground">{t.metric === "revenue" || t.metric === "collections" ? fmt(t.target_value) : t.target_value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(n || 0);
}