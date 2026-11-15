import { notFound } from "next/navigation";
import { ProductForm } from "@/components/inventory/product-form";
import { PageHeader } from "@/components/ui/page";
import { requireRole } from "@/lib/auth/session";
import { productFormOptions } from "@/lib/services/form-options";

export const metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: PageProps<"/inventory/[id]/edit">) {
  const { id } = await params;
  const ctx = await requireRole("manager");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [{ data: p }, options] = await Promise.all([
    ctx.supabase.from("products").select("*, product_categories(name)").eq("id", id).eq("business_id", ctx.business.id).maybeSingle(),
    productFormOptions(ctx),
  ]);
  if (!p) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Edit ${p.name}`} back={{ href: `/inventory/${id}`, label: p.name }} />
      <ProductForm
        {...options}
        currency={ctx.business.currency}
        values={{
          id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, brand: p.brand,
          category: (p.product_categories as { name: string } | null)?.name ?? null, description: p.description, color: p.color,
          packageSize: p.package_size, synonyms: p.synonyms, costPrice: Number(p.cost_price), sellingPrice: Number(p.selling_price),
          unit: p.unit, reorderThreshold: Number(p.reorder_threshold), reorderQuantity: p.reorder_quantity === null ? null : Number(p.reorder_quantity),
          storageLocation: p.storage_location, preferredSupplierId: p.preferred_supplier_id, locationId: p.location_id, trackExpiry: p.track_expiry,
        }}
      />
    </div>
  );
}
