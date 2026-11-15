import "server-only";
import { toCsv } from "@/lib/domain/csv";

export function csvResponse(filename: string, rows: Record<string, unknown>[], columns?: string[]): Response {
  const safeName = filename.replace(/[^A-Za-z0-9_.-]/g, "_");
  return new Response(`﻿${toCsv(rows, columns)}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${safeName}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
