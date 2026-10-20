"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { setupFields, validateSetupValue, type SetupEntity } from "@/lib/tradeos/data-quality";
import { useRegional } from "@/components/regional/RegionalProvider";

export function SetupReview({ entity, onSaved }: { entity: SetupEntity; onSaved: () => void }) {
  const { t } = useRegional();
  const entityName = t(entity === "products" ? 'setup.entityProducts' : 'setup.entityCustomers');
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
    catch (error) { setMessage(error instanceof Error ? error.message : t('setup.loadError')); }
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
  const choices = options[field] ?? ({ track_batch: [{ id: "true", label: t('common.yes') }, { id: "false", label: t('common.no') }], track_expiry: [{ id: "true", label: t('common.yes') }, { id: "false", label: t('common.no') }], overselling_policy: ["allow", "block"], credit_policy: ["cash_only", "limit_only", "days_only", "limit_and_days", "unrestricted"], preferred_payment_method: ["cash", "bank", "other"] } as Record<string, any[]>)[field];
  return <section className="bulk-setup-review mb-4 rounded-xl border border-primary/30 bg-card p-5 text-foreground">
    <div className="flex flex-wrap gap-3"><strong>{t('setup.banner').replace('{count}', String(rows.length)).replace('{entity}', entityName).replace('{unset}', String(rows.filter(r => r.missing.length).length))}</strong><button type="button" disabled={busy} onClick={() => { setExpanded(!expanded); void load(); }} className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">{expanded ? t('common.close') : t('setup.reviewBulkEdit')}</button></div>
    <p className="text-sm">{t('setup.unsetHint')}</p>
    {expanded && <fieldset disabled={busy} className="mt-3 min-w-0 space-y-3">
      <div className="flex flex-wrap gap-2"><select aria-label={t('setup.settingToUpdate')} value={field} onChange={e => { setField(e.target.value); setValue(""); setSelected([]); setPage(0); }}>{Object.entries(setupFields[entity]).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <input aria-label={t('setup.searchRecords')} placeholder={t('setup.searchRecords')} value={search} onChange={e => { setSearch(e.target.value); setPage(0); setSelected([]); }} />
      <label><input type="checkbox" checked={onlyMissing} onChange={e => { setOnlyMissing(e.target.checked); setSelected([]); setPage(0); }} /> {t('setup.onlyMissing')}</label></div>
      <div className="flex flex-wrap gap-3"><button type="button" disabled={!filtered.length} onClick={() => setSelected(filtered.map(row => row.id))}>{t('setup.selectAllMatching').replace('{count}', String(filtered.length))}</button><button type="button" disabled={!selected.length} onClick={() => setSelected([])}>{t('setup.clearSelection')}</button><span>{t('setup.selectedCount').replace('{count}', String(selected.length))}</span></div>
      <div className="max-h-64 overflow-auto">{filtered.slice(page * 50, page * 50 + 50).map(row => <label key={row.id} className="flex gap-2 border-b p-1"><input type="checkbox" checked={selected.includes(row.id)} onChange={e => setSelected(prev => e.target.checked ? [...prev, row.id] : prev.filter(id => id !== row.id))} />{row.label}<span className="text-xs">{row.missing.map((x: any) => x.label).join(", ")}</span></label>)}</div>
      <div className="flex gap-3"><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('setup.previous')}</button><span>{t('setup.pageOf').replace('{page}', String(page + 1)).replace('{pages}', String(Math.max(1, Math.ceil(filtered.length / 50))))}</span><button type="button" disabled={(page + 1) * 50 >= filtered.length} onClick={() => setPage(page + 1)}>{t('common.next')}</button></div>
      <div className="flex flex-wrap gap-2">{choices ? <select aria-label={t('setup.newSettingValue')} value={value} onChange={e => setValue(e.target.value)}><option value="">{t('setup.chooseValue')}</option>{choices.map(option => typeof option === "string" ? <option key={option}>{option}</option> : <option key={option.id} value={option.id}>{option.label}</option>)}</select> : <input aria-label={t('setup.newSettingValue')} placeholder={t('setup.newValue')} value={value} onChange={e => setValue(e.target.value)} />}
      <button type="button" disabled={busy || !selected.length || value === ""} className="bg-primary! text-primary-foreground!" onClick={() => { try { validateSetupValue(entity, field, value); setMessage(""); setConfirmation({ ids: [...selected], field, value }); } catch (error) { setMessage(error instanceof Error ? error.message : t('setup.invalidSetting')); } }}>{t('setup.applyToSelected')}</button></div>
      {confirmation && <div role="group" aria-label={t('setup.confirmBulkChange')} className="rounded border border-amber-500 p-3">
      <p>{t('setup.confirmApply').replace('{field}', setupFields[entity][confirmation.field as keyof typeof setupFields[typeof entity]] ?? confirmation.field).replace('{value}', confirmation.value).replace('{count}', String(confirmation.ids.length)).replace('{entity}', entityName)}</p>
      <button type="button" className="bg-primary! text-primary-foreground!" disabled={busy} onClick={async () => {
        if (saveLock.current) return;
        saveLock.current = true;
        setBusy(true); setMessage("");
        try { const res = await authorizedFetch("/api/data-quality", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity, ...confirmation }) }); const data = await res.json(); if (!res.ok || !data.ok) throw new Error(data.error); setMessage(t('setup.updatedCount').replace('{updated}', String(data.updated)).replace('{requested}', String(data.requested))); setSelected([]); setConfirmation(null); setPage(0); await load(); onSaved(); }
        catch (error) { setMessage(error instanceof Error ? error.message : t('setup.updateFailed')); await load(); onSaved(); } finally { setBusy(false); saveLock.current = false; }
      }}>{busy ? t('setup.applying') : t('setup.confirmBulkChange')}</button><button type="button" disabled={busy} onClick={() => setConfirmation(null)}>{t('common.cancel')}</button></div>}
    </fieldset>}
    {message && <p role="status">{message}</p>}
  </section>;
}
