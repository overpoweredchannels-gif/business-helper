import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { DashboardLayout } from "../../src/components/dashboard/DashboardLayout";
import SalesmanLayout from "../../src/components/salesman/SalesmanLayout";
import OwnerFsmLayout from "../../src/components/salesman/OwnerFsmLayout";
import SupervisorLayout from "../../src/components/salesman/SupervisorLayout";
import { navigationItems } from "../../src/lib/tradeos/constants";
import type { SectionId } from "../../src/lib/tradeos/types";

function Fixture() {
  const [section, setSection] = useState<SectionId>("dashboard");
  const content = <section className="p-4 sm:p-6">
    <h1 className="text-2xl font-bold">{section}</h1>
    <div className="flex items-center justify-between"><h2>Business overview</h2><button>New purchase</button></div>
    <div className="grid gap-4 sm:grid-cols-2"><label>Supplier<input aria-label="Supplier" className="block w-full border p-2" /></label><label>Invoice date<input aria-label="Invoice date" type="date" className="block w-full border p-2" /></label></div>
    <div className="overflow-x-auto"><table className="min-w-full"><thead><tr>{Array.from({length:12},(_,i)=><th key={i} className="px-6 py-4 whitespace-nowrap">Invoice column {i}</th>)}</tr></thead><tbody><tr>{Array.from({length:12},(_,i)=><td key={i} className="px-6">PKR 125,000</td>)}</tr></tbody></table></div>
    <button className="rounded bg-primary text-white p-3 mt-6">Save invoice</button>
  </section>;
  const role = new URLSearchParams(location.search).get("role");
  if(role === "employee") return <SalesmanLayout userName="Employee" organizationName="Test organization">{content}</SalesmanLayout>;
  if(role === "manager") return <OwnerFsmLayout userName="Manager" organizationName="Test organization">{content}</OwnerFsmLayout>;
  if(role === "supervisor") return <SupervisorLayout userName="Supervisor" organizationName="Test organization">{content}</SupervisorLayout>;
  return <DashboardLayout navigationItems={navigationItems} activeSection={section} onSectionChange={setSection}
    organizationName="A long organization name to check responsive truncation" userName="Test Owner">{content}</DashboardLayout>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
