"use client";
import { useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { useRegional } from "@/components/regional/RegionalProvider";

export function MyPendingSales() {
  const { t } = useRegional();
  const [rows, setRows] = useState<Array<{ id: string; so_number: string; status: string; total_amount: number }>>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    authorizedFetch("/api/sales/drafts/mine").then(async response => {
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || t('salesman.pending.loadFailed'));
      if (active) setRows((data.drafts ?? []).filter((row: { status: string }) => ["pending_approval", "rejected", "draft"].includes(row.status)));
    }).catch(reason => { if (active) setError(reason.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [t]);
  return <section className="mt-4 rounded-xl border border-border p-4"><h2 className="font-semibold">{t('salesman.pending.title')}</h2>
    <p className="mb-3 text-sm text-muted-foreground">{t('salesman.pending.subtitle')}</p>
    {error && <p role="alert">{error}</p>}
    {loading && <p className="text-sm" role="status">{t('salesman.pending.loading')}</p>}
    {!loading && !error && !rows.length && <p className="text-sm">{t('salesman.pending.empty')}</p>}
    <ul className="grid gap-2">{rows.map(row => <li key={row.id} className="rounded border p-3 text-sm">{row.so_number} · {row.status === "pending_approval" ? t('salesman.pending.statusWaiting') : row.status === "rejected" ? t('salesman.pending.statusRejected') : t('salesman.drafts.status.draft')} · PKR {Number(row.total_amount || 0).toLocaleString()}</li>)}</ul>
  </section>;
}
