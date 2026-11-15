import { ProductForm } from "@/components/inventory/product-form";
import { PageHeader } from "@/components/ui/page";
import { requireRole } from "@/lib/auth/session";
import { productFormOptions } from "@/lib/services/form-options";

export const metadata = { title: "Add product" };

export default async function NewProductPage() {
  const ctx = await requireRole("manager");
  const options = await productFormOptions(ctx);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add product" back={{ href: "/inventory", label: "Inventory" }} />
      <ProductForm {...options} currency={ctx.business.currency} />
    </div>
  );
}
