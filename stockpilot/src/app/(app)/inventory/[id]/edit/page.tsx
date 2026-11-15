import { notFound } from "next/navigation";
import { ProductForm } from "@/components/inventory/product-form";
import { PageHeader } from "@/components/ui/page";
import { requireRole } from "@/lib/auth/session";
import { getProduct } from "@/lib/data/catalog";
import { productFormOptions } from "@/lib/data/form-options";

export const metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: PageProps<"/inventory/[id]/edit">) {
  const { id } = await params;
  const ctx = await requireRole("manager");
  const [p, options] = await Promise.all([getProduct(ctx.business.id, id), productFormOptions(ctx.business.id)]);
  if (!p) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Edit ${p.name}`} back={{ href: `/inventory/${id}`, label: p.name }} />
      <ProductForm
        {...options}
        currency={ctx.business.currency}
        values={{
          id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, brand: p.brand, category: p.categoryName, description: p.description,
          color: p.color, packageSize: p.packageSize, synonyms: p.synonyms, costPrice: p.costPrice, sellingPrice: p.sellingPrice,
          unit: p.unit, reorderThreshold: p.reorderThreshold, reorderQuantity: p.reorderQuantity, storageLocation: p.storageLocation,
          preferredSupplierId: p.preferredSupplierId, locationId: p.locationId, trackExpiry: p.trackExpiry,
        }}
      />
    </div>
  );
}
