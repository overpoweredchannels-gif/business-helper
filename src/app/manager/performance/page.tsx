"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { Loader2, AlertCircle, TrendingUp, Target, MapPin, Banknote, Calendar, Clock, Award } from "lucide-react";
import { cn } from "@/lib/utils";

interface PerformanceMetrics {
  sales: { total: number; count: number; thisMonth: number; thisWeek: number };
  visits: { total: number; completed: number; missed: number; inProgress: number };
  collections: { total: number; approved: number; pending: number; amount: number };
  attendance: { days: number; present: number; late: number; absent: number; leave: number; totalHours: number };
  targets: Array<{ id: string; period: string; metric: string; target_value: number; start_date: string; end_date: string }>;
}

export default function ManagerPerformancePage() {
  const [performance, setPerformance] = useState<PerformanceMetrics | null>(null);
  const [performanceList, setPerformanceList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authorizedFetch("/api/performance");
      const data = await res.json();
      if (data.ok) {
        if (Array.isArray(data.performance)) {
          // Owner view - aggregate and format
          const formatted = data.performance.map((p: any): any => {
            const target = p.targets && p.targets[0];
            const targetValue = target?.target_value || 0;
            const salesAchievement = targetValue > 0 ? (p.salesTotal / targetValue) * 100 : 0;
            const visitRate = p.visitsTotal > 0 ? (p.visitsCompleted / p.visitsTotal) * 100 : 0;
            const collectionRate = p.collectionsTotal > 0 ? (p.collectionsApproved / p.collectionsTotal) * 100 : 0;
            const attendanceRate = p.attendanceDays > 0 ? (p.attendancePresent / p.attendanceDays) * 100 : 0;
            const performanceScore = (salesAchievement * 0.4 + visitRate * 0.2 + collectionRate * 0.2 + attendanceRate * 0.2);

            return {
              id: p.id,
              name: p.name,
              designation: p.designation,
              sales: {
                total: p.salesTotal,
                count: p.salesCount,
                thisMonth: 0,
                thisWeek: 0,
              },
              visits: {
                total: p.visitsTotal,
                completed: p.visitsCompleted,
                missed: p.visitsTotal - p.visitsCompleted,
                inProgress: 0,
              },
              collections: {
                total: p.collectionsTotal,
                approved: p.collectionsApproved,
                pending: p.collectionsTotal - p.collectionsApproved,
                amount: p.collectionsAmount,
              },
              attendance: {
                days: p.attendanceDays,
                present: p.attendancePresent,
                late: 0,
                absent: p.attendanceDays - p.attendancePresent,
                leave: 0,
                totalHours: p.attendanceHours,
              },
              targets: p.targets ?? [],
              metrics: {
                salesAchievement: Number(salesAchievement.toFixed(1)),
                visitRate: Number(visitRate.toFixed(1)),
                collectionRate: Number(collectionRate.toFixed(1)),
                attendanceRate: Number(attendanceRate.toFixed(1)),
                performanceScore: Number(performanceScore.toFixed(1)),
              },
            };
          });
          const aggregated = {
            sales: {
              total: formatted.reduce((sum: number, p: any) => sum + p.sales.total, 0),
              count: formatted.reduce((sum: number, p: any) => sum + p.sales.count, 0),
              thisMonth: 0,
              thisWeek: 0,
            },
            visits: {
              total: formatted.reduce((sum: number, p: any) => sum + p.visits.total, 0),
              completed: formatted.reduce((sum: number, p: any) => sum + p.visits.completed, 0),
              missed: formatted.reduce((sum: number, p: any) => sum + p.visits.missed, 0),
              inProgress: 0,
            },
            collections: {
              total: formatted.reduce((sum: number, p: any) => sum + p.collections.total, 0),
              approved: formatted.reduce((sum: number, p: any) => sum + p.collections.approved, 0),
              pending: formatted.reduce((sum: number, p: any) => sum + p.collections.pending, 0),
              amount: formatted.reduce((sum: number, p: any) => sum + p.collections.amount, 0),
            },
            attendance: {
              days: formatted.reduce((sum: number, p: any) => sum + p.attendance.days, 0),
              present: formatted.reduce((sum: number, p: any) => sum + p.attendance.present, 0),
              late: 0,
              absent: formatted.reduce((sum: number, p: any) => sum + p.attendance.absent, 0),
              leave: 0,
              totalHours: formatted.reduce((sum: number, p: any) => sum + p.attendance.totalHours, 0),
            },
            targets: [],
          };
          setPerformance(aggregated);
          setPerformanceList(formatted);
        } else {
          setPerformance(data.performance);
          setPerformanceList([]);
        }
      } else {
        setError(data.error || "Failed to load performance data");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const formatCurrency = (n: number) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(n);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="size-8 text-primary animate-spin" />
        <p className="text-sm text-body">Loading performance dashboard...</p>
      </div>
    );
  }

  if (error || !performance) {
    return (
      <div className="grid gap-4">
        <div className="rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">
          <AlertCircle className="size-4 mt-0.5 shrink-0" /> {error ?? "Performance data not available"}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">Performance Leaderboard</h1>
        <p className="text-sm text-body mt-1">Monthly rankings and achievement metrics for all field staff.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<TrendingUp className="size-5 text-primary" />} label="Total Sales" value={formatCurrency(performance.sales.total)} sublabel={`${performance.sales.count} orders`} />
        <StatCard icon={<Target className="size-5 text-warning" />} label="Collections" value={formatCurrency(performance.collections.amount)} sublabel={`${performance.collections.approved} approved`} />
        <StatCard icon={<MapPin className="size-5 text-info" />} label="Visits" value={`${performance.visits.completed}/${performance.visits.total}`} sublabel={`${performance.visits.missed} missed`} />
        <StatCard icon={<Clock className="size-5 text-success" />} label="Attendance" value={`${performance.attendance.present}/${performance.attendance.days}`} sublabel={`${performance.attendance.totalHours}h total`} />
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2"><Award className="size-5 text-primary" /> Top Performers</h2>
        <div className="grid gap-3">
          {performanceList.slice(0, 10).map((p: any, index: number) => (
            <div key={p.id} className="flex items-center justify-between p-4 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors">
              <div className="flex items-center gap-4">
                <div className={cn("size-8 rounded-full flex items-center justify-center font-bold text-sm",
                  index === 0 ? "bg-warning/20 text-warning" :
                  index === 1 ? "bg-muted text-muted-foreground" :
                  index === 2 ? "bg-primary-light text-primary" :
                  "bg-card text-foreground"
                )}>
                  {index + 1}
                </div>
                <div className="size-10 rounded-xl bg-primary-light flex items-center justify-center font-heading font-bold text-lg text-primary">
                  {p.name.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <div className="font-medium text-foreground">{p.name}</div>
                  <div className="text-xs text-body capitalize">{p.designation}</div>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-6 text-sm text-right">
                <div>
                  <div className="text-xs text-light-text">Sales</div>
                  <div className="font-medium text-foreground">{formatCurrency(p.sales.total)}</div>
                </div>
                <div>
                  <div className="text-xs text-light-text">Visits</div>
                  <div className="font-medium text-foreground">{p.visits.completed}</div>
                </div>
                <div>
                  <div className="text-xs text-light-text">Collections</div>
                  <div className="font-medium text-foreground">{p.collections.approved}</div>
                </div>
                <div>
                  <div className="text-xs text-light-text">Attendance</div>
                  <div className="font-medium text-foreground">{p.attendance.present}/{p.attendance.days}</div>
                </div>
                <div>
                  <div className="text-xs text-light-text">Score</div>
                  <div className={cn("font-bold",
                    p.metrics.performanceScore >= 80 ? "text-success" :
                    p.metrics.performanceScore >= 60 ? "text-primary" :
                    "text-warning"
                  )}>{p.metrics.performanceScore}%</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sublabel }: { icon: React.ReactNode; label: string; value: string | number; sublabel?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="p-2 rounded-lg bg-primary/10">{icon}</div>
      </div>
      <div className="mt-3">
        <div className="font-heading font-bold text-xl text-foreground">{value}</div>
        <div className="text-xs text-body mt-0.5">{label}</div>
        {sublabel && <div className="text-xs text-light-text mt-0.5">{sublabel}</div>}
      </div>
    </div>
  );
}
