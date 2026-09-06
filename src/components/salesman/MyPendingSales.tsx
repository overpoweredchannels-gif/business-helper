"use client";
import { useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";

export function MyPendingSales() {
  const [rows, setRows] = useState<Array<{ id: string; so_number: string; status: string; total_amount: number }>>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    authorizedFetch("/api/sales/drafts/mine").then(async response => {
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not load pending sales");
      setRows((data.drafts ?? []).filter((row: { status: string }) => ["pending_approval", "rejected", "draft"].includes(row.status)));
    }).catch(reason => setError(reason.message));
  }, []);
  return <section className="mt-4 rounded-xl border border-border p-4"><h2 className="font-semibold">My submitted sales</h2>
    <p className="mb-3 text-sm text-muted-foreground">Waiting for approval or returned by the owner.</p>
    {error && <p role="alert">{error}</p>}
    {!error && !rows.length && <p className="text-sm">No pending submissions.</p>}
    <ul className="grid gap-2">{rows.map(row => <li key={row.id} className="rounded border p-3 text-sm">{row.so_number} · {row.status === "pending_approval" ? "Waiting for owner approval" : row.status === "rejected" ? "Rejected by owner" : "Draft"} · PKR {Number(row.total_amount || 0).toLocaleString()}</li>)}</ul>
  </section>;
}
