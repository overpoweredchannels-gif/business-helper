"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { describeControl, guideTopics } from "@/lib/help/guide";

type HelpItem = { id: number; label: string; description: string; choices: string[]; host: HTMLElement };

export function HelpCenter({ userId }: { userId: string }) {
  const [icons, setIcons] = useState(true); const [items, setItems] = useState<HelpItem[]>([]);
  const [controlsHost, setControlsHost] = useState<HTMLElement | null>(null);
  const [compactControls, setCompactControls] = useState(false);
  useEffect(() => {
    const locate = () => { const host = [...document.querySelectorAll<HTMLElement>("[data-workspace-help-slot]")].find(node => node.getClientRects().length > 0) ?? null; setControlsHost(host); setCompactControls(!host || host.hasAttribute("data-workspace-help-compact")); };
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "hidden", "class", "data-workspace-help-compact"] });
    window.addEventListener("resize", locate); locate();
    return () => { observer.disconnect(); window.removeEventListener("resize", locate); };
  }, []);
  const [selected, setSelected] = useState<HelpItem | null>(null); const [tour, setTour] = useState<number | null>(null); const [search, setSearch] = useState("");
  const dialog = useRef<HTMLDialogElement>(null); const signature = useRef(""); const previousFocus = useRef<HTMLElement | null>(null);
  const isOpen = selected !== null || tour !== null;
  useEffect(() => {
    try { setIcons(localStorage.getItem(`tradeos-help-icons:${userId}`) !== "hidden"); } catch { /* Browser storage is optional. */ }
    try { if (!localStorage.getItem(`tradeos-guide-v1:${userId}`)) setTour(0); } catch { setTour(0); }
  }, [userId]);
  useEffect(() => {
    const element = dialog.current;
    if (isOpen && element && !element.open) { previousFocus.current = document.activeElement as HTMLElement; element.showModal(); }
    if (!isOpen && element?.open) { element.close(); if (previousFocus.current?.isConnected) previousFocus.current.focus(); }
  }, [isOpen]);
  useEffect(() => {
    if (!icons || isOpen) return;
    const ids = new WeakMap<Element, number>(); const marked = new Set<HTMLElement>(); const hosts = new Map<HTMLElement, HTMLSpanElement>(); const parents = new Map<HTMLElement, string>(); let nextId = 0; let frame = 0;
    signature.current = "";
    const measure = () => {
      frame = 0;
      marked.forEach(element => { if (!element.isConnected || element.getBoundingClientRect().width < 96 || element.closest("[data-context-help-skip]")) { element.removeAttribute("data-context-help-target"); element.style.removeProperty("--tradeos-help-padding"); marked.delete(element); } });
      const result: HelpItem[] = [];
      const dialogs = [...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"]')].filter(element => !element.closest("[data-app-help]") && element.getClientRects().length);
      const root = dialogs.at(-1) ?? document;
      const seen = new Set<HTMLElement>();
      root.querySelectorAll<HTMLElement>('input:not([type="hidden"]), select, textarea, button, a[href], h1, h2, h3, [role="tab"]').forEach(element => {
        if (element.closest('[data-app-help], [data-context-help-skip], [aria-hidden="true"], [hidden]') || !element.getClientRects().length) return;
        const toggle = element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type);
        const anchor = toggle ? element.labels?.[0] ?? element.closest("label") ?? element : element;
        let rect = anchor.getBoundingClientRect();
        // Compact action buttons keep their existing labels/tooltips. A second
        // clickable target inside them would intercept the original action.
        if (rect.width < 96 || rect.height < 24) return;
        const parent = anchor.parentElement;
        if (!parent) return;
        seen.add(anchor);
        let host = hosts.get(anchor);
        if (!host) {
          host = document.createElement("span");
          host.setAttribute("data-app-help", "");
          host.style.cssText = "position:absolute;width:24px;height:24px;z-index:1;pointer-events:none";
          if (getComputedStyle(parent).position === "static") { parents.set(parent, parent.style.position); parent.style.position = "relative"; }
          parent.appendChild(host); hosts.set(anchor, host); ids.set(element, ++nextId);
        }
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
        clone?.querySelectorAll("input,select,textarea,button,small,.text-xs,[data-app-help]").forEach(node => node.remove());
        const label = (element.getAttribute("aria-label") || clone?.textContent || element.getAttribute("placeholder") || element.getAttribute("title") || element.textContent || element.getAttribute("name") || "Option").replace(/\s+/g, " ").trim().slice(0, 120);
        if (!label) return;
        const context = element.closest("section")?.querySelector("h1,h2,h3")?.textContent?.trim() ?? "";
        const topic = element.closest("[data-help-topic]")?.getAttribute("data-help-topic");
        const choices = element.tagName === "SELECT" ? [...(element as HTMLSelectElement).options].filter(option => option.value).slice(0, 25).map(option => option.text) : [];
        if (!ids.has(element)) ids.set(element, ++nextId);
        const rightInset = element.tagName === "SELECT" || field.type === "number" ? 42 : 24;
        const parentRect = parent.getBoundingClientRect();
        host.style.left = `${rect.right - parentRect.left + parent.scrollLeft - parent.clientLeft - rightInset}px`;
        host.style.top = `${rect.top - parentRect.top + parent.scrollTop - parent.clientTop + (rect.height - 24) / 2}px`;
        result.push({ id: ids.get(element)!, label, description: describeControl(label, element.tagName === "SELECT" ? "select" : field.type, context || topic || ""), choices, host });
      });
      hosts.forEach((host, anchor) => { if (!seen.has(anchor)) { host.remove(); hosts.delete(anchor); } });
      const next = JSON.stringify(result.map(({ host, ...item }) => ({ ...item, connected: host.isConnected })));
      if (next !== signature.current) { signature.current = next; setItems(result); }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new MutationObserver(records => { if (records.some(record => !(record.target instanceof Element ? record.target : record.target.parentElement)?.closest("[data-app-help]"))) schedule(); });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "aria-hidden", "open", "class"] });
    const resize = new ResizeObserver(schedule); resize.observe(document.body);
    window.addEventListener("resize", schedule); schedule();
    return () => { observer.disconnect(); resize.disconnect(); cancelAnimationFrame(frame); hosts.forEach(host => host.remove()); parents.forEach((position, parent) => { parent.style.position = position; }); window.removeEventListener("resize", schedule); marked.forEach(element => { element.removeAttribute("data-context-help-target"); element.style.removeProperty("--tradeos-help-padding"); }); };
  }, [icons, isOpen]);
  const close = () => { setSelected(null); setTour(null); setSearch(""); };
  const toggleIcons = () => setIcons(current => { try { localStorage.setItem(`tradeos-help-icons:${userId}`, current ? "hidden" : "visible"); } catch { /* Browser storage is optional. */ } return !current; });
  const complete = () => { try { localStorage.setItem(`tradeos-guide-v1:${userId}`, "complete"); } catch { /* Help stays usable when browser storage is unavailable. */ } close(); };
  const iconLayer = icons && !isOpen ? items.filter(item => item.host.isConnected).map(item => createPortal(<button data-app-help type="button" aria-label={`Help: ${item.label}`} title={`Help: ${item.label}`} onClick={event => { event.preventDefault(); event.stopPropagation(); setSelected(item); }} style={{ width: 24, height: 24, minWidth: 24, minHeight: 24, padding: 4, border: 0, background: "transparent", pointerEvents: "auto", display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ width: 14, height: 14, fontSize: 10, lineHeight: "12px" }} className="rounded-full border border-primary bg-background text-center font-semibold text-primary">?</span></button>, item.host, String(item.id))) : null;
  const controls = <div data-app-help className={controlsHost ? "flex flex-col gap-2" : "fixed bottom-3 left-3 z-[75] flex gap-2 rounded-lg border bg-background p-2 shadow-lg print:hidden"}><button type="button" onClick={() => { setSelected(null); setTour(0); }} className="min-h-11 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary" aria-label="Help & tutorial">{compactControls ? "Help" : "Help & tutorial"}</button>{!compactControls && <button type="button" aria-pressed={icons} onClick={toggleIcons} className="min-h-11 rounded-lg border px-3 py-2 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary">{icons ? "Hide tutorial icons" : "Show tutorial icons"}</button>}</div>;
  return <div data-app-help className="print:hidden">
    <style>{"@media screen{[data-context-help-target]{padding-right:var(--tradeos-help-padding,26px)!important}}@media print{[data-app-help],[data-app-help]::backdrop{display:none!important}}"}</style>
    {iconLayer}
    {controlsHost ? createPortal(controls, controlsHost) : controls}
    <dialog ref={dialog} aria-labelledby="tradeos-help-title" data-app-help onCancel={close} className="m-auto max-h-[85dvh] w-[min(680px,94vw)] overflow-y-auto rounded-xl border border-border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/40">
      <div className="flex items-start justify-between gap-4"><h2 id="tradeos-help-title" className="text-xl font-semibold">{selected?.label ?? guideTopics[tour ?? 0].title}</h2><button type="button" aria-label="Close help" onClick={close}>✕</button></div>
      <button type="button" aria-pressed={icons} onClick={toggleIcons} className="mt-4 min-h-11 rounded-lg border px-4 py-2 text-sm">{icons ? "Hide tutorial icons" : "Show tutorial icons"}</button>{selected ? <div className="mt-4 space-y-4"><p>{selected.description}</p>{selected.choices.length > 0 && <div><h3 className="font-medium">Available choices</h3><ul className="list-disc pl-5">{selected.choices.map((choice, index) => <li key={index}>{choice}</li>)}</ul><p className="mt-2 text-sm">Choose the value appropriate to this record. Help does not change the selection.</p></div>}<button type="button" className="underline" onClick={() => { setSelected(null); setTour(0); }}>Open complete app tutorial</button></div> : <div className="mt-4 space-y-4">
        <p>{guideTopics[tour ?? 0].description}</p><ol className="list-decimal space-y-3 pl-6">{guideTopics[tour ?? 0].steps.map(step => <li key={step}>{step}</li>)}</ol>
        <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={(tour ?? 0) === 0} onClick={() => setTour(value => Math.max(0, (value ?? 0) - 1))} className="rounded border px-3 py-2 disabled:opacity-40">Previous</button><span>{(tour ?? 0) + 1} / {guideTopics.length}</span>{(tour ?? 0) < guideTopics.length - 1 ? <button type="button" onClick={() => setTour(value => (value ?? 0) + 1)} className="rounded bg-primary px-3 py-2 text-primary-foreground">Next</button> : <button type="button" onClick={complete} className="rounded bg-primary px-3 py-2 text-primary-foreground">Finish tutorial</button>}<button type="button" onClick={complete} className="text-sm underline">Do not show automatically again</button></div>
        <details><summary className="cursor-pointer font-medium">Find a topic</summary><input aria-label="Search tutorial" value={search} onChange={event => setSearch(event.target.value)} className="my-3 w-full rounded border bg-background p-2" placeholder="Search units, payments, staff…" /><div className="flex flex-wrap gap-2">{guideTopics.map((topic, index) => ({ topic, index })).filter(({ topic }) => `${topic.title} ${topic.description} ${topic.steps.join(" ")}`.toLowerCase().includes(search.toLowerCase())).map(({ topic, index }) => <button key={topic.title} type="button" className="rounded border p-2 text-sm" onClick={() => setTour(index)}>{topic.title}</button>)}</div></details>
      </div>}
    </dialog>
  </div>;
}
