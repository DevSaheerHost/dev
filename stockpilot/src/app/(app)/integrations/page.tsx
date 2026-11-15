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
import { biz } from "@/lib/data/refs";

export const metadata = { title: "Integrations" };

const DESCRIPTIONS = {
  square: "Pull Square catalog and in-stock counts; receive inventory.count.updated webhooks.",
  shopify: "Pull product variants and inventory; receive inventory_levels/update webhooks.",
  clover: "Pull items with stock; refresh counts when Clover notifies item changes.",
};

export default async function IntegrationsPage({ searchParams }: PageProps<"/integrations">) {
  const ctx = await requireRole("manager");
  const sp = await searchParams;
  const ref = biz(ctx.business.id);
  const [integrationSnap, logSnap, unmappedSnaps] = await Promise.all([
    ref.integrations.get(),
    ref.syncLogs.orderBy("createdAt", "desc").limit(25).get(),
    Promise.all(PROVIDERS.map((p) => ref.mappings(p).where("productId", "==", null).limit(50).get().then((s) => s.docs.map((d) => ({ id: d.id, provider: p, ...d.data() }))))),
  ]);
  const integrations = integrationSnap.docs.map((d) => d.data());
  const logs = logSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const unmapped = unmappedSnaps.flat().slice(0, 50);
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
          const row = integrations.find((i) => i.provider === provider);
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
                {row?.lastError && <Alert tone="critical">{row.lastError}</Alert>}
                {connected && (
                  <p className="text-xs text-muted">
                    {row.shopDomain ?? row.externalAccountId} · last synced {row.lastSyncedAt ? relativeTime(row.lastSyncedAt) : "never"}
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
                {connected && owner && <div className="border-t border-border pt-4"><IntegrationSettings provider={provider} policy={row.conflictPolicy} enabled={row.syncEnabled} /></div>}
              </CardBody>
            </Card>
          );
        })}
      </div>

      {unmapped.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Unmapped POS items" description="These weren't matched by SKU or barcode. Map them so their stock syncs." />
          <DataTable>
            <thead><tr><th>POS item</th><th>SKU</th><th>Provider</th><th /></tr></thead>
            <tbody>
              {unmapped.map((m) => (
                <tr key={m.id}>
                  <td className="font-medium">{m.externalName}</td>
                  <td className="text-muted">{m.externalSku ?? "—"}</td>
                  <td className="capitalize text-muted">{m.provider}</td>
                  <td className="text-right"><MapProductButton provider={m.provider} mappingId={m.id} externalName={m.externalName ?? "item"} /></td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader title="Sync history" />
        {logs.length === 0 ? (
          <CardBody><p className="text-sm text-muted">No syncs yet.</p></CardBody>
        ) : (
          <DataTable>
            <thead><tr><th>When</th><th>Provider</th><th>Type</th><th>Status</th><th className="text-right">Items</th><th className="text-right">Conflicts</th><th>Details</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap text-muted">{formatDateTime(l.createdAt, ctx.business.timezone)}</td>
                  <td className="capitalize">{l.provider}</td>
                  <td className="capitalize">{l.direction}</td>
                  <td><Badge tone={l.status === "success" ? "success" : l.status === "failed" ? "critical" : l.status === "running" ? "primary" : "warning"}>{l.status}</Badge></td>
                  <td className="tabular text-right">{l.itemsProcessed}</td>
                  <td className="tabular text-right">{l.conflicts}</td>
                  <td className="max-w-80 truncate text-xs text-muted">{l.error ?? (l.details as { reason?: string; product?: string })?.reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>
      {!integrations.length && <p className="mt-6 flex items-center gap-2 text-sm text-muted"><Plug className="size-4" /> Without a POS, record sales by voice or from the product page.</p>}
    </>
  );
}
