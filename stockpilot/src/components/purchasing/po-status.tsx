import { Badge } from "@/components/ui/badge";

const TONE = { draft: "neutral", approved: "primary", sent: "primary", partially_received: "warning", received: "success", cancelled: "neutral" } as const;
const LABEL = { draft: "Draft · awaiting approval", approved: "Approved", sent: "Sent", partially_received: "Partly received", received: "Received", cancelled: "Cancelled" } as const;

export function PoStatusBadge({ status }: { status: keyof typeof TONE }) {
  return <Badge tone={TONE[status]}>{LABEL[status]}</Badge>;
}
