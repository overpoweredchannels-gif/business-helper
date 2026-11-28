"use client";

import { useEffect, useState } from "react";
import { Banknote, Receipt, RotateCcw } from "lucide-react";
import { useRegional } from "@/components/regional/RegionalProvider";
import { allPages } from "@/lib/supabase/all-pages";
import { supabase } from "@/lib/supabase/client";
import { formatBooksMoney } from "@/lib/tradeos/formatters";
import type { DashboardReadStatus } from "@/lib/dashboard/data-read-state";
import { safeNumber } from "@/lib/tradeos/validators";
import { KPICard } from "./widgets";

export function PersonalActivityDashboard({ userName, organizationId, employeeId, sales, returns, salesStatus, returnsStatus }: {
  userName: string;
  organizationId: string;
  employeeId: string | null;
  sales: string;
  returns: number;
  salesStatus: DashboardReadStatus;
  returnsStatus: DashboardReadStatus;
}) {
  const { t } = useRegional();
  const [collections, setCollections] = useState<{ total: number; status: DashboardReadStatus }>({
    total: 0, status: employeeId ? "loading" : "not-loaded",
  });

  useEffect(() => {
    if (!employeeId) return;
    const controller = new AbortController();
    void allPages((from, to) => supabase.from("collections").select("amount")
      .eq("organization_id", organizationId).eq("employee_id", employeeId).eq("status", "approved")
      .order("id").range(from, to).abortSignal(controller.signal)).then(({ data, error }) => {
      if (controller.signal.aborted) return;
      setCollections(error ? { total: 0, status: "failed" } : {
        total: (data ?? []).reduce((total, row) => total + safeNumber(row.amount), 0),
        status: data?.length ? "successful-populated" : "successful-empty",
      });
    }).catch(() => {
      if (!controller.signal.aborted) setCollections({ total: 0, status: "failed" });
    });
    return () => controller.abort();
  }, [organizationId, employeeId]);

  return (
    <section className="aankh-dashboard mx-auto max-w-[1440px] space-y-5 px-4 py-5 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold leading-tight text-foreground sm:text-3xl"><bdi>{userName}</bdi></h1>
      <div className="grid grid-cols-1 gap-3 min-[375px]:grid-cols-2 md:grid-cols-3">
        <KPICard title={t("dashboard.staff.mySales")} value={sales} readStatus={salesStatus} icon={<Receipt className="size-4" />} />
        <KPICard title={t("dashboard.staff.myCollections")} value={formatBooksMoney(collections.total)} readStatus={collections.status} icon={<Banknote className="size-4" />} />
        <KPICard title={t("dashboard.staff.myReturns")} value={String(returns)} readStatus={returnsStatus} icon={<RotateCcw className="size-4" />} />
      </div>
    </section>
  );
}
