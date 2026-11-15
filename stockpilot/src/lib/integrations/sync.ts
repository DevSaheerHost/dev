import "server-only";
import { hashId } from "@/lib/firebase/ids";
import { db } from "@/lib/firebase/admin";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import type { IntegrationDoc } from "@/lib/data/model";
import { notify } from "@/lib/data/notify";
import { biz, integrationAccounts, integrationSecrets, nowIso, webhookEvents } from "@/lib/data/refs";
import { afterMovement, applyMovement } from "@/lib/data/stock";
import { AppError } from "@/lib/errors";
import { getAdapter } from "./index";
import { decideReconciliation } from "./reconcile";
import { IntegrationError, type Credentials, type ExternalItem, type PosAdapter, type Provider } from "./types";

export interface SyncSummary {
  itemsSeen: number;
  newlyMapped: number;
  applied: number;
  conflicts: number;
  unmapped: number;
  errors: number;
}

const secretId = (businessId: string, provider: string) => `${businessId}_${provider}`;
const accountId = (provider: string, account: string) => hashId(provider, account);

export async function saveConnection(businessId: string, provider: Provider, userId: string, c: Credentials) {
  const now = nowIso();
  const ref = biz(businessId).integrations.doc(provider);
  const previous = (await ref.get()).data();
  const batch = db().batch();
  batch.set(ref, {
    provider, status: "connected", externalAccountId: c.accountId, shopDomain: c.shopDomain ?? null,
    conflictPolicy: previous?.conflictPolicy ?? "newest_wins", syncEnabled: previous?.syncEnabled ?? true,
    lastSyncedAt: previous?.lastSyncedAt ?? null, lastError: null, connectedBy: userId, updatedAt: now,
  });
  batch.set(integrationSecrets().doc(secretId(businessId, provider)), {
    businessId, provider, accessToken: encryptSecret(c.accessToken), refreshToken: c.refreshToken ? encryptSecret(c.refreshToken) : null,
    expiresAt: c.expiresAt ?? null, scopes: c.scopes ?? null, updatedAt: now,
  });
  // Routes webhooks from this POS account to exactly one business.
  batch.set(integrationAccounts().doc(accountId(provider, c.accountId)), { businessId, provider });
  await batch.commit();
}

export async function disconnect(businessId: string, provider: Provider) {
  const ref = biz(businessId).integrations.doc(provider);
  const current = (await ref.get()).data();
  const batch = db().batch();
  batch.delete(integrationSecrets().doc(secretId(businessId, provider)));
  if (current?.externalAccountId) batch.delete(integrationAccounts().doc(accountId(provider, current.externalAccountId)));
  batch.set(ref, { status: "disconnected", externalAccountId: null, updatedAt: nowIso() }, { merge: true });
  await batch.commit();
}

async function loadCredentials(businessId: string, integration: IntegrationDoc, adapter: PosAdapter): Promise<Credentials> {
  const secret = (await integrationSecrets().doc(secretId(businessId, adapter.provider)).get()).data();
  if (!secret) throw new IntegrationError(`${adapter.label} isn't connected.`);
  let creds: Credentials = {
    accessToken: decryptSecret(secret.accessToken), refreshToken: secret.refreshToken ? decryptSecret(secret.refreshToken) : null,
    expiresAt: secret.expiresAt, accountId: integration.externalAccountId ?? "", shopDomain: integration.shopDomain,
  };
  if (adapter.refresh && creds.expiresAt && Date.parse(creds.expiresAt) - Date.now() < 86_400_000) {
    creds = await adapter.refresh(creds);
    await integrationSecrets().doc(secretId(businessId, adapter.provider)).update({
      accessToken: encryptSecret(creds.accessToken), refreshToken: creds.refreshToken ? encryptSecret(creds.refreshToken) : null, expiresAt: creds.expiresAt ?? null, updatedAt: nowIso(),
    });
  }
  return creds;
}

async function applyCount(businessId: string, integration: IntegrationDoc, productId: string, externalId: string, quantity: number | null, countedAt: string | null, ref: string): Promise<"applied" | "conflict" | "skipped"> {
  const b = biz(businessId);
  const [product, business] = await Promise.all([b.products.doc(productId).get(), b.doc.get()]);
  const p = product.data();
  if (!p) return "skipped";
  const decision = decideReconciliation({ policy: integration.conflictPolicy, localQuantity: p.quantity, externalQuantity: quantity, lastLocalChangeAt: p.lastMovementAt, externalCountedAt: countedAt });
  if (decision.action === "skip") return "skipped";
  const logConflict = (reason: string) =>
    b.syncLogs.add({ provider: integration.provider, direction: "webhook", status: "conflict", itemsProcessed: 1, conflicts: 1, error: null, attempt: 1, nextRetryAt: null, details: { product: p.name, local: p.quantity, pos: quantity, posCountedAt: countedAt, reason }, triggeredBy: null, createdAt: nowIso(), finishedAt: nowIso() });
  if (decision.action === "conflict") {
    await logConflict(decision.reason);
    return "conflict";
  }
  try {
    const result = await applyMovement(businessId, business.data()!, { userId: null, name: `${integration.provider} POS`, role: "owner" }, {
      productId, type: "set_count", quantity: quantity!, source: "pos", idempotencyKey: `${integration.provider}:count:${hashId(externalId, countedAt ?? ref)}`,
      reason: `${integration.provider} stock sync`, observedAt: countedAt, externalRef: ref,
    });
    if (!result.duplicate) await afterMovement(businessId, result);
  } catch (e) {
    // The engine's stale-observation guard is the final word.
    if (e instanceof AppError && e.code === "stale_observation") {
      await logConflict("POS count is older than the latest StockPilot change.");
      return "conflict";
    }
    throw e;
  }
  return "applied";
}

/** Pull the POS catalog, map SKUs/barcodes to products, and reconcile counts. */
export async function runPullSync(businessId: string, provider: Provider, triggeredBy: string | null, attempt = 1): Promise<SyncSummary> {
  const b = biz(businessId);
  const integration = (await b.integrations.doc(provider).get()).data();
  if (!integration || integration.status === "disconnected" || integration.status === "not_connected") throw new IntegrationError("Integration not connected.");
  const adapter = getAdapter(provider)!;
  const log = await b.syncLogs.add({ provider, direction: "pull", status: "running", itemsProcessed: 0, conflicts: 0, error: null, attempt, nextRetryAt: null, details: {}, triggeredBy, createdAt: nowIso(), finishedAt: null });
  const summary: SyncSummary = { itemsSeen: 0, newlyMapped: 0, applied: 0, conflicts: 0, unmapped: 0, errors: 0 };
  try {
    const creds = await loadCredentials(businessId, integration, adapter);
    const items = await adapter.listCatalog(creds);
    summary.itemsSeen = items.length;
    const [products, existing] = await Promise.all([b.products.where("archivedAt", "==", null).get(), b.mappings(provider).get()]);
    const bySku = new Map(products.docs.filter((d) => d.data().skuLower).map((d) => [d.data().skuLower!, d.id]));
    const byBarcode = new Map(products.docs.filter((d) => d.data().barcode).map((d) => [d.data().barcode!, d.id]));
    const mapped = new Map(existing.docs.map((d) => [d.data().externalVariantId, d.data().productId]));

    const writer = db().bulkWriter();
    for (const it of items as ExternalItem[]) {
      const had = mapped.get(it.variantId);
      const productId = had ?? (it.sku && bySku.get(it.sku.toLowerCase())) ?? (it.barcode && byBarcode.get(it.barcode)) ?? null;
      if (!had && productId) summary.newlyMapped++;
      mapped.set(it.variantId, productId);
      void writer.set(b.mappings(provider).doc(hashId(it.variantId)), {
        productId, externalItemId: it.itemId, externalVariantId: it.variantId, externalSku: it.sku, externalName: it.name.slice(0, 300),
        lastExternalQuantity: it.quantity, lastExternalUpdatedAt: it.countedAt, updatedAt: nowIso(),
      });
    }
    await writer.close();

    for (const it of items) {
      const productId = mapped.get(it.variantId);
      if (!productId) {
        summary.unmapped++;
        continue;
      }
      try {
        const r = await applyCount(businessId, integration, productId, it.variantId, it.quantity, it.countedAt, `${provider}:pull:${log.id}`);
        if (r === "applied") summary.applied++;
        if (r === "conflict") summary.conflicts++;
      } catch {
        summary.errors++;
      }
    }
    await log.update({ status: summary.errors ? "partial" : summary.conflicts ? "conflict" : "success", itemsProcessed: summary.itemsSeen, conflicts: summary.conflicts, details: { ...summary }, finishedAt: nowIso() });
    await b.integrations.doc(provider).update({ lastSyncedAt: nowIso(), status: "connected", lastError: null });
    return summary;
  } catch (e) {
    const message = e instanceof IntegrationError ? e.message : "Unexpected sync failure.";
    const retryable = e instanceof IntegrationError ? e.retryable : true;
    await log.update({ status: "failed", error: message, finishedAt: nowIso(), nextRetryAt: retryable && attempt < 5 ? new Date(Date.now() + 2 ** attempt * 60_000).toISOString() : null });
    await b.integrations.doc(provider).update({ status: "error", lastError: message });
    await notify(businessId, { type: "sync_failed", severity: "warning", title: `${adapter.label} sync failed`, body: message, link: "/integrations", dedupeKey: `sync_failed:${provider}:${nowIso().slice(0, 10)}` });
    throw e;
  }
}

/** Process a verified webhook exactly once; failed events may be retried by the provider. */
export async function processWebhook(provider: Provider, body: unknown, headers: Headers): Promise<{ duplicate: boolean; status: string }> {
  const adapter = getAdapter(provider)!;
  const event = adapter.parseWebhook(body, headers);
  const route = event.accountId ? (await integrationAccounts().doc(accountId(provider, event.accountId)).get()).data() : undefined;
  const eventRef = webhookEvents().doc(hashId(provider, event.eventId));

  const claimed = await db().runTransaction(async (tx) => {
    const prev = (await tx.get(eventRef)).data();
    if (prev && prev.status !== "failed") return false;
    tx.set(eventRef, { provider, eventId: event.eventId.slice(0, 200), eventType: event.type.slice(0, 120), businessId: route?.businessId ?? null, status: "received", error: null, receivedAt: prev?.receivedAt ?? nowIso(), processedAt: null });
    return true;
  });
  if (!claimed) return { duplicate: true, status: "duplicate" };
  const finish = (status: string, error?: string) => eventRef.update({ status, error: error?.slice(0, 2000) ?? null, processedAt: nowIso() });

  const integration = route ? (await biz(route.businessId).integrations.doc(provider).get()).data() : undefined;
  if (!route || !integration || integration.status !== "connected" || !integration.syncEnabled) {
    await finish("ignored", integration ? "Sync disabled" : "No connected integration for this account");
    return { duplicate: false, status: "ignored" };
  }
  try {
    let changes = event.changes;
    if (event.needsLookup?.length && adapter.lookupQuantities) {
      const creds = await loadCredentials(route.businessId, integration, adapter);
      changes = (await adapter.lookupQuantities(creds, event.needsLookup)).map((c) => ({ ...c, matchOn: "variant" as const }));
    }
    const mappings = biz(route.businessId).mappings(provider);
    let applied = 0;
    let conflicts = 0;
    for (const c of changes) {
      const snap = await mappings.where(c.matchOn === "variant" ? "externalVariantId" : "externalItemId", "==", c.externalId).limit(1).get();
      const productId = snap.docs[0]?.data().productId;
      if (!productId) continue;
      const r = await applyCount(route.businessId, integration, productId, c.externalId, c.quantity, c.occurredAt, `${provider}:event:${event.eventId}`.slice(0, 200));
      if (r === "applied") applied++;
      if (r === "conflict") conflicts++;
    }
    await finish("processed");
    await biz(route.businessId).syncLogs.add({ provider, direction: "webhook", status: conflicts ? "conflict" : "success", itemsProcessed: changes.length, conflicts, error: null, attempt: 1, nextRetryAt: null, details: { event: event.type, applied }, triggeredBy: null, createdAt: nowIso(), finishedAt: nowIso() });
    return { duplicate: false, status: "processed" };
  } catch (e) {
    await finish("failed", e instanceof IntegrationError ? e.message : "Processing failed");
    throw e;
  }
}
