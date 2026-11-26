import type { ReactNode } from "react";

export function CatalogTable({ label, columns, children }: {
  label: string;
  columns: readonly string[];
  children: ReactNode;
}) {
  return (
    <div className="catalog-table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className="catalog-table">
        <thead><tr>{columns.map((column, index) => <th scope="col" key={index}>{column}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function CatalogIdentity({ icon, title, children }: {
  icon: ReactNode;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span aria-hidden="true" className="surface-icon">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-foreground [overflow-wrap:anywhere]">{title}</div>
        {children && <div className="mt-1 space-y-1 text-xs text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}
