import { CircleAlert, CircleCheck, CircleX } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function StockBadge({ status }: { status: "ok" | "low_stock" | "out_of_stock" }) {
  if (status === "out_of_stock") return <Badge tone="critical"><CircleX /> Out of stock</Badge>;
  if (status === "low_stock") return <Badge tone="warning"><CircleAlert /> Low stock</Badge>;
  return <Badge tone="success"><CircleCheck /> In stock</Badge>;
}
