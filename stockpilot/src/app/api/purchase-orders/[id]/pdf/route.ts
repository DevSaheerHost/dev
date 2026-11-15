import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { ApiError, authedRoute } from "@/lib/api/handler";
import { loadPurchaseOrder } from "@/lib/services/purchase-order";
import { formatMoney, formatNumber } from "@/lib/utils";

/** WinAnsi-safe text for the standard PDF fonts. */
const t = (s: string | null | undefined, max = 90) => (s ?? "").replace(/[^\x20-\x7E -ÿ]/g, "?").slice(0, max);

export const GET = authedRoute<{ id: string }>({ minRole: "manager", rateLimit: { name: "pdf", limit: 60, windowSeconds: 600 } }, async (_req, ctx, { id }) => {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new ApiError(404, "not_found", "Not found.");
  const po = await loadPurchaseOrder(ctx, id);
  if (!po) throw new ApiError(404, "not_found", "Purchase order not found.");

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${po.po_number} - ${t(po.suppliers.name)}`);
  pdf.setProducer("StockPilot AI");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const indigo = rgb(0.23, 0.21, 0.65);
  const gray = rgb(0.35, 0.38, 0.45);
  let page = pdf.addPage([595, 842]);
  let y = 790;
  const text = (s: string, x: number, size = 10, f = font, color = rgb(0.06, 0.09, 0.16)) => page.drawText(s, { x, y, size, font: f, color });
  const right = (s: string, x: number, size = 10, f = font) => page.drawText(s, { x: x - f.widthOfTextAtSize(s, size), y, size, font: f });

  text("PURCHASE ORDER", 50, 18, bold, indigo);
  right(po.po_number, 545, 14, bold);
  y -= 22;
  text(t(ctx.business.name), 50, 11, bold);
  right(`Date: ${po.created_at.slice(0, 10)}`, 545, 10);
  y -= 16;
  if (po.expected_date) right(`Deliver by: ${po.expected_date}`, 545, 10);
  y -= 28;
  text("Supplier", 50, 9, bold, gray);
  y -= 14;
  for (const line of [po.suppliers.name, po.suppliers.contact_person, po.suppliers.address, po.suppliers.email, po.suppliers.phone, po.suppliers.payment_terms && `Terms: ${po.suppliers.payment_terms}`].filter(Boolean)) {
    text(t(line as string), 50);
    y -= 14;
  }
  y -= 16;
  const header = () => {
    page.drawRectangle({ x: 45, y: y - 6, width: 505, height: 22, color: rgb(0.94, 0.94, 1) });
    text("Product", 52, 9, bold); right("Qty", 360, 9, bold); text("Unit", 368, 9, bold); right("Unit cost", 470, 9, bold); right("Total", 545, 9, bold);
    y -= 24;
  };
  header();
  for (const l of po.purchase_order_items) {
    if (y < 90) {
      page = pdf.addPage([595, 842]);
      y = 790;
      header();
    }
    text(t(l.products.name, 52), 52);
    right(formatNumber(Number(l.quantity)), 360);
    text(t(l.products.unit, 12), 368);
    right(t(formatMoney(Number(l.unit_cost), ctx.business.currency)), 470);
    right(t(formatMoney(Number(l.line_total), ctx.business.currency)), 545);
    y -= 18;
  }
  y -= 6;
  page.drawLine({ start: { x: 360, y: y + 10 }, end: { x: 550, y: y + 10 }, thickness: 0.5, color: gray });
  y -= 8;
  text("Estimated total", 380, 10, bold);
  right(t(formatMoney(Number(po.subtotal), ctx.business.currency)), 545, 10, bold);
  if (po.notes) {
    y -= 34;
    text("Notes", 50, 9, bold, gray);
    y -= 14;
    for (const chunk of t(po.notes, 1500).match(/.{1,95}(\s|$)/g) ?? []) {
      text(chunk.trim(), 50);
      y -= 13;
      if (y < 60) break;
    }
  }
  page.drawText("Please confirm availability and expected delivery date.", { x: 50, y: 50, size: 9, font, color: gray });

  const bytes = await pdf.save();
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${po.po_number}.pdf"`,
      "cache-control": "no-store",
    },
  });
});
