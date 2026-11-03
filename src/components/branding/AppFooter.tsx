const FOOTER_LINKS = [
  { label: "Website", href: "https://oppresso.site/" },
  { label: "WhatsApp", href: "https://wa.me/923255355151" },
  { label: "Email", href: "mailto:contact@oppresso.site" },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/umair-abid-5140aa35b/" },
] as const;

/**
 * Global Aankh footer. Rendered once in the root layout, so it appears on
 * every route (login, signup, owner app, manager, salesman, supervisor).
 * It is hidden in print so it never lands on invoices or receipts.
 */
export function AppFooter() {
  return (
    <footer className="border-t border-border bg-card print:hidden">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center justify-between gap-2 px-4 py-3 sm:flex-row sm:px-6">
        <div className="flex items-center gap-2"><img src="/aankh-app-eye.png" alt="Aankh" width={24} height={24} className="size-6" /><p className="text-xs text-muted-foreground">Aankh <span aria-hidden="true">·</span> A product by <a href="https://oppresso.site/" target="_blank" rel="noreferrer" className="font-semibold text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">OPPRESSO</a></p></div>
        <nav aria-label="OPPRESSO contact links" className="flex flex-wrap items-center justify-center gap-1">
          {FOOTER_LINKS.map((link, index) => (
            <span key={link.label} className="flex items-center">
              {index > 0 && <span aria-hidden="true" className="mx-1 text-muted-foreground">·</span>}
              <a
                href={link.href}
                {...(link.href.startsWith("http")
                  ? { target: "_blank", rel: "noreferrer" }
                  : {})}
                className="inline-flex min-h-11 items-center rounded-lg px-2 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {link.label}
              </a>
            </span>
          ))}
        </nav>

        <p className="text-[11px] text-light-text">© 2026 OPPRESSO</p>
      </div>
    </footer>
  );
}
