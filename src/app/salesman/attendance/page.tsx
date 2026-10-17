"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { Clock, Loader2, AlertCircle, CheckCircle2, LogIn, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { acquireBrowserLocation, getBrowserLocationErrorMessage } from "@/lib/location/browser-geolocation";
import { useRegional } from "@/components/regional/RegionalProvider";

interface AttendanceRecord {
  id: string;
  date: string;
  status: string;
  duty_start?: string | null;
  duty_end?: string | null;
  total_hours?: number | null;
}

export default function AttendancePage() {
  const { t } = useRegional();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [acting, setActing] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authorizedFetch("/api/attendance?limit=30");
      const data = await res.json();
      if (data.ok) setRecords(data.records ?? []);
      else setError(data.error || t('salesman.att.loadError'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('salesman.att.networkError'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const clock = async (action: "clock_in" | "clock_out") => {
    setActing(true);
    setMessage(null);
    setGpsStatus(t('salesman.att.gettingLocation'));
    try {
      const position = await acquireBrowserLocation();
      const pos = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      setGpsStatus(action === "clock_in" ? t('salesman.att.clockingIn') : t('salesman.att.clockingOut'));
      const res = await authorizedFetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, latitude: pos.latitude, longitude: pos.longitude }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed");
      setMessage({ type: "ok", text: action === "clock_in" ? t('salesman.att.clockedIn') : t('salesman.att.clockedOut').replace('{hours}', String(data.record?.total_hours ?? "—")) });
      await load();
    } catch (err) {
      setMessage({ type: "error", text: getBrowserLocationErrorMessage(err) });
    } finally {
      setActing(false);
      setGpsStatus(null);
    }
  };

  const today = records[0];
  const clockedIn = Boolean(today?.duty_start);
  const clockedOut = Boolean(today?.duty_end);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">{t('salesman.att.title')}</h1>
        <p className="text-sm text-body mt-1">{t('salesman.att.subtitle')}</p>
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
      {gpsStatus && <div className="text-sm text-body">{gpsStatus}</div>}

      <div className="rounded-2xl border border-border bg-card p-6 grid gap-5">
        <div>
          <h2 className="font-heading font-bold text-xl text-foreground">
            {clockedIn ? t('salesman.att.onDuty') : t('salesman.att.startDuty')}
          </h2>
          <p className="text-sm text-body mt-1">
            {today?.duty_start
              ? <><bdi>{t('salesman.att.clockedInAt').replace('{time}', new Date(today.duty_start).toLocaleTimeString())}</bdi>{today.duty_end ? <bdi>{` · ${t('salesman.att.outAt').replace('{time}', new Date(today.duty_end).toLocaleTimeString())}`}</bdi> : ""}</>
              : t('salesman.att.noClockIn')}
          </p>
        </div>

        {!clockedIn ? (
          <button
            onClick={() => clock("clock_in")}
            disabled={acting}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-primary-foreground font-medium disabled:opacity-50"
          >
            {acting ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
            {acting ? t('salesman.att.clockingIn') : t('salesman.att.clockIn')}
          </button>
        ) : !clockedOut ? (
          <button
            onClick={() => clock("clock_out")}
            disabled={acting}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-destructive px-6 text-destructive-foreground font-medium disabled:opacity-50"
          >
            {acting ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
            {acting ? t('salesman.att.clockingOut') : t('salesman.att.clockOut')}
          </button>
        ) : (
          <div className="flex items-center gap-2 rounded-lg bg-success/10 px-4 py-3 text-sm text-success">
            <CheckCircle2 className="size-4" /> {t('salesman.att.dutyComplete')}{typeof today?.total_hours === "number" ? ` — ${t('salesman.att.hours').replace('{count}', String(today.total_hours))}` : ""}.
          </div>
        )}
      </div>

      <div>
        <h2 className="font-semibold text-foreground mb-2 flex items-center gap-2"><Clock className="size-4 text-primary" /> {t('salesman.att.history')}</h2>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="size-8 text-primary animate-spin" />
          </div>
        ) : records.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-body">{t('salesman.att.noRecords')}</div>
        ) : (
          <div className="rounded-2xl border border-border bg-card divide-y divide-border">
            {records.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <div className="font-medium text-foreground">{new Date(r.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</div>
                  <div className="text-xs text-body">
                    {r.duty_start ? t('salesman.att.in').replace('{time}', new Date(r.duty_start).toLocaleTimeString()) : t('salesman.att.noClockIn')}
                    {r.duty_end ? ` · ${t('salesman.att.out').replace('{time}', new Date(r.duty_end).toLocaleTimeString())}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-foreground">{r.total_hours ? `${r.total_hours}h` : "—"}</span>
                  <StatusBadge status={r.status} t={t} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, t }: { status: string; t: (key: any) => string }) {
  const colors: Record<string, string> = {
    present: "bg-success/10 text-success",
    absent: "bg-destructive/10 text-destructive",
    late: "bg-warning/10 text-warning",
    half_day: "bg-warning/10 text-warning",
    leave: "bg-muted text-muted-foreground",
    holiday: "bg-muted text-muted-foreground",
  };
  const labels: Record<string, string> = {
    present: t('salesman.att.status.present'),
    absent: t('salesman.att.status.absent'),
    late: t('salesman.att.status.late'),
    half_day: t('salesman.att.status.half_day'),
    leave: t('salesman.att.status.leave'),
    holiday: t('salesman.att.status.holiday'),
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium capitalize", colors[status] ?? "bg-muted text-muted-foreground")}>
      {labels[status] ?? status.replace("_", " ")}
    </span>
  );
}
