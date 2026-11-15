import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAdapter } from "./index";
import { decideReconciliation, type ConflictPolicy } from "./reconcile";
import { IntegrationError, type Credentials, type ExternalItem, type PosAdapter, type Provider } from "./types";

interface IntegrationRow {
  id: string; business_id: string; provider: Provider; status: string; external_account_id: string | null;
  shop_domain: string | null; conflict_policy: ConflictPolicy; sync_enabled: boolean;
}

export interface SyncSummary {
  itemsSeen: number;
  newlyMapped: number;
  applied: number;
  conflicts: number;
  unmapped: number;
  errors: number;
}

export async function saveCredentials(admin: SupabaseClient, integrationId: string, businessId: string, c: Credentials) {
  const { error } = await admin.from("integration_credentials").upsert({
    integration_id: integrationId,
    business_id: businessId,
    access_token_encrypted: encryptSecret(c.accessToken),
    refresh_token_encrypted: c.refreshToken ? encryptSecret(c.refreshToken) : null,
    token_expires_at: c.expiresAt ?? null,
    scopes: c.scopes ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new IntegrationError("Couldn't store integration credentials.");
}

async function loadCredentials(admin: SupabaseClient, integration: IntegrationRow, adapter: PosAdapter): Promise<Credentials> {
  const { data } = await admin.from("integration_credentials").select("*").eq("integration_id", integration.id).maybeSingle();
  if (!data) throw new IntegrationError(`${adapter.label} isn't connected.`);
  let creds: Credentials = {
    accessToken: decryptSecret(data.access_token_encrypted),
    refreshToken: data.refresh_token_encrypted ? decryptSecret(data.refresh_token_encrypted) : null,
    expiresAt: data.token_expires_at,
    accountId: integration.external_account_id ?? "",
    shopDomain: integration.shop_domain,
  };
  // Refresh tokens that expire within a day.
  if (adapter.refresh && creds.expiresAt && Date.parse(creds.expiresAt) - Date.now() < 86_400_000) {
    creds = await adapter.refresh(creds);
    await saveCredentials(admin, integration.id, integration.business_id, creds);
  }
  return creds;
}

async function applyCount(
  admin: SupabaseClient,
  integration: IntegrationRow,
  productId: string,
  externalId: string,
  quantity: number | null,
  countedAt: string | null,
  ref: string,
): Promise<"applied" | "conflict" | "skipped"> {
  const { data: product } = await admin
    .from("products")
    .select("current_quantity, last_movement_at, name")
    .eq("id", productId)
    .eq("business_id", integration.business_id)
    .maybeSingle();
  if (!product) return "skipped";
  const decision = decideReconciliation({
    policy: integration.conflict_policy,
    localQuantity: Number(product.current_quantity),
    externalQuantity: quantity,
    lastLocalChangeAt: product.last_movement_at,
    externalCountedAt: countedAt,
  });
  if (decision.action === "skip") return "skipped";
  if (decision.action === "conflict") {
    await admin.from("integration_sync_logs").insert({
      business_id: integration.business_id, integration_id: integration.id, direction: "webhook", status: "conflict", items_processed: 1, conflicts: 1,
      details: { product: product.name, local: Number(product.current_quantity), pos: quantity, pos_counted_at: countedAt, reason: decision.reason },
      finished_at: new Date().toISOString(),
    });
    return "conflict";
  }
  const { error } = await admin.rpc("apply_stock_movement_system", {
    p_business_id: integration.business_id,
    p_product_id: productId,
    p_type: "set_count",
    p_quantity: quantity,
    p_idempotency_key: `${integration.provider}:count:${externalId}:${countedAt ?? ref}`.slice(0, 200),
    p_source: "pos",
    p_reason: `${integration.provider} stock sync`,
    p_observed_at: countedAt,
    p_external_ref: ref.slice(0, 200),
  });
  if (error) {
    // The database's stale-observation guard is the final word.
    if (error.message.startsWith("stale_observation")) return "conflict";
    throw new IntegrationError(`Couldn't apply POS count: ${error.message.split(":")[0]}`);
  }
  const patch = { last_external_quantity: quantity, last_external_updated_at: countedAt };
  await admin.from("integration_product_mappings").update(patch).eq("integration_id", integration.id).eq("external_variant_id", externalId);
  await admin.from("integration_product_mappings").update(patch).eq("integration_id", integration.id).eq("external_item_id", externalId);
  return "applied";
}

/** Pull the POS catalog, map SKUs/barcodes to products, and reconcile counts. */
export async function runPullSync(integrationId: string, triggeredBy: string | null, attempt = 1): Promise<SyncSummary> {
  const admin = createSupabaseAdminClient();
  const { data: integration } = await admin.from("integrations").select("*").eq("id", integrationId).maybeSingle<IntegrationRow>();
  if (!integration) throw new IntegrationError("Integration not found.");
  const adapter = getAdapter(integration.provider)!;
  const { data: log } = await admin
    .from("integration_sync_logs")
    .insert({ business_id: integration.business_id, integration_id: integration.id, direction: "pull", status: "running", attempt, triggered_by: triggeredBy })
    .select("id")
    .single();
  const summary: SyncSummary = { itemsSeen: 0, newlyMapped: 0, applied: 0, conflicts: 0, unmapped: 0, errors: 0 };

  try {
    const creds = await loadCredentials(admin, integration, adapter);
    const items = await adapter.listCatalog(creds);
    summary.itemsSeen = items.length;

    const [{ data: products }, { data: mappings }] = await Promise.all([
      admin.from("products").select("id, sku, barcode").eq("business_id", integration.business_id).is("archived_at", null),
      admin.from("integration_product_mappings").select("external_variant_id, product_id").eq("integration_id", integration.id),
    ]);
    const bySku = new Map((products ?? []).filter((p) => p.sku).map((p) => [String(p.sku).toLowerCase(), p.id as string]));
    const byBarcode = new Map((products ?? []).filter((p) => p.barcode).map((p) => [String(p.barcode), p.id as string]));
    const mapped = new Map((mappings ?? []).map((m) => [m.external_variant_id as string, m.product_id as string | null]));

    const toUpsert = items.map((it: ExternalItem) => {
      const existing = mapped.get(it.variantId);
      const productId = existing ?? (it.sku && bySku.get(it.sku.toLowerCase())) ?? (it.barcode && byBarcode.get(it.barcode)) ?? null;
      if (!existing && productId) summary.newlyMapped++;
      mapped.set(it.variantId, productId);
      return {
        business_id: integration.business_id, integration_id: integration.id, product_id: productId, external_item_id: it.itemId,
        external_variant_id: it.variantId, external_sku: it.sku, external_name: it.name.slice(0, 300),
      };
    });
    for (let i = 0; i < toUpsert.length; i += 500) {
      const { error } = await admin.from("integration_product_mappings").upsert(toUpsert.slice(i, i + 500), { onConflict: "integration_id,external_variant_id", ignoreDuplicates: false });
      if (error) throw new IntegrationError("Couldn't save product mappings.");
    }

    for (const it of items) {
      const productId = mapped.get(it.variantId);
      if (!productId) {
        summary.unmapped++;
        continue;
      }
      try {
        const r = await applyCount(admin, integration, productId, it.variantId, it.quantity, it.countedAt, `${integration.provider}:pull:${log?.id ?? ""}`);
        if (r === "applied") summary.applied++;
        if (r === "conflict") summary.conflicts++;
      } catch {
        summary.errors++;
      }
    }

    await admin.from("integration_sync_logs").update({
      status: summary.errors ? "partial" : summary.conflicts ? "conflict" : "success", items_processed: summary.itemsSeen, conflicts: summary.conflicts,
      details: summary, finished_at: new Date().toISOString(),
    }).eq("id", log?.id);
    await admin.from("integrations").update({ last_synced_at: new Date().toISOString(), status: "connected", last_error: null }).eq("id", integration.id);
    return summary;
  } catch (e) {
    const message = e instanceof IntegrationError ? e.message : "Unexpected sync failure.";
    const retryable = e instanceof IntegrationError ? e.retryable : true;
    await admin.from("integration_sync_logs").update({
      status: "failed", error: message, finished_at: new Date().toISOString(),
      next_retry_at: retryable && attempt < 5 ? new Date(Date.now() + 2 ** attempt * 60_000).toISOString() : null,
    }).eq("id", log?.id);
    await admin.from("integrations").update({ status: "error", last_error: message }).eq("id", integration.id);
    await notifyManagers(admin, integration.business_id, `${adapter.label} sync failed`, message, `sync_failed:${integration.id}:${new Date().toISOString().slice(0, 10)}`);
    throw e;
  }
}

async function notifyManagers(admin: SupabaseClient, businessId: string, title: string, body: string, dedupeKey: string) {
  const { data: managers } = await admin.from("business_members").select("user_id").eq("business_id", businessId).eq("status", "active").in("role", ["owner", "manager"]);
  for (const m of managers ?? []) {
    await admin.from("notifications").insert({ business_id: businessId, user_id: m.user_id, type: "sync_failed", severity: "warning", title, body: body.slice(0, 1000), link: "/integrations", dedupe_key: dedupeKey });
  }
}

/**
 * Process a verified webhook exactly once. Returns false when the event was
 * already seen (duplicate delivery).
 */
export async function processWebhook(provider: Provider, body: unknown, headers: Headers): Promise<{ duplicate: boolean; status: string }> {
  const admin = createSupabaseAdminClient();
  const adapter = getAdapter(provider)!;
  const event = adapter.parseWebhook(body, headers);

  const { data: integration } = event.accountId
    ? await admin.from("integrations").select("*").eq("provider", provider).eq("external_account_id", event.accountId).eq("status", "connected").maybeSingle<IntegrationRow>()
    : { data: null };

  let { data: recorded, error: dupError } = await admin
    .from("webhook_events")
    .insert({ provider, event_id: event.eventId, event_type: event.type.slice(0, 120), business_id: integration?.business_id ?? null, integration_id: integration?.id ?? null })
    .select("id")
    .single();
  if (dupError?.code === "23505") {
    // Already seen. Only a previously FAILED event may be retried; movement
    // idempotency keys still prevent any double application.
    const { data: previous } = await admin.from("webhook_events").select("id, status").eq("provider", provider).eq("event_id", event.eventId).single();
    if (!previous || previous.status !== "failed") return { duplicate: true, status: "duplicate" };
    await admin.from("webhook_events").update({ status: "received", error: null }).eq("id", previous.id);
    recorded = { id: previous.id };
    dupError = null;
  }
  if (dupError || !recorded) throw new IntegrationError("Couldn't record webhook.", true);

  const eventRowId = recorded.id;
  const finish = (status: "processed" | "ignored" | "failed", error?: string) =>
    admin.from("webhook_events").update({ status, error: error?.slice(0, 2000) ?? null, processed_at: new Date().toISOString() }).eq("id", eventRowId);

  if (!integration || !integration.sync_enabled) {
    await finish("ignored", integration ? "Sync disabled" : "No connected integration for this account");
    return { duplicate: false, status: "ignored" };
  }

  try {
    let changes = event.changes;
    if (event.needsLookup?.length && adapter.lookupQuantities) {
      const creds = await loadCredentials(admin, integration, adapter);
      changes = (await adapter.lookupQuantities(creds, event.needsLookup)).map((c) => ({ ...c, matchOn: "variant" as const }));
    }
    let applied = 0;
    let conflicts = 0;
    for (const c of changes) {
      const column = c.matchOn === "variant" ? "external_variant_id" : "external_item_id";
      const { data: mapping } = await admin.from("integration_product_mappings").select("product_id").eq("integration_id", integration.id).eq(column, c.externalId).not("product_id", "is", null).maybeSingle();
      if (!mapping?.product_id) continue;
      const r = await applyCount(admin, integration, mapping.product_id, c.externalId, c.quantity, c.occurredAt, `${provider}:event:${event.eventId}`);
      if (r === "applied") applied++;
      if (r === "conflict") conflicts++;
    }
    await finish("processed");
    await admin.from("integration_sync_logs").insert({
      business_id: integration.business_id, integration_id: integration.id, direction: "webhook", status: conflicts ? "conflict" : "success",
      items_processed: changes.length, conflicts, details: { event: event.type, applied }, finished_at: new Date().toISOString(),
    });
    return { duplicate: false, status: "processed" };
  } catch (e) {
    const message = e instanceof IntegrationError ? e.message : "Processing failed";
    await finish("failed", message);
    throw e;
  }
}
