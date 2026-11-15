/** Report catalogue shared by the reports page and CSV export. */
type Format = "number" | "money" | "date" | "datetime" | "text" | "percent" | "bool";

export interface ReportDef {
  title: string;
  description: string;
  columns: { key: string; label: string; format: Format }[];
}

export const REPORTS = {
  daily_changes: {
    title: "Daily stock changes",
    description: "Units added and removed per product per day.",
    columns: [
      { key: "day", label: "Day", format: "date" }, { key: "product", label: "Product", format: "text" }, { key: "unit", label: "Unit", format: "text" },
      { key: "added", label: "Added", format: "number" }, { key: "removed", label: "Removed", format: "number" }, { key: "net", label: "Net", format: "number" },
      { key: "movements", label: "Movements", format: "number" },
    ],
  },
  weekly_summary: {
    title: "Weekly inventory summary",
    description: "Received, sold and lost units by week.",
    columns: [
      { key: "week", label: "Week of", format: "date" }, { key: "movements", label: "Movements", format: "number" }, { key: "products_touched", label: "Products", format: "number" },
      { key: "received", label: "Received", format: "number" }, { key: "sold", label: "Sold", format: "number" }, { key: "lost", label: "Lost", format: "number" },
      { key: "loss_value", label: "Loss value", format: "money" },
    ],
  },
  monthly_valuation: {
    title: "Monthly inventory valuation",
    description: "Units on hand at each month end (from the movement ledger) at current average cost.",
    columns: [{ key: "month", label: "Month", format: "date" }, { key: "units", label: "Units", format: "number" }, { key: "value", label: "Value", format: "money" }],
  },
  expired_loss: {
    title: "Expired stock loss",
    description: "Units written off as expired and their cost.",
    columns: [
      { key: "product", label: "Product", format: "text" }, { key: "sku", label: "SKU", format: "text" }, { key: "units", label: "Units", format: "number" },
      { key: "loss_value", label: "Loss", format: "money" }, { key: "incidents", label: "Times", format: "number" }, { key: "last_incident", label: "Last", format: "datetime" },
    ],
  },
  damaged_loss: {
    title: "Damaged stock loss",
    description: "Units written off as damaged and their cost.",
    columns: [
      { key: "product", label: "Product", format: "text" }, { key: "sku", label: "SKU", format: "text" }, { key: "units", label: "Units", format: "number" },
      { key: "loss_value", label: "Loss", format: "money" }, { key: "incidents", label: "Times", format: "number" }, { key: "last_incident", label: "Last", format: "datetime" },
    ],
  },
  shrinkage: {
    title: "Shrinkage",
    description: "Missing, damaged, expired and count shortfalls per product.",
    columns: [
      { key: "product", label: "Product", format: "text" }, { key: "missing", label: "Missing", format: "number" }, { key: "damaged", label: "Damaged", format: "number" },
      { key: "expired", label: "Expired", format: "number" }, { key: "count_shortfall", label: "Count shortfall", format: "number" }, { key: "loss_value", label: "Loss value", format: "money" },
    ],
  },
  stockout_frequency: {
    title: "Stockout frequency",
    description: "How often each product ran out.",
    columns: [
      { key: "product", label: "Product", format: "text" }, { key: "sku", label: "SKU", format: "text" }, { key: "stockouts", label: "Stockouts", format: "number" },
      { key: "last_stockout", label: "Last stockout", format: "datetime" }, { key: "current_quantity", label: "On hand now", format: "number" },
    ],
  },
  reorder_history: {
    title: "Reorder history",
    description: "Purchase orders created in the period.",
    columns: [
      { key: "po_number", label: "PO", format: "text" }, { key: "supplier", label: "Supplier", format: "text" }, { key: "status", label: "Status", format: "text" },
      { key: "lines", label: "Lines", format: "number" }, { key: "subtotal", label: "Total", format: "money" }, { key: "generated_by_ai", label: "Auto", format: "bool" },
      { key: "created_at", label: "Created", format: "datetime" }, { key: "sent_at", label: "Sent", format: "datetime" },
    ],
  },
  employee_activity: {
    title: "Employee audit activity",
    description: "Stock changes recorded per person and channel.",
    columns: [
      { key: "employee", label: "Person", format: "text" }, { key: "movements", label: "Changes", format: "number" }, { key: "voice", label: "Voice", format: "number" },
      { key: "photo", label: "Photo", format: "number" }, { key: "manual", label: "Manual", format: "number" }, { key: "counts", label: "Counts", format: "number" },
      { key: "last_activity", label: "Last activity", format: "datetime" },
    ],
  },
  ai_accuracy: {
    title: "AI accuracy",
    description: "How often AI suggestions were accepted unchanged, edited or rejected.",
    columns: [
      { key: "source", label: "Source", format: "text" }, { key: "proposals", label: "Suggestions", format: "number" }, { key: "accepted_as_is", label: "Accepted", format: "number" },
      { key: "accepted_after_edit", label: "Edited", format: "number" }, { key: "rejected", label: "Rejected", format: "number" }, { key: "open", label: "Open", format: "number" },
      { key: "accuracy_percent", label: "Accuracy", format: "percent" }, { key: "avg_confidence", label: "Avg confidence", format: "number" },
    ],
  },
} satisfies Record<string, ReportDef>;

export type ReportKey = keyof typeof REPORTS;
