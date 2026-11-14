import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useRegional } from "@/components/regional/RegionalProvider";

export type QuickAddCustomerFields = {
  name: string;
  phone: string;
  address: string;
  paymentMode: "cash" | "credit";
};

/**
 * Phase C (user-visit UX): add a customer from inside the sale, with only
 * the four fields a cashier can ask at the counter — name, phone, address
 * and Cash/Credit payment mode. No credit limit is asked here: a Credit
 * customer is created with an unrestricted policy (unlimited until the
 * owner sets a limit), a Cash customer with cash_only. The parent posts
 * the fields and, on success, selects the new customer in the sale.
 */
export function QuickAddCustomerDialog({
  open,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (fields: QuickAddCustomerFields) => void;
}) {
  const { t } = useRegional();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [paymentMode, setPaymentMode] = useState<"cash" | "credit">("cash");
  const [nameError, setNameError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Fresh form state per open: the parent remounts this dialog with a new
  // key each time it opens, so the initial state above is always clean.
  useEffect(() => {
    if (open) nameInputRef.current?.focus();
  }, [open ]);

  useEffect(() => {
    if (!open || busy) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setNameError(t("pos.quickAddCustomerNameRequired"));
      nameInputRef.current?.focus();
      return;
    }
    setNameError(null);
    onSubmit({ name: name.trim(), phone: phone.trim(), address: address.trim(), paymentMode });
  };

  return createPortal(
    <div data-context-help-skip role="dialog" aria-modal="true" aria-label={t("pos.quickAddCustomerTitle")} className="fixed inset-0 z-[100] overflow-auto bg-black/30 p-4">
      <div className="mx-auto max-w-md space-y-4 rounded-xl bg-card p-4 shadow-xl">
        <h3 className="font-semibold">{t("pos.quickAddCustomerTitle")}</h3>
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm font-medium">
            {t("customers.name")}
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={150}
              disabled={busy}
              className="mt-1 min-h-11 w-full rounded border border-input bg-background px-3 text-base focus:border-ring focus:outline-none"
            />
          </label>
          {nameError && (
            <p role="alert" className="text-sm text-destructive">{nameError}</p>
          )}
          <label className="block text-sm font-medium">
            {t("customers.phone")}
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              disabled={busy}
              className="mt-1 min-h-11 w-full rounded border border-input bg-background px-3 text-base focus:border-ring focus:outline-none"
            />
          </label>
          <label className="block text-sm font-medium">
            {t("customers.address")}
            <input
              type="text"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              disabled={busy}
              className="mt-1 min-h-11 w-full rounded border border-input bg-background px-3 text-base focus:border-ring focus:outline-none"
            />
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("pos.quickAddCustomerPaymentMode")}</legend>
            <div className="flex flex-wrap gap-2">
              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded border border-input px-3 py-2 text-sm has-checked:border-ring has-checked:bg-primary/5">
                <input
                  type="radio"
                  name="quick-add-payment-mode"
                  value="cash"
                  checked={paymentMode === "cash"}
                  onChange={() => setPaymentMode("cash")}
                  disabled={busy}
                  className="accent-primary"
                />
                {t("sell.paymentCash")}
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded border border-input px-3 py-2 text-sm has-checked:border-ring has-checked:bg-primary/5">
                <input
                  type="radio"
                  name="quick-add-payment-mode"
                  value="credit"
                  checked={paymentMode === "credit"}
                  onChange={() => setPaymentMode("credit")}
                  disabled={busy}
                  className="accent-primary"
                />
                {t("sell.paymentCredit")}
              </label>
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="min-h-11 min-w-11 rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">{t("common.cancel")}</button>
            <button type="submit" disabled={busy} className="min-h-11 min-w-11 rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">{busy ? t("common.saving") : t("common.save")}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
