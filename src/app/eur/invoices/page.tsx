"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { useRegional } from "@/components/regional/RegionalProvider";
import { Loader2, AlertCircle, Plus, FileText } from "lucide-react";
import Link from "next/link";

interface EurInvoice {
  id: string;
  invoice_number: string;
  customer_name: string;
  total: number;
  status: string;
  created_at: string;
}

export default function EurInvoicesPage() {
  const { t } = useRegional();
  const [invoices, setInvoices] = useState<EurInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInvoices = useCallback(async () => {
    try {
      setLoading(true);
      const res = await authorizedFetch("/api/eur/invoices");
      const data = await res.json();
      if (data.ok) {
        setInvoices(data.invoices);
      } else {
        setError(data.error || t('eur.invoices.loadFailed'));
      }
    } catch (err) {
      setError(t('eur.invoices.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  if (loading) {
    return (
      <div className="responsive-content flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-body">{t('common.loading')}</span>
      </div>
    );
  }

  return (
    <div className="responsive-content space-y-5 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading font-bold text-2xl text-foreground">
            {t('eur.invoices.title')}
          </h1>
          <p className="text-sm text-body mt-1">
            {t('eur.invoices.subtitle')}
          </p>
        </div>
        <Link
          href="/eur/invoices/new"
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium min-h-[44px] hover:bg-primary-hover transition-colors"
        >
          <Plus className="h-4 w-4" />
          {t('eur.invoices.new')}
        </Link>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 bg-destructive/10 text-destructive rounded-lg">
          <AlertCircle className="h-5 w-5" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {invoices.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="h-12 w-12 mx-auto text-light-text mb-4" />
          <p className="text-body">{t('eur.invoices.empty')}</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {invoices.map((inv) => (
            <div
              key={inv.id}
              className="p-4 bg-card border border-border rounded-lg"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-foreground">
                    {inv.invoice_number}
                  </div>
                  <div className="text-sm text-body">{inv.customer_name}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-foreground tabular-nums">
                    €{inv.total.toFixed(2)}
                  </div>
                  <div className="text-xs text-light-text">{inv.status}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
