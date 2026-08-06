"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import {
  ClipboardList, Banknote, MapPin, MessageSquareText, Loader2, AlertCircle, ChevronRight,
} from "lucide-react";

interface Draft { id: string; so_number: string; status: string; total_amount: number; created_at: string; customers?: { customer_name?: string; shop_name?: string } }
interface Collection { id: string; amount: number; status: string; customers?: { customer_name?: string; shop_name?: string } }
interface Visit { id: string; visit_status: string; customers?: { customer_name?: string; shop_name?: string } }
interface Feedback { id: string; type: string; status: string; title?: string }

export default function ManagerOverview() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dRes, cRes, vRes, fRes] = await Promise.all([
        authorizedFetch("/api/sales/drafts?status=pending_approval&limit=5"),
        authorizedFetch("/api/collections?limit=5"),
        authorizedFetch("/api/visits/owner?limit=5"),
        authorizedFetch("/api/feedback?limit=5"),
      ]);
      const dData = await dRes.json();
      const cData = await cRes.json();
      const vData = await vRes.json();
      const fData = await fRes.json();
      if (dData.ok) setDrafts(dData.drafts ?? []);
      if (cData.ok) setCollections(cData.collections ?? []);
      if (vData.ok) setVisits(vData.visits ?? []);
      if (fData.ok) setFeedback(fData.feedback ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load overview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pendingDrafts = drafts.length;
  const pendingCollections = collections.filter((c) => c.status === "pending").length;
  const activeVisits = visits.filter((v) => v.visit_status === "in_progress").length;
  const openFeedback = feedback.filter((f) => f.status === "open").length;

  const stat = (label: string, value: number, href: string, Icon: React.ComponentType<{ className?: string }>) => (
    <Link href={href} className="rounded-2xl border border-border bg-card p-5 hover:border-primary/40 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-light-text uppercase tracking-wide">{label}</span>
        <Icon className="size-4 text-primary" />
      </div>
      <div className="font-heading font-bold text-2xl text-foreground">{value}</div>
      <div className="flex items-center gap-1 text-xs text-primary mt-2">View <ChevronRight className="size-3" /></div>
    </Link>
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="size-8 text-primary animate-spin" />
        <p className="text-sm text-body">Loading overview...</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">Field Sales Overview</h1>
        <p className="text-sm text-body mt-1">Approve drafts, review collections, and monitor your field team.</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">
          <AlertCircle className="size-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stat("Pending draft approvals", pendingDrafts, "/manager/drafts", ClipboardList)}
        {stat("Pending collections", pendingCollections, "/manager/collections", Banknote)}
        {stat("Active visits", activeVisits, "/manager/visits", MapPin)}
        {stat("Open feedback", openFeedback, "/manager/feedback", MessageSquareText)}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Section title="Pending draft approvals" href="/manager/drafts">
          {pendingDrafts === 0 ? <Empty text="Nothing awaiting approval." /> : (
            <ul className="divide-y divide-border">
              {drafts.map((d) => (
                <li key={d.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">{d.so_number}</div>
                    <div className="text-xs text-body">{d.customers?.shop_name || d.customers?.customer_name}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-foreground">{fmt(d.total_amount)}</span>
                    <Link href="/manager/drafts" className="text-xs text-primary hover:underline">Review</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Pending collections" href="/manager/collections">
          {pendingCollections === 0 ? <Empty text="No pending collections." /> : (
            <ul className="divide-y divide-border">
              {collections.filter((c) => c.status === "pending").map((c) => (
                <li key={c.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">{c.customers?.shop_name || c.customers?.customer_name}</div>
                    <div className="text-xs text-body">{new Date(c.id === "" ? 0 : Date.now()).toLocaleDateString()}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-foreground">{fmt(c.amount)}</span>
                    <Link href="/manager/collections" className="text-xs text-primary hover:underline">Review</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Section title="Recent visits" href="/manager/visits">
          {visits.length === 0 ? <Empty text="No visits recorded yet." /> : (
            <ul className="divide-y divide-border">
              {visits.map((v) => (
                <li key={v.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">{v.customers?.shop_name || v.customers?.customer_name}</div>
                    <div className="text-xs text-body capitalize">{v.visit_status.replace("_", " ")}</div>
                  </div>
                  <span className={visitStyle(v.visit_status)}>{v.visit_status.replace("_", " ")}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Open feedback" href="/manager/feedback">
          {openFeedback === 0 ? <Empty text="No open feedback items." /> : (
            <ul className="divide-y divide-border">
              {feedback.filter((f) => f.status === "open").map((f) => (
                <li key={f.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">{f.title || f.type}</div>
                    <div className="text-xs text-body capitalize">{f.type}</div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-warning/10 text-warning text-[11px] font-medium">Open</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-foreground">{title}</h3>
        <Link href={href} className="text-xs text-primary hover:underline">View all</Link>
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-body py-4 text-center">{text}</p>;
}

function fmt(n: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(n || 0);
}

function visitStyle(status: string) {
  const map: Record<string, string> = {
    in_progress: "px-2 py-0.5 rounded-full bg-primary-light text-primary text-[11px] font-medium capitalize",
    completed: "px-2 py-0.5 rounded-full bg-success/10 text-success text-[11px] font-medium capitalize",
    planned: "px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[11px] font-medium capitalize",
    missed: "px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-[11px] font-medium capitalize",
  };
  return map[status] ?? "px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[11px] font-medium capitalize";
}