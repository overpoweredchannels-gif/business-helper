"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/** Native modal provides focus containment, Escape handling and background inertness. */
export function MobileNavigation({ open, onClose, children }: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element || !open) return;
    element.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) onClose(); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      desktop.removeEventListener("change", closeOnDesktop);
    };
  }, [open, onClose]);
  return (
    <dialog ref={dialog} aria-label="Navigation menu" className="mobile-navigation" onCancel={onClose}
      onKeyDown={(event) => {
        if (event.key !== "Tab" || !dialog.current) return;
        const controls = Array.from(dialog.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )).filter(control => control.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first || !last) return;
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !dialog.current.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !dialog.current.contains(active))) {
          event.preventDefault();
          first.focus();
        }
      }}
      onClick={(event) => { if (event.target === dialog.current) onClose(); }}>
      <div className="mobile-navigation-panel">
        <button type="button" onClick={onClose} aria-label="Close navigation menu" className="mobile-navigation-close">
          <X className="size-5" />
        </button>
        {children}
      </div>
    </dialog>
  );
}
