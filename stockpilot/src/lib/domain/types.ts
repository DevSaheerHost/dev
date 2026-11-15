export const MEMBER_ROLES = ["owner", "manager", "employee"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MOVEMENT_TYPES = [
  "initial",
  "receive",
  "sale",
  "return",
  "set_count",
  "damage",
  "expire",
  "missing",
  "correction",
  "transfer",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_SOURCES = ["manual", "voice", "photo", "pos", "purchase", "import", "system"] as const;
export type MovementSource = (typeof MOVEMENT_SOURCES)[number];

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  initial: "Opening stock",
  receive: "Received",
  sale: "Sold",
  return: "Returned",
  set_count: "Counted",
  damage: "Damaged",
  expire: "Expired",
  missing: "Missing",
  correction: "Correction",
  transfer: "Transfer",
};

export const PO_STATUSES = ["draft", "approved", "sent", "partially_received", "received", "cancelled"] as const;
export type PurchaseOrderStatus = (typeof PO_STATUSES)[number];
