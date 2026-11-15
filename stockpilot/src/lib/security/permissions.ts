/**
 * Role capabilities, used for UI decisions and early server-side checks.
 * The database (RLS + RPC role checks) remains the source of truth.
 */
import type { MemberRole } from "@/lib/domain/types";

export const CAPABILITIES = {
  "inventory.view": ["owner", "manager", "employee"],
  "inventory.audit": ["owner", "manager", "employee"],
  "inventory.report_loss": ["owner", "manager", "employee"],
  "inventory.view_costs": ["owner", "manager"],
  "products.write": ["owner", "manager"],
  "products.delete": ["owner"],
  "stock.adjust": ["owner", "manager"],
  "suppliers.write": ["owner", "manager"],
  "purchase_orders.view": ["owner", "manager"],
  "purchase_orders.create": ["owner", "manager"],
  "purchase_orders.approve": ["owner"],
  "review.approve_any": ["owner", "manager"],
  "reports.view": ["owner", "manager"],
  "integrations.view": ["owner", "manager"],
  "integrations.manage": ["owner"],
  "members.manage": ["owner"],
  "business.settings": ["owner"],
} as const satisfies Record<string, readonly MemberRole[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(role: MemberRole | null | undefined, capability: Capability): boolean {
  return role !== null && role !== undefined && (CAPABILITIES[capability] as readonly MemberRole[]).includes(role);
}
