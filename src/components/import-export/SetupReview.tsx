"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { setupFields, validateSetupValue, type SetupEntity } from "@/lib/tradeos/data-quality";

export function SetupReview({ entity, onSaved }: { entity: SetupEntity; onSaved: () => void }) {
  const [rows, setRows] = useState<any[]>([]); const [options, setOptions] = useState<Record<string, any[]>>({});
  const [expanded, setExpanded] = useState(false); const [selected, setSelected] = useState<string[]>([]);
  const [field, setField] = useState(Object.keys(setupFields[entity])[0]); const [value, setValue] = useState("");
  const [search, setSearch] = useState(""); const [onlyMissing, setOnlyMissing] = useState(true); const [page, setPage] = useState(0);
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{ ids: string[]; field: string; value: string } | null>(null);
  const saveLock = useRef(false);
  useEffect(() => { setConfirmation(null); }, [selected, field, value, search, onlyMissing]);
  const load = useCallback(async () => {
    try { const res = await authorizedFetch(`/api/data-quality?entity=${entity}`); const data = await res.json(); if (!res.ok || !data.ok) throw new Error(data.error); setRows(data.rows); setOptions(data.options); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not load setup review"); }
  }, [entity]);
  // Fetch persisted server data when this entity changes; updates happen after the request.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener("tradeos:import-complete", refresh);
    return () => window.removeEventListener("tradeos:import-complete", refresh);
  }, [load]);
  const filtered = useMemo(() => rows.filter(row => (!onlyMissing || row.missing.some((item: any) => item.key === field)) && row.label.toLowerCase().includes(search.toLowerCase())), [rows, onlyMissing, field, search]);
  const choices = options[field] ?? ({ track_batch: [{ id: "true", label: "Yes" }, { id: "false", label: "No" }], track_expiry: [{ id: "true", label: "Yes" }, { id: "false", label: "No" }], overselling_policy: ["allow", "block"], credit_policy: ["cash_only", "limit_only", "days_only", "limit_and_days", "unrestricted"], preferred_payment_method: ["cash", "bank", "other"] } as Record<string, any[]>)[field];
  return <section className="bulk-setup-review mb-4 rounded-xl border border-primary/30 bg-card p-5 text-foreground">
    <div className="flex flex-wrap gap-3"><strong>{rows.length} {entity} · {rows.filter(r => r.missing.length).length} with unset settings</strong><button type="button" disabled={busy} onClick={() => { setExpanded(!expanded); void load(); }} className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">{expanded ? "Close" : "Review and bulk edit"}</button></div>
    <p className="text-sm">Unset fields need review. Zero and No are valid choices. Customer assignment is optional; permitted salesmen can still sell to unassigned customers. Existing stock history is retained.</p>
    {expanded && <fieldset disabled={busy} className="mt-3 min-w-0 space-y-3">
      <div className="flex flex-wrap gap-2"><select aria-label="Setting to update" value={field} onChange={e => { setField(e.target.value); setValue(""); setSelected([]); setPage(0); }}>{Object.entries(setupFields[entity]).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <input aria-label="Search records" placeholder="Search records" value={search} onChange={e => { setSearch(e.target.value); setPage(0); setSelected([]); }} />
      <label><input type="checkbox" checked={onlyMissing} onChange={e => { setOnlyMissing(e.target.checked); setSelected([]); setPage(0); }} /> Only records missing this setting</label></div>
      <div className="flex flex-wrap gap-3"><button type="button" disabled={!filtered.length} onClick={() => setSelected(filtered.map(row => row.id))}>Select all {filtered.length} matching records</button><button type="button" disabled={!selected.length} onClick={() => setSelected([])}>Clear selection</button><span>{selected.length} selected</span></div>
      <div className="max-h-64 overflow-auto">{filtered.slice(page * 50, page * 50 + 50).map(row => <label key={row.id} className="flex gap-2 border-b p-1"><input type="checkbox" checked={selected.includes(row.id)} onChange={e => setSelected(prev => e.target.checked ? [...prev, row.id] : prev.filter(id => id !== row.id))} />{row.label}<span className="text-xs">{row.missing.map((x: any) => x.label).join(", ")}</span></label>)}</div>
      <div className="flex gap-3"><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page + 1} of {Math.max(1, Math.ceil(filtered.length / 50))}</span><button type="button" disabled={(page + 1) * 50 >= filtered.length} onClick={() => setPage(page + 1)}>Next</button></div>
      <div className="flex flex-wrap gap-2">{choices ? <select aria-label="New setting value" value={value} onChange={e => setValue(e.target.value)}><option value="">Choose value</option>{choices.map(option => typeof option === "string" ? <option key={option}>{option}</option> : <option key={option.id} value={option.id}>{option.label}</option>)}</select> : <input aria-label="New setting value" placeholder="New value" value={value} onChange={e => setValue(e.target.value)} />}
      <button type="button" disabled={busy || !selected.length || value === ""} className="bg-primary! text-primary-foreground!" onClick={() => { try { validateSetupValue(entity, field, value); setMessage(""); setConfirmation({ ids: [...selected], field, value }); } catch (error) { setMessage(error instanceof Error ? error.message : "Choose a valid setting"); } }}>Apply to selected records</button></div>
      {confirmation && <div role="group" aria-label="Confirm bulk change" className="rounded border border-amber-500 p-3">
      <p>Apply {setupFields[entity][confirmation.field as keyof typeof setupFields[typeof entity]] ?? confirmation.field} = {confirmation.value} to {confirmation.ids.length} selected {entity}?</p>
      <button type="button" className="bg-primary! text-primary-foreground!" disabled={busy} onClick={async () => {
        if (saveLock.current) return;
        saveLock.current = true;
        setBusy(true); setMessage("");
        try { const res = await authorizedFetch("/api/data-quality", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity, ...confirmation }) }); const data = await res.json(); if (!res.ok || !data.ok) throw new Error(data.error); setMessage(`Updated ${data.updated} of ${data.requested} selected records.`); setSelected([]); setConfirmation(null); setPage(0); await load(); onSaved(); }
        catch (error) { setMessage(error instanceof Error ? error.message : "Update failed"); await load(); onSaved(); } finally { setBusy(false); saveLock.current = false; }
      }}>{busy ? "Applying…" : "Confirm bulk change"}</button><button type="button" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button></div>}
    </fieldset>}
    {message && <p role="status">{message}</p>}
  </section>;
}
