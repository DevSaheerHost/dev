import Link from "next/link";
import { Mail, MessageCircle, Phone, Plus, Truck } from "lucide-react";
import { SupplierFormDialog } from "@/components/suppliers/supplier-forms";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page";
import { requireRole } from "@/lib/auth/session";
import { listSuppliers } from "@/lib/data/purchasing";
import { biz } from "@/lib/data/refs";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const ctx = await requireRole("manager");
  const [suppliers, links] = await Promise.all([listSuppliers(ctx.business.id), biz(ctx.business.id).supplierProducts.get()]);
  const count = (id: string) => links.docs.filter((d) => d.data().supplierId === id).length;
  return (
    <>
      <PageHeader title="Suppliers" description="Who you buy from, what they charge and how they pack it." actions={<SupplierFormDialog trigger={<Button><Plus /> Add supplier</Button>} />} />
      {suppliers.length === 0 ? (
        <Card><EmptyState icon={Truck} title="No suppliers yet" description="Add suppliers to generate purchase orders automatically when stock runs low." /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {suppliers.map((s) => (
            <Link key={s.id} href={`/suppliers/${s.id}`} className="rounded-xl border border-border bg-surface p-4 shadow-card transition-colors hover:border-border-strong">
              <p className="font-semibold">{s.name}</p>
              <p className="text-sm text-muted">{s.contactPerson ?? "No contact person"}{s.paymentTerms ? ` · ${s.paymentTerms}` : ""}</p>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
                {s.email && <span className="flex items-center gap-1"><Mail className="size-3.5" /> {s.email}</span>}
                {s.phone && <span className="flex items-center gap-1"><Phone className="size-3.5" /> {s.phone}</span>}
                {s.whatsappNumber && <span className="flex items-center gap-1"><MessageCircle className="size-3.5" /> WhatsApp</span>}
              </div>
              <p className="mt-3 text-xs font-medium text-primary">{count(s.id)} products</p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
