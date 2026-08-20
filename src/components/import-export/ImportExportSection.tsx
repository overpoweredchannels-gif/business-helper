"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import ImportWizardV2 from "./ImportWizardV2";
import ExportWizard from "./ExportWizard";

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

  return (
    <>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => setOpen("import")}
          className="rounded border border-primary px-3 py-1.5 text-sm text-primary hover:bg-primary/5"
          title={`Import ${entityLabel} from CSV/Excel`}
        >
          Import
        </button>
        <button
          type="button"
          onClick={() => setOpen("export")}
          className="rounded border border-primary px-3 py-1.5 text-sm text-primary hover:bg-primary/5"
          title={`Export ${entityLabel} to CSV/Excel`}
        >
          Export
        </button>
      </div>

      {open === "import" && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="relative my-8 w-full max-w-5xl rounded-lg border border-border bg-background p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-lg font-semibold text-foreground">Import {entityLabel}</h2>
              <button
                type="button"
                onClick={() => setOpen(null)}
                className="rounded border border-border px-3 py-1.5 text-sm text-foreground/80 hover:bg-muted/30"
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
              onImported={() => {
                setOpen(null);
                onImported();
              }}
              extraContext={extraContext}
            />
          </div>
        </div>
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