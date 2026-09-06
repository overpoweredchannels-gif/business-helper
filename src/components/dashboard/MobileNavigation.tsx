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
