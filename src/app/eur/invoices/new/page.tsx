"use client";

import { EurInvoiceForm } from "@/components/eur/EurInvoiceForm";
import { useRegional } from "@/components/regional/RegionalProvider";

export default function NewEurInvoicePage() {
  const { t } = useRegional();

  return (
    <div className="responsive-content space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">
          {t('eur.invoices.new')}
        </h1>
        <p className="text-sm text-body mt-1">
          {t('eur.invoices.subtitle')}
        </p>
      </div>
      <EurInvoiceForm />
    </div>
  );
}
