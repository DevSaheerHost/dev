/** Supplier-facing purchase order messages (email + WhatsApp). */
import { UNIT_LABELS, isStockUnit } from "./units";

export interface OrderMessageInput {
  businessName: string;
  poNumber: string;
  supplierName: string;
  contactPerson?: string | null;
  expectedDate?: string | null;
  notes?: string | null;
  lines: { productName: string; quantity: number; unit: string; supplierSku?: string | null }[];
}

/** Strip characters that could break out of a header or inject formatting. */
function clean(value: string, max = 200): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function unitLabel(unit: string, quantity: number): string {
  if (!isStockUnit(unit)) return clean(unit, 20);
  return quantity === 1 ? UNIT_LABELS[unit].singular : UNIT_LABELS[unit].plural;
}

export function buildOrderMessage(input: OrderMessageInput): { subject: string; body: string } {
  const greeting = input.contactPerson ? `Hello ${clean(input.contactPerson, 80)},` : "Hello,";
  const lines = input.lines.map((l) => {
    const sku = l.supplierSku ? ` (SKU ${clean(l.supplierSku, 40)})` : "";
    return `- ${clean(l.productName)}${sku}: ${l.quantity} ${unitLabel(l.unit, l.quantity)}`;
  });
  const body = [
    greeting,
    "",
    `We would like to order the following items (order ${clean(input.poNumber, 30)}):`,
    "",
    ...lines,
    "",
    input.expectedDate ? `We would appreciate delivery by ${clean(input.expectedDate, 20)}.` : null,
    input.notes ? `Notes: ${clean(input.notes, 500)}` : null,
    "Please confirm availability and expected delivery date.",
    "",
    "Thank you.",
    clean(input.businessName, 120),
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  return { subject: clean(`Stock Replenishment Request – ${input.poNumber} – ${input.businessName}`, 180), body };
}

export function whatsappLink(phone: string, text: string): string | null {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function mailtoLink(email: string, subject: string, body: string): string | null {
  if (!/^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(email)) return null;
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
