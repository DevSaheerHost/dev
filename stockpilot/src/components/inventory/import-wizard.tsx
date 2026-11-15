"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { CheckCircle2, FileUp } from "lucide-react";
import { importProducts, type ImportSummary } from "@/app/(app)/inventory/actions";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { DataTable } from "@/components/ui/page";
import { parseProductImport, type ImportPreview } from "@/lib/domain/csv";
import { formatNumber } from "@/lib/utils";

const TEMPLATE = "name,sku,barcode,brand,category,unit,quantity,cost_price,selling_price,reorder_threshold,storage_location,batch_number,expiry_date\nAA Alkaline Batteries 4-pack,DUR-AA4,041333424019,Duracell,Batteries,pack,24,3.20,5.99,10,Aisle 2,,\n";

export function ImportWizard() {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function onFile(file: File | undefined) {
    setError(null);
    setResult(null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setError("The file is too large (max 5 MB).");
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    setPreview(parseProductImport(text));
  }

  if (result) {
    return (
      <Card>
        <CardBody className="space-y-4">
          <Alert tone="success" title={`${result.created} products imported`}>
            {result.stockErrors > 0 && `${result.stockErrors} opening stock entries failed. `}
            {result.skipped.length > 0 && `${result.skipped.length} rows were skipped.`}
          </Alert>
          {result.skipped.length > 0 && (
            <ul className="max-h-64 space-y-1 overflow-y-auto text-sm text-muted">
              {result.skipped.map((s) => <li key={`${s.line}-${s.message}`}>Line {s.line}: {s.message}</li>)}
            </ul>
          )}
          <Button asChild><Link href="/inventory"><CheckCircle2 /> View inventory</Link></Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border-strong px-6 py-10 text-center hover:bg-surface-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
            <FileUp className="size-8 text-primary" />
            <span className="font-medium">{fileName || "Choose a CSV file"}</span>
            <span className="text-xs text-muted">Columns: name (required), sku, barcode, brand, category, unit, quantity, cost_price, selling_price, reorder_threshold, storage_location, batch_number, expiry_date (YYYY-MM-DD)</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          <a className="text-sm font-medium text-primary hover:underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="stockpilot-template.csv">Download a template</a>
          {error && <Alert tone="critical">{error}</Alert>}
        </CardBody>
      </Card>

      {preview && (
        <Card>
          <CardHeader title="Preview" description={`${preview.valid.length} rows ready · ${preview.errors.length} with problems`} />
          {preview.errors.length > 0 && (
            <CardBody className="border-b border-border">
              <Alert tone="warning" title="These rows will be skipped">
                <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">{preview.errors.slice(0, 50).map((e) => <li key={e.line}>Line {e.line}: {e.message}</li>)}</ul>
              </Alert>
            </CardBody>
          )}
          {preview.valid.length > 0 && (
            <DataTable className="max-h-80 overflow-y-auto">
              <thead><tr><th>Name</th><th>SKU</th><th>Unit</th><th className="text-right">Qty</th><th>Category</th><th>Expiry</th></tr></thead>
              <tbody>
                {preview.valid.slice(0, 100).map(({ line, row }) => (
                  <tr key={line}>
                    <td className="font-medium">{row.name}</td><td>{row.sku ?? "—"}</td><td>{row.unit}</td>
                    <td className="tabular text-right">{formatNumber(row.quantity ?? 0)}</td><td>{row.category ?? "—"}</td><td>{row.expiry_date ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
          <CardBody className="flex justify-end border-t border-border">
            <Button
              disabled={!csv || preview.valid.length === 0}
              loading={pending}
              onClick={() =>
                start(async () => {
                  const r = await importProducts(csv!);
                  if (r.ok && r.data) setResult(r.data);
                  else if (!r.ok) setError(r.error);
                })
              }
            >
              Import {preview.valid.length} products
            </Button>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
