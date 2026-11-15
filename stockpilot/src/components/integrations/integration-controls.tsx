"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Link2, RefreshCw, Unplug } from "lucide-react";
import { mapExternalProduct, updateIntegrationSettings } from "@/app/(app)/integrations/actions";
import { ProductSearch } from "@/components/review/product-picker";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

export function ConnectButton({ provider, label, needsShop }: { provider: string; label: string; needsShop: boolean }) {
  const [shop, setShop] = useState("");
  if (!needsShop) return <Button asChild><a href={`/api/integrations/${provider}/connect`}><Link2 /> Connect {label}</a></Button>;
  return (
    <Dialog>
      <DialogTrigger asChild><Button><Link2 /> Connect {label}</Button></DialogTrigger>
      <DialogContent title="Connect Shopify" description="Enter your store's myshopify.com address.">
        <form action={`/api/integrations/${provider}/connect`} method="get" className="flex gap-2">
          <Input name="shop" value={shop} onChange={(e) => setShop(e.target.value.trim().toLowerCase())} placeholder="your-store.myshopify.com" pattern="[a-z0-9][a-z0-9\-]*\.myshopify\.com" required aria-label="Shop domain" />
          <Button type="submit">Continue</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SyncButton({ provider }: { provider: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <Button variant="outline" loading={pending} onClick={() => start(async () => {
      const res = await fetch(`/api/integrations/${provider}/sync`, { method: "POST" });
      const body = (await res.json()) as { summary?: { itemsSeen: number; applied: number; conflicts: number; unmapped: number }; error?: { message: string } };
      if (!res.ok || !body.summary) toast({ tone: "error", title: "Sync failed", description: body.error?.message });
      else toast({ tone: "success", title: "Sync complete", description: `${body.summary.itemsSeen} items · ${body.summary.applied} updated · ${body.summary.conflicts} conflicts · ${body.summary.unmapped} unmapped` });
      router.refresh();
    })}>
      <RefreshCw /> Sync now
    </Button>
  );
}

export function DisconnectButton({ provider, label }: { provider: string; label: string }) {
  const toast = useToast();
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={<Button variant="ghost" className="text-critical"><Unplug /> Disconnect</Button>}
      title={`Disconnect ${label}?`}
      description="Stored access tokens are deleted. Stock history is kept."
      confirmLabel="Disconnect"
      tone="destructive"
      onConfirm={async () => {
        const res = await fetch(`/api/integrations/${provider}/disconnect`, { method: "POST" });
        toast(res.ok ? { tone: "success", title: `${label} disconnected` } : { tone: "error", title: "Couldn't disconnect" });
        router.refresh();
      }}
    />
  );
}

export function IntegrationSettings({ id, policy, enabled }: { id: string; policy: string; enabled: boolean }) {
  const [p, setP] = useState(policy);
  const [e, setE] = useState(enabled);
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">When counts disagree</span>
        <Select value={p} onChange={(ev) => setP(ev.target.value)} className="w-64">
          <option value="newest_wins">Newest count wins (recommended)</option>
          <option value="pos">POS always wins</option>
          <option value="stockpilot">StockPilot always wins</option>
        </Select>
      </label>
      <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={e} onChange={(ev) => setE(ev.target.checked)} className="size-4 accent-[var(--primary)]" /> Sync enabled</label>
      {(p !== policy || e !== enabled) && (
        <Button size="sm" loading={pending} onClick={() => start(async () => {
          const r = await updateIntegrationSettings(id, p, e);
          toast(r.ok ? { tone: "success", title: "Saved" } : { tone: "error", title: r.error });
        })}>Save</Button>
      )}
    </div>
  );
}

export function MapProductButton({ mappingId, externalName }: { mappingId: string; externalName: string }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Map</Button></DialogTrigger>
      <DialogContent title="Map POS item" description={`Which StockPilot product is “${externalName}”?`}>
        <ProductSearch autoFocus onPick={async (p) => {
          const r = await mapExternalProduct(mappingId, p.id);
          setOpen(false);
          toast(r.ok ? { tone: "success", title: "Mapped" } : { tone: "error", title: r.error });
          router.refresh();
        }} />
      </DialogContent>
    </Dialog>
  );
}
