import {
  ArrowLeftRight, BarChart3, CalendarClock, Camera, ClipboardList, LayoutDashboard, Mic, Package, Plug, Settings, Sparkles, Truck,
} from "lucide-react";
import type { MemberRole } from "@/lib/domain/types";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  minRole: MemberRole;
  group: "audit" | "stock" | "buy" | "insight" | "admin";
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, minRole: "employee", group: "audit" },
  { href: "/voice", label: "Voice Audit", icon: Mic, minRole: "employee", group: "audit" },
  { href: "/photo", label: "Photo Audit", icon: Camera, minRole: "employee", group: "audit" },
  { href: "/review", label: "AI Review", icon: Sparkles, minRole: "employee", group: "audit" },
  { href: "/inventory", label: "Inventory", icon: Package, minRole: "employee", group: "stock" },
  { href: "/expiring", label: "Expiring Stock", icon: CalendarClock, minRole: "employee", group: "stock" },
  { href: "/movements", label: "Stock Movements", icon: ArrowLeftRight, minRole: "employee", group: "stock" },
  { href: "/suppliers", label: "Suppliers", icon: Truck, minRole: "manager", group: "buy" },
  { href: "/purchase-orders", label: "Purchase Orders", icon: ClipboardList, minRole: "manager", group: "buy" },
  { href: "/reports", label: "Reports", icon: BarChart3, minRole: "manager", group: "insight" },
  { href: "/integrations", label: "Integrations", icon: Plug, minRole: "manager", group: "admin" },
  { href: "/settings", label: "Settings", icon: Settings, minRole: "employee", group: "admin" },
];

export const GROUP_LABELS: Record<NavItem["group"], string> = {
  audit: "Audit",
  stock: "Stock",
  buy: "Purchasing",
  insight: "Insights",
  admin: "Manage",
};

const RANK: Record<MemberRole, number> = { employee: 1, manager: 2, owner: 3 };
export function navFor(role: MemberRole): NavItem[] {
  return NAV_ITEMS.filter((i) => RANK[role] >= RANK[i.minRole]);
}
