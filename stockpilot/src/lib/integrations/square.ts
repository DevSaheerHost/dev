import "server-only";
import { serverEnv } from "@/lib/env";
import { verifySquareSignature } from "@/lib/security/webhooks";
import { IntegrationError, providerFetch, type Credentials, type ExternalItem, type ParsedWebhook, type PosAdapter, type WebhookRequest } from "./types";

const VERSION = "2025-01-23";
const base = () => (serverEnv().SQUARE_ENVIRONMENT === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com");
const headers = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json", "square-version": VERSION });

interface TokenResponse { access_token: string; refresh_token?: string; expires_at?: string; merchant_id: string }

export const squareAdapter: PosAdapter = {
  provider: "square",
  label: "Square",
  capabilities: { oauth: true, pullCatalog: true, webhooks: true, pushCounts: false },
  configured: () => !!serverEnv().SQUARE_APPLICATION_ID && !!serverEnv().SQUARE_APPLICATION_SECRET,

  authorizeUrl({ state }) {
    const u = new URL(`${base()}/oauth2/authorize`);
    u.searchParams.set("client_id", serverEnv().SQUARE_APPLICATION_ID!);
    u.searchParams.set("scope", "ITEMS_READ INVENTORY_READ MERCHANT_PROFILE_READ");
    u.searchParams.set("session", "false");
    u.searchParams.set("state", state);
    return u.toString();
  },

  async exchangeCode({ code, redirectUri }) {
    const env = serverEnv();
    const t = await providerFetch<TokenResponse>(`${base()}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/json", "square-version": VERSION },
      body: JSON.stringify({ client_id: env.SQUARE_APPLICATION_ID, client_secret: env.SQUARE_APPLICATION_SECRET, code, grant_type: "authorization_code", redirect_uri: redirectUri }),
    }, "Square");
    return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, expiresAt: t.expires_at ?? null, accountId: t.merchant_id };
  },

  async refresh(creds) {
    if (!creds.refreshToken) throw new IntegrationError("Square session expired. Reconnect the integration.");
    const env = serverEnv();
    const t = await providerFetch<TokenResponse>(`${base()}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/json", "square-version": VERSION },
      body: JSON.stringify({ client_id: env.SQUARE_APPLICATION_ID, client_secret: env.SQUARE_APPLICATION_SECRET, refresh_token: creds.refreshToken, grant_type: "refresh_token" }),
    }, "Square");
    return { ...creds, accessToken: t.access_token, refreshToken: t.refresh_token ?? creds.refreshToken, expiresAt: t.expires_at ?? null };
  },

  async listCatalog(creds) {
    const items: ExternalItem[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const u = new URL(`${base()}/v2/catalog/list`);
      u.searchParams.set("types", "ITEM");
      if (cursor) u.searchParams.set("cursor", cursor);
      const body = await providerFetch<{ objects?: { id: string; item_data?: { name?: string; variations?: { id: string; item_variation_data?: { sku?: string; upc?: string; name?: string } }[] } }[]; cursor?: string }>(u.toString(), { headers: headers(creds.accessToken) }, "Square");
      for (const o of body.objects ?? []) {
        for (const v of o.item_data?.variations ?? []) {
          const vName = v.item_variation_data?.name;
          items.push({
            itemId: o.id, variantId: v.id, sku: v.item_variation_data?.sku ?? null, barcode: v.item_variation_data?.upc ?? null,
            name: [o.item_data?.name, vName && vName !== "Regular" ? vName : null].filter(Boolean).join(" – "), quantity: null, countedAt: null,
          });
        }
      }
      cursor = body.cursor;
      if (!cursor) break;
    }
    // Counts in batches of 100 ids.
    for (let i = 0; i < items.length; i += 100) {
      const ids = items.slice(i, i + 100).map((x) => x.variantId);
      const counts = await providerFetch<{ counts?: { catalog_object_id: string; quantity: string; state: string; calculated_at: string }[] }>(`${base()}/v2/inventory/counts/batch-retrieve`, {
        method: "POST", headers: headers(creds.accessToken), body: JSON.stringify({ catalog_object_ids: ids, states: ["IN_STOCK"] }),
      }, "Square");
      const byId = new Map<string, { q: number; at: string }>();
      for (const c of counts.counts ?? []) {
        const prev = byId.get(c.catalog_object_id);
        byId.set(c.catalog_object_id, { q: (prev?.q ?? 0) + Number(c.quantity), at: c.calculated_at > (prev?.at ?? "") ? c.calculated_at : prev!.at });
      }
      for (const it of items.slice(i, i + 100)) {
        const c = byId.get(it.variantId);
        if (c) {
          it.quantity = c.q;
          it.countedAt = c.at;
        }
      }
    }
    return items;
  },

  verifyWebhook({ rawBody, headers: h, url }: WebhookRequest) {
    const key = serverEnv().SQUARE_WEBHOOK_SIGNATURE_KEY;
    return !!key && verifySquareSignature(rawBody, h.get("x-square-hmacsha256-signature"), key, url);
  },

  parseWebhook(body) {
    const b = body as { event_id?: string; type?: string; merchant_id?: string; data?: { object?: { inventory_counts?: { catalog_object_id: string; quantity: string; state: string; calculated_at: string }[] } } };
    if (!b.event_id || !b.type) throw new IntegrationError("Malformed Square event.");
    const counts = (b.data?.object?.inventory_counts ?? []).filter((c) => c.state === "IN_STOCK");
    const parsed: ParsedWebhook = {
      eventId: b.event_id,
      type: b.type,
      accountId: b.merchant_id ?? null,
      changes: b.type === "inventory.count.updated"
        ? counts.map((c) => ({ externalId: c.catalog_object_id, matchOn: "variant" as const, quantity: Number(c.quantity), occurredAt: c.calculated_at }))
        : [],
    };
    return parsed;
  },
};

export type { Credentials };
