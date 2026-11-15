import Link from "next/link";
import { Mail, MessageCircle, Phone, Plus, Truck } from "lucide-react";
import { SupplierFormDialog } from "@/components/suppliers/supplier-forms";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page";
import { requireRole } from "@/lib/auth/session";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const ctx = await requireRole("manager");
  const { data } = await ctx.supabase
    .from("suppliers")
    .select("id, name, contact_person, email, phone, whatsapp_number, payment_terms, supplier_products(count)")
    .eq("business_id", ctx.business.id)
    .is("archived_at", null)
    .order("name");
  const suppliers = data ?? [];
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
              <p className="text-sm text-muted">{s.contact_person ?? "No contact person"}{s.payment_terms ? ` · ${s.payment_terms}` : ""}</p>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
                {s.email && <span className="flex items-center gap-1"><Mail className="size-3.5" /> {s.email}</span>}
                {s.phone && <span className="flex items-center gap-1"><Phone className="size-3.5" /> {s.phone}</span>}
                {s.whatsapp_number && <span className="flex items-center gap-1"><MessageCircle className="size-3.5" /> WhatsApp</span>}
              </div>
              <p className="mt-3 text-xs font-medium text-primary">{(s.supplier_products as unknown as { count: number }[])[0]?.count ?? 0} products</p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
