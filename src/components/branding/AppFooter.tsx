const FOOTER_LINKS = [
  { label: "Website", href: "https://oppresso.site/" },
  { label: "WhatsApp", href: "https://wa.me/923255355151" },
  { label: "Email", href: "mailto:contact@oppresso.site" },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/umair-abid-5140aa35b/" },
] as const;

/**
 * Global AANKH footer. Rendered once in the root layout, so it appears on
 * every route (login, signup, owner app, manager, salesman, supervisor).
 * It is hidden in print so it never lands on invoices or receipts.
 */
export function AppFooter() {
  return (
    <footer className="border-t border-border bg-card print:hidden">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <img
            src="/aankh-icon.svg"
            alt="AANKH logo"
            width={36}
            height={36}
            className="size-9 shrink-0 rounded-lg"
          />
          <div className="min-w-0">
            <p className="font-brand text-base font-bold text-foreground">AANKH</p>
            <p className="text-sm text-body">The eye of your business</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <img
            src="/oppresso-monogram.png"
            alt="OPPRESSO logo"
            width={28}
            height={28}
            className="size-7 shrink-0 rounded-md"
          />
          <p className="text-sm text-body">A product by OPPRESSO</p>
        </div>

        <nav aria-label="OPPRESSO contact links" className="flex flex-wrap items-center gap-x-1 gap-y-2">
          {FOOTER_LINKS.map((link, index) => (
            <span key={link.label} className="flex items-center">
              {index > 0 && <span aria-hidden="true" className="mx-1 text-muted-foreground">·</span>}
              <a
                href={link.href}
                {...(link.href.startsWith("http")
                  ? { target: "_blank", rel: "noreferrer" }
                  : {})}
                className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {link.label}
              </a>
            </span>
          ))}
        </nav>

        <p className="text-xs text-light-text">© 2026 OPPRESSO. All rights reserved.</p>
      </div>
    </footer>
  );
}
