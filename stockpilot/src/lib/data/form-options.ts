import "server-only";
import { listLocations } from "./business";
import { listCategories } from "./catalog";
import { listSuppliers } from "./purchasing";

export async function productFormOptions(businessId: string) {
  const [suppliers, locations, categories] = await Promise.all([listSuppliers(businessId), listLocations(businessId), listCategories(businessId)]);
  return {
    suppliers: suppliers.map((s) => ({ id: s.id, name: s.name })),
    locations: locations.map((l) => ({ id: l.id, name: l.name })),
    categories: categories.map((c) => c.name),
  };
}
