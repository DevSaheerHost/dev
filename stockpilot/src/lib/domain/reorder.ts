/** Low-stock detection, reorder suggestions and draft purchase order grouping. */

export type StockStatus = "out_of_stock" | "low_stock" | "ok";

export function stockStatus(current: number, threshold: number): StockStatus {
  if (current <= 0) return "out_of_stock";
  if (threshold > 0 && current < threshold) return "low_stock";
  return "ok";
}

export interface ReorderInput {
  currentQuantity: number;
  reorderThreshold: number;
  /** Owner-configured order quantity; overrides the heuristic when set. */
  reorderQuantity?: number | null;
  /** Supplier pack size: orders are rounded up to whole packs. */
  packSize?: number | null;
}

/**
 * Suggested order in base units. Without an explicit reorder quantity we
 * restock to twice the threshold, then round up to whole supplier packs.
 *   current 4, threshold 10, pack 12  ->  target 20, need 16, order 24
 */
export function suggestReorderQuantity(input: ReorderInput): number {
  const { currentQuantity, reorderThreshold } = input;
  if (stockStatus(currentQuantity, reorderThreshold) === "ok") return 0;
  const pack = input.packSize && input.packSize > 0 ? input.packSize : 1;
  const need = input.reorderQuantity && input.reorderQuantity > 0
    ? Math.max(input.reorderQuantity, reorderThreshold - currentQuantity)
    : Math.max(reorderThreshold * 2 - currentQuantity, 1);
  return Math.ceil(need / pack) * pack;
}

export interface ReorderCandidate {
  productId: string;
  productName: string;
  unit: string;
  currentQuantity: number;
  reorderThreshold: number;
  reorderQuantity: number | null;
  supplierId: string | null;
  supplierName: string | null;
  unitCost: number;
  packSize: number | null;
}

export interface DraftOrderLine {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  unitCost: number;
  lineTotal: number;
}

export interface DraftOrder {
  supplierId: string;
  supplierName: string;
  lines: DraftOrderLine[];
  estimatedTotal: number;
}

export interface DraftPlan {
  orders: DraftOrder[];
  /** Low-stock products with no preferred supplier: cannot be ordered automatically. */
  unassigned: ReorderCandidate[];
}

const money = (n: number) => Math.round(n * 100) / 100;

export function planDraftOrders(candidates: ReorderCandidate[]): DraftPlan {
  const bySupplier = new Map<string, DraftOrder>();
  const unassigned: ReorderCandidate[] = [];

  for (const c of candidates) {
    const quantity = suggestReorderQuantity(c);
    if (quantity <= 0) continue;
    if (!c.supplierId || !c.supplierName) {
      unassigned.push(c);
      continue;
    }
    const order = bySupplier.get(c.supplierId) ?? { supplierId: c.supplierId, supplierName: c.supplierName, lines: [], estimatedTotal: 0 };
    const lineTotal = money(quantity * c.unitCost);
    order.lines.push({ productId: c.productId, productName: c.productName, unit: c.unit, quantity, unitCost: c.unitCost, lineTotal });
    order.estimatedTotal = money(order.estimatedTotal + lineTotal);
    bySupplier.set(c.supplierId, order);
  }

  const orders = [...bySupplier.values()].sort((a, b) => a.supplierName.localeCompare(b.supplierName));
  for (const o of orders) o.lines.sort((a, b) => a.productName.localeCompare(b.productName));
  return { orders, unassigned };
}
