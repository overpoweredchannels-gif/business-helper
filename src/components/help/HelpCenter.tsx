"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { describeControl, guideTopics } from "@/lib/help/guide";

type HelpItem = { id: number; label: string; description: string; choices: string[]; x: number; y: number };

export function HelpCenter({ userId }: { userId: string }) {
  const [icons, setIcons] = useState(true); const [items, setItems] = useState<HelpItem[]>([]);
  const [iconHost, setIconHost] = useState<HTMLDialogElement | null>(null);
  const [selected, setSelected] = useState<HelpItem | null>(null); const [tour, setTour] = useState<number | null>(null); const [search, setSearch] = useState("");
  const dialog = useRef<HTMLDialogElement>(null); const signature = useRef(""); const previousFocus = useRef<HTMLElement | null>(null);
  const isOpen = selected !== null || tour !== null;
  useEffect(() => {
    try { if (!localStorage.getItem(`tradeos-guide-v1:${userId}`)) setTour(0); } catch { setTour(0); }
  }, [userId]);
  useEffect(() => {
    const element = dialog.current;
    if (isOpen && element && !element.open) { previousFocus.current = document.activeElement as HTMLElement; element.showModal(); }
    if (!isOpen && element?.open) { element.close(); if (previousFocus.current?.isConnected) previousFocus.current.focus(); }
  }, [isOpen]);
  useEffect(() => {
    if (!icons || isOpen) return;
    const ids = new WeakMap<Element, number>(); const marked = new Set<HTMLElement>(); let nextId = 0; let frame = 0;
    signature.current = "";
    const measure = () => {
      frame = 0;
      marked.forEach(element => { if (!element.isConnected) { element.removeAttribute("data-context-help-target"); element.style.removeProperty("--tradeos-help-padding"); marked.delete(element); } });
      const result: HelpItem[] = [];
      const dialogs = [...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"]')].filter(element => !element.closest("[data-app-help]") && element.getClientRects().length);
      const root = dialogs.at(-1) ?? document;
      setIconHost(root instanceof HTMLDialogElement ? root : null);
      root.querySelectorAll<HTMLElement>('input:not([type="hidden"]), select, textarea, button, a[href], h1, h2, h3, [role="tab"]').forEach(element => {
        if (element.closest('[data-app-help], [aria-hidden="true"], [hidden]') || !element.getClientRects().length) return;
        const toggle = element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type);
        const anchor = toggle ? element.labels?.[0] ?? element.closest("label") ?? element : element;
        let rect = anchor.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8 || rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) return;
        // Ignore elements scrolled out of a nested panel, or covered by another panel.
        const hit = document.elementsFromPoint(Math.max(1, Math.min(innerWidth - 1, rect.left + Math.min(rect.width / 2, 12))), Math.max(1, Math.min(innerHeight - 1, rect.top + Math.min(rect.height / 2, 12)))).find(node => !node.closest("[data-app-help]"));
        if (hit && hit !== anchor && !anchor.contains(hit) && !hit.contains(anchor)) return;
        if (!marked.has(anchor)) {
          const reserve = element.tagName === "SELECT" || (element as HTMLInputElement).type === "number" ? 44 : 26;
          anchor.style.setProperty("--tradeos-help-padding", `${(parseFloat(getComputedStyle(anchor).paddingRight) || 0) + reserve}px`);
          anchor.setAttribute("data-context-help-target", ""); marked.add(anchor);
          rect = anchor.getBoundingClientRect();
        }
        const field = element as HTMLInputElement;
        const isField = ["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName);
        const siblingLabel = element.previousElementSibling?.tagName === "LABEL" ? element.previousElementSibling : null;
        const labelNode = field.labels?.[0] ?? element.closest("label") ?? (isField ? siblingLabel ?? element.parentElement?.querySelector(":scope > label") : null);
        const clone = labelNode?.cloneNode(true) as HTMLElement | undefined;
        clone?.querySelectorAll("input,select,textarea,button,small,.text-xs").forEach(node => node.remove());
        const label = (element.getAttribute("aria-label") || clone?.textContent || element.getAttribute("placeholder") || element.getAttribute("title") || element.textContent || element.getAttribute("name") || "Option").replace(/\s+/g, " ").trim().slice(0, 120);
        if (!label) return;
        const context = element.closest("section")?.querySelector("h1,h2,h3")?.textContent?.trim() ?? "";
        const topic = element.closest("[data-help-topic]")?.getAttribute("data-help-topic");
        const choices = element.tagName === "SELECT" ? [...(element as HTMLSelectElement).options].filter(option => option.value).slice(0, 25).map(option => option.text) : [];
        if (!ids.has(element)) ids.set(element, ++nextId);
        const rightInset = element.tagName === "SELECT" || field.type === "number" ? 42 : 24;
        result.push({ id: ids.get(element)!, label, description: describeControl(label, element.tagName === "SELECT" ? "select" : field.type, context || topic || ""), choices, x: Math.round(Math.max(1, Math.min(innerWidth - 24, rect.right - rightInset))), y: Math.round(Math.max(1, rect.top + (rect.height - 20) / 2)) });
      });
      const next = JSON.stringify(result);
      if (next !== signature.current) { signature.current = next; setItems(result); }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new MutationObserver(records => { if (records.some(record => !(record.target instanceof Element ? record.target : record.target.parentElement)?.closest("[data-app-help]"))) schedule(); });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "aria-hidden", "open", "class"] });
    document.addEventListener("scroll", schedule, { capture: true, passive: true }); window.addEventListener("resize", schedule); schedule();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); document.removeEventListener("scroll", schedule, true); window.removeEventListener("resize", schedule); marked.forEach(element => { element.removeAttribute("data-context-help-target"); element.style.removeProperty("--tradeos-help-padding"); }); };
  }, [icons, isOpen]);
  const close = () => { setSelected(null); setTour(null); setSearch(""); };
  const complete = () => { try { localStorage.setItem(`tradeos-guide-v1:${userId}`, "complete"); } catch { /* Help stays usable when browser storage is unavailable. */ } close(); };
  const iconLayer = icons && !isOpen ? <div data-app-help className="pointer-events-none fixed inset-0 z-[70] print:hidden">{items.map(item => <button key={item.id} type="button" aria-label={`Help: ${item.label}`} title={`Help: ${item.label}`} onClick={() => setSelected(item)} style={{ position: "absolute", left: item.x, top: item.y }} className="pointer-events-auto flex size-5 items-center justify-center rounded-full border border-primary bg-background text-xs font-bold text-primary shadow-sm focus:ring-2 focus:ring-primary">?</button>)}</div> : null;
  return <div data-app-help className="print:hidden">
    <style>{"@media screen{[data-context-help-target]{padding-right:var(--tradeos-help-padding,26px)!important}}@media print{[data-app-help],[data-app-help]::backdrop{display:none!important}}"}</style>
    {iconHost ? createPortal(iconLayer, iconHost) : iconLayer}
    <div className="fixed bottom-3 left-3 z-[75] flex gap-2 rounded-lg border bg-background p-2 shadow-lg print:hidden">
      <button type="button" onClick={() => { setSelected(null); setTour(0); }} className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground">Help & tutorial</button>
      <button type="button" aria-pressed={icons} onClick={() => setIcons(value => !value)} className="px-2 text-xs">{icons ? "Hide ? icons" : "Show ? icons"}</button>
    </div>
    <dialog ref={dialog} aria-labelledby="tradeos-help-title" data-app-help onCancel={close} className="m-auto max-h-[85dvh] w-[min(680px,94vw)] overflow-y-auto rounded-xl border border-border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/40">
      <div className="flex items-start justify-between gap-4"><h2 id="tradeos-help-title" className="text-xl font-semibold">{selected?.label ?? guideTopics[tour ?? 0].title}</h2><button type="button" aria-label="Close help" onClick={close}>✕</button></div>
      {selected ? <div className="mt-4 space-y-4"><p>{selected.description}</p>{selected.choices.length > 0 && <div><h3 className="font-medium">Available choices</h3><ul className="list-disc pl-5">{selected.choices.map((choice, index) => <li key={index}>{choice}</li>)}</ul><p className="mt-2 text-sm">Choose the value appropriate to this record. Help does not change the selection.</p></div>}<button type="button" className="underline" onClick={() => { setSelected(null); setTour(0); }}>Open complete app tutorial</button></div> : <div className="mt-4 space-y-4">
        <p>{guideTopics[tour ?? 0].description}</p><ol className="list-decimal space-y-3 pl-6">{guideTopics[tour ?? 0].steps.map(step => <li key={step}>{step}</li>)}</ol>
        <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={(tour ?? 0) === 0} onClick={() => setTour(value => Math.max(0, (value ?? 0) - 1))} className="rounded border px-3 py-2 disabled:opacity-40">Previous</button><span>{(tour ?? 0) + 1} / {guideTopics.length}</span>{(tour ?? 0) < guideTopics.length - 1 ? <button type="button" onClick={() => setTour(value => (value ?? 0) + 1)} className="rounded bg-primary px-3 py-2 text-primary-foreground">Next</button> : <button type="button" onClick={complete} className="rounded bg-primary px-3 py-2 text-primary-foreground">Finish tutorial</button>}<button type="button" onClick={complete} className="text-sm underline">Do not show automatically again</button></div>
        <details><summary className="cursor-pointer font-medium">Find a topic</summary><input aria-label="Search tutorial" value={search} onChange={event => setSearch(event.target.value)} className="my-3 w-full rounded border bg-background p-2" placeholder="Search units, payments, staff…" /><div className="flex flex-wrap gap-2">{guideTopics.map((topic, index) => ({ topic, index })).filter(({ topic }) => `${topic.title} ${topic.description} ${topic.steps.join(" ")}`.toLowerCase().includes(search.toLowerCase())).map(({ topic, index }) => <button key={topic.title} type="button" className="rounded border p-2 text-sm" onClick={() => setTour(index)}>{topic.title}</button>)}</div></details>
      </div>}
    </dialog>
  </div>;
}
