"use client";

import { useRef, type PointerEvent, type ReactNode } from "react";
import authIllustration from "../../../public/auth-illustration.png";

export function AuthFrame({ children }: { children: ReactNode }) {
  const eye = useRef<HTMLDivElement>(null);

  function moveEye(event: PointerEvent<HTMLDivElement>) {
    const frame = eye.current;
    if (!frame || event.pointerType === "touch"
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = frame.getBoundingClientRect();
    const x = Math.max(-8, Math.min(8, (event.clientX - box.left - box.width / 2) / 24));
    const y = Math.max(-5, Math.min(5, (event.clientY - box.top - box.height / 2) / 24));
    frame.style.setProperty("--auth-gaze-x", `${x}px`);
    frame.style.setProperty("--auth-gaze-y", `${y}px`);
  }

  return (
    <div className="aankh-auth-frame min-h-dvh bg-card" onPointerMove={moveEye}>
      <header className="mx-auto flex min-h-16 max-w-6xl items-center gap-2 px-5 sm:px-8">
        <img src="/aankh-app-eye.png" alt="" width={32} height={32} className="size-8" />
        <span className="font-brand text-xl font-bold">Aankh</span>
      </header>
      <div className="mx-auto grid w-full max-w-6xl lg:grid-cols-2 lg:px-8">
        <aside className="relative hidden min-h-[42rem] overflow-hidden rounded-2xl bg-foreground lg:block">
          <img src={authIllustration.src} alt="" width={authIllustration.width} height={authIllustration.height} className="absolute inset-0 h-full w-full object-cover" />
          <p className="absolute inset-x-6 bottom-6 rounded-xl border border-border bg-card/90 p-4 text-sm font-semibold text-foreground backdrop-blur">
            Aankh · The eye of your business
          </p>
        </aside>
        <main className="min-w-0 px-4 pb-8 pt-2 sm:px-8 lg:flex lg:flex-col lg:justify-center lg:border-s lg:border-border lg:ps-12 lg:pt-8">
          <div className="mx-auto w-full max-w-[380px]">
            <div ref={eye} className="aankh-auth-eye relative mx-auto mb-4 grid h-12 w-28 place-items-center overflow-hidden" aria-hidden="true">
              <img src="/aankh-app-eye.png" alt="" width={84} height={84} className="absolute size-[84px] max-w-none" />
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
