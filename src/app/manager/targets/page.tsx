"use client";

import { useCallback, useEffect, useState } from "react";
import { useRegional } from "@/components/regional/RegionalProvider";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { formatBooksMoney } from "@/lib/tradeos/formatters";
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
  const { t } = useRegional();
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
      else setError(tarData.error || t('salesman.targets.loadError'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tracking.networkError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const val = Number(targetValue);
      if (!employeeId) throw new Error(t('manager.targets.selectEmployee'));
      if (!val || val <= 0) throw new Error(t('manager.targets.validTargetValue'));
      const res = await authorizedFetch("/api/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, period, metric, targetValue: val }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || t('manager.targets.setFailed'));
      setMessage({ type: "ok", text: t('manager.targets.setSuccess') });
      setShowNew(false);
      setEmployeeId(""); setTargetValue("");
      await load();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : t('manager.targets.setFailed') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading font-bold text-2xl text-foreground">{t('manager.targets.title')}</h1>
          <p className="text-sm text-body mt-1">{t('manager.targets.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowNew(!showNew)}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          {showNew ? <Trash2 className="size-4" /> : <Plus className="size-4" />}
          {showNew ? t('common.close') : t('manager.targets.setTarget')}
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
          <h2 className="font-semibold text-foreground">{t('manager.targets.newTarget')}</h2>

          <div>
            <label className="text-sm font-medium text-foreground">{t('manager.targets.employee')}</label>
            <div className="relative mt-1.5">
              <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="w-full h-11 rounded-lg border border-input bg-card px-3.5 pr-10 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring appearance-none"
              >
                <option value="">{t('manager.targets.selectEmployeePlaceholder')}</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.full_name} {e.designation ? `(${e.designation})` : ""}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-foreground">{t('manager.targets.period')}</label>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as any)}
                className="w-full mt-1.5 h-11 rounded-lg border border-input bg-card px-3.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring appearance-none"
              >
                <option value="daily">{t('fsm.routes.freqDaily')}</option>
                <option value="weekly">{t('fsm.routes.freqWeekly')}</option>
                <option value="monthly">{t('fsm.routes.freqMonthly')}</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">{t('manager.targets.metric')}</label>
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value as any)}
                className="w-full mt-1.5 h-11 rounded-lg border border-input bg-card px-3.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring appearance-none"
              >
                <option value="revenue">{t('salesman.targets.metric.revenue')}</option>
                <option value="orders">{t('salesman.targets.metric.orders')}</option>
                <option value="customers">{t('manager.targets.metricCustomers')}</option>
                <option value="products">{t('manager.targets.metricProducts')}</option>
                <option value="collections">{t('salesman.targets.metric.collections')}</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">{t('manager.targets.targetValue')}</label>
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
            {saving ? t('salesman.visitDetail.saving') : t('manager.targets.setTarget')}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-body">{t('manager.targets.loading')}</p>
        </div>
      ) : targets.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <TargetIcon className="size-8 text-light-text mx-auto mb-3" />
          <p className="text-sm text-body">{t('manager.targets.noTargets')}</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card divide-y divide-border">
          {targets.map((target) => (
            <div key={target.id} className="flex items-center justify-between gap-3 px-5 py-4">
              <div>
                <div className="font-medium text-foreground">{target.employees?.full_name ?? t('manager.targets.employee')}</div>
                <div className="text-xs text-body capitalize">
                  {target.period} · {target.metric} · {target.start_date} to {target.end_date}
                </div>
              </div>
              <div className="font-heading font-bold text-foreground">{target.metric === "revenue" || target.metric === "collections" ? fmt(target.target_value) : target.target_value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmt(n: number) {
  return formatBooksMoney(n || 0);
}