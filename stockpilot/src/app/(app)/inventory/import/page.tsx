import { ImportWizard } from "@/components/inventory/import-wizard";
import { PageHeader } from "@/components/ui/page";
import { requireRole } from "@/lib/auth/session";

export const metadata = { title: "Import products" };

export default async function ImportPage() {
  await requireRole("manager");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Import products" description="Upload a CSV exported from a spreadsheet or another system." back={{ href: "/inventory", label: "Inventory" }} />
      <ImportWizard />
    </div>
  );
}
