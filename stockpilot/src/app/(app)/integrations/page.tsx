import { CheckCircle2, CircleAlert, CircleDashed, Plug } from "lucide-react";
import { ConnectButton, DisconnectButton, IntegrationSettings, MapProductButton, SyncButton } from "@/components/integrations/integration-controls";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { DataTable, PageHeader } from "@/components/ui/page";
import { requireRole } from "@/lib/auth/session";
import { ADAPTERS } from "@/lib/integrations";
import { PROVIDERS } from "@/lib/integrations/types";
import { formatDateTime, relativeTime } from "@/lib/utils";

export const metadata = { title: "Integrations" };

const DESCRIPTIONS = {
  square: "Pull Square catalog and in-stock counts; receive inventory.count.updated webhooks.",
  shopify: "Pull product variants and inventory; receive inventory_levels/update webhooks.",
  clover: "Pull items with stock; refresh counts when Clover notifies item changes.",
};

export default async function IntegrationsPage({ searchParams }: PageProps<"/integrations">) {
  const ctx = await requireRole("manager");
  const sp = await searchParams;
  const [{ data: integrations }, { data: logs }, { data: unmapped }] = await Promise.all([
    ctx.supabase.from("integrations").select("*").eq("business_id", ctx.business.id),
    ctx.supabase.from("integration_sync_logs").select("id, integration_id, direction, status, items_processed, conflicts, error, details, created_at").eq("business_id", ctx.business.id).order("created_at", { ascending: false }).limit(25),
    ctx.supabase.from("integration_product_mappings").select("id, integration_id, external_name, external_sku").eq("business_id", ctx.business.id).is("product_id", null).limit(50),
  ]);
  const owner = ctx.role === "owner";

  return (
    <>
      <PageHeader title="Integrations" description="Keep StockPilot and your point of sale in step. Newer counts are never overwritten by older ones." />
      {typeof sp.connected === "string" && <Alert tone="success" className="mb-4">Connected. The first sync is running in the background.</Alert>}
      {typeof sp.error === "string" && <Alert tone="critical" className="mb-4">{sp.error.slice(0, 200)}</Alert>}
      <Alert tone="info" className="mb-6" title="Beta connectors">These connectors follow each provider&apos;s published API and haven&apos;t yet been tested against live merchant accounts. Try them with your provider&apos;s sandbox first.</Alert>

      <div className="grid gap-4 lg:grid-cols-3">
        {PROVIDERS.map((provider) => {
          const adapter = ADAPTERS[provider];
          const row = (integrations ?? []).find((i) => i.provider === provider);
          const connected = row?.status === "connected" || row?.status === "error";
          const configured = adapter.configured();
          return (
            <Card key={provider} className="flex flex-col">
              <CardBody className="flex flex-1 flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{adapter.label}</p>
                    <p className="mt-1 text-sm text-muted">{DESCRIPTIONS[provider]}</p>
                  </div>
                  {row?.status === "connected" ? <Badge tone="success"><CheckCircle2 /> Connected</Badge>
                    : row?.status === "error" ? <Badge tone="critical"><CircleAlert /> Error</Badge>
                    : configured ? <Badge tone="neutral"><CircleDashed /> Not connected</Badge>
                    : <Badge tone="neutral">Not configured</Badge>}
                </div>
                {row?.last_error && <Alert tone="critical">{row.last_error}</Alert>}
                {connected && (
                  <p className="text-xs text-muted">
                    {row.shop_domain ?? row.external_account_id} · last synced {row.last_synced_at ? relativeTime(row.last_synced_at) : "never"}
                  </p>
                )}
                {!configured && !connected && <p className="text-xs text-muted">The server admin needs to add {provider.toUpperCase()} app credentials (see setup guide) before this can be connected.</p>}
                <div className="mt-auto flex flex-wrap gap-2">
                  {connected ? (
                    <>
                      <SyncButton provider={provider} />
                      {owner && <DisconnectButton provider={provider} label={adapter.label} />}
                    </>
                  ) : (
                    owner && configured && <ConnectButton provider={provider} label={adapter.label} needsShop={provider === "shopify"} />
                  )}
                </div>
                {connected && owner && <div className="border-t border-border pt-4"><IntegrationSettings id={row.id} policy={row.conflict_policy} enabled={row.sync_enabled} /></div>}
              </CardBody>
            </Card>
          );
        })}
      </div>

      {(unmapped ?? []).length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Unmapped POS items" description="These weren't matched by SKU or barcode. Map them so their stock syncs." />
          <DataTable>
            <thead><tr><th>POS item</th><th>SKU</th><th>Provider</th><th /></tr></thead>
            <tbody>
              {unmapped!.map((m) => (
                <tr key={m.id}>
                  <td className="font-medium">{m.external_name}</td>
                  <td className="text-muted">{m.external_sku ?? "—"}</td>
                  <td className="capitalize text-muted">{(integrations ?? []).find((i) => i.id === m.integration_id)?.provider}</td>
                  <td className="text-right"><MapProductButton mappingId={m.id} externalName={m.external_name ?? "item"} /></td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader title="Sync history" />
        {(logs ?? []).length === 0 ? (
          <CardBody><p className="text-sm text-muted">No syncs yet.</p></CardBody>
        ) : (
          <DataTable>
            <thead><tr><th>When</th><th>Provider</th><th>Type</th><th>Status</th><th className="text-right">Items</th><th className="text-right">Conflicts</th><th>Details</th></tr></thead>
            <tbody>
              {logs!.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap text-muted">{formatDateTime(l.created_at, ctx.business.timezone)}</td>
                  <td className="capitalize">{(integrations ?? []).find((i) => i.id === l.integration_id)?.provider}</td>
                  <td className="capitalize">{l.direction}</td>
                  <td><Badge tone={l.status === "success" ? "success" : l.status === "failed" ? "critical" : l.status === "running" ? "primary" : "warning"}>{l.status}</Badge></td>
                  <td className="tabular text-right">{l.items_processed}</td>
                  <td className="tabular text-right">{l.conflicts}</td>
                  <td className="max-w-80 truncate text-xs text-muted">{l.error ?? (l.details as { reason?: string; product?: string })?.reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>
      {!(integrations ?? []).length && <p className="mt-6 flex items-center gap-2 text-sm text-muted"><Plug className="size-4" /> Without a POS, record sales by voice or from the product page.</p>}
    </>
  );
}
