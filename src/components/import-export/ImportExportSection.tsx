"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import ImportWizardV2 from "./ImportWizardV2";
import ExportWizard from "./ExportWizard";
import { getEntityExportConfig } from "@/lib/import-export/registry";

interface ImportExportSectionProps {
  entityKey: string;
  entityLabel: string;
  supabase: SupabaseClient;
  organizationId: string | null;
  actorProfileId: string | null;
  createAuditLog: (params: any) => Promise<void>;
  onImported: () => void;
  extraContext?: Record<string, any>;
}

export default function ImportExportSection({
  entityKey,
  entityLabel,
  supabase,
  organizationId,
  actorProfileId,
  createAuditLog,
  onImported,
  extraContext,
}: ImportExportSectionProps) {
  const [open, setOpen] = useState<"import" | "export" | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open === "import" && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [open]);

  return (
    <>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => setOpen("import")}
          className="min-h-11 rounded-lg border border-primary bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary"
          title={`Import ${entityLabel} from CSV/Excel`}
        >
          Import
        </button>
        {getEntityExportConfig(entityKey) && <button
          type="button"
          onClick={() => setOpen("export")}
          className="min-h-11 rounded-lg border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-primary"
          title={`Export ${entityLabel} to CSV/Excel`}
        >
          Export
        </button>}
      </div>

      {open === "import" && (
        <dialog ref={dialog} aria-label={`Import ${entityLabel}`} onCancel={event => { if (busy) event.preventDefault(); else setOpen(null); }} className="m-auto max-h-[90dvh] w-[min(1024px,94vw)] overflow-y-auto rounded-xl border border-border bg-background p-5 text-foreground shadow-xl backdrop:bg-black/40">
            <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-lg font-semibold text-foreground">Import {entityLabel}</h2>
              <button
                type="button"
                onClick={() => setOpen(null)}
                disabled={busy}
                className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/30 disabled:opacity-50"
              >
                Close
              </button>
            </div>
            <ImportWizardV2
              entityKey={entityKey}
              supabase={supabase}
              organizationId={organizationId}
              actorProfileId={actorProfileId}
              createAuditLog={createAuditLog}
              onImportingChange={setBusy}
              onImported={() => {
                onImported();
              }}
              extraContext={extraContext}
            />
        </dialog>
      )}

      {open === "export" && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="relative my-8 w-full max-w-2xl rounded-lg border border-border bg-background p-5 shadow-xl">
            <ExportWizard entityKey={entityKey} onClose={() => setOpen(null)} />
          </div>
        </div>
      )}
    </>
  );
}
