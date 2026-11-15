import "server-only";
import { serverEnv } from "@/lib/env";
import { verifyCloverWebhook } from "@/lib/security/webhooks";
import { IntegrationError, providerFetch, type ExternalItem, type PosAdapter } from "./types";

const web = () => (serverEnv().CLOVER_ENVIRONMENT === "production" ? "https://www.clover.com" : "https://sandbox.dev.clover.com");
const api = () => (serverEnv().CLOVER_ENVIRONMENT === "production" ? "https://api.clover.com" : "https://apisandbox.dev.clover.com");

interface Token { access_token: string; refresh_token?: string; access_token_expiration?: number }

export const cloverAdapter: PosAdapter = {
  provider: "clover",
  label: "Clover",
  capabilities: { oauth: true, pullCatalog: true, webhooks: true, pushCounts: false },
  configured: () => !!serverEnv().CLOVER_APP_ID && !!serverEnv().CLOVER_APP_SECRET,

  authorizeUrl({ state, redirectUri }) {
    const u = new URL(`${web()}/oauth/v2/authorize`);
    u.searchParams.set("client_id", serverEnv().CLOVER_APP_ID!);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    return u.toString();
  },

  async exchangeCode({ code, query }) {
    const env = serverEnv();
    const merchantId = query.get("merchant_id");
    if (!merchantId || !/^[A-Z0-9]{8,20}$/.test(merchantId)) throw new IntegrationError("Clover didn't return a merchant id.");
    const t = await providerFetch<Token>(`${api()}/oauth/v2/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: env.CLOVER_APP_ID, client_secret: env.CLOVER_APP_SECRET, code }),
    }, "Clover");
    return {
      accessToken: t.access_token, refreshToken: t.refresh_token ?? null, accountId: merchantId,
      expiresAt: t.access_token_expiration ? new Date(t.access_token_expiration * 1000).toISOString() : null,
    };
  },

  async refresh(creds) {
    if (!creds.refreshToken) throw new IntegrationError("Clover session expired. Reconnect the integration.");
    const t = await providerFetch<Token>(`${api()}/oauth/v2/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: serverEnv().CLOVER_APP_ID, refresh_token: creds.refreshToken }),
    }, "Clover");
    return { ...creds, accessToken: t.access_token, refreshToken: t.refresh_token ?? creds.refreshToken, expiresAt: t.access_token_expiration ? new Date(t.access_token_expiration * 1000).toISOString() : null };
  },

  async listCatalog(creds) {
    const items: ExternalItem[] = [];
    for (let offset = 0; offset < 50_000; offset += 1000) {
      const u = `${api()}/v3/merchants/${encodeURIComponent(creds.accountId)}/items?expand=itemStock&limit=1000&offset=${offset}`;
      const body = await providerFetch<{ elements?: { id: string; name: string; sku?: string; code?: string; modifiedTime?: number; itemStock?: { quantity?: number } }[] }>(u, { headers: { authorization: `Bearer ${creds.accessToken}` } }, "Clover");
      for (const e of body.elements ?? []) {
        items.push({
          itemId: e.id, variantId: e.id, sku: e.sku ?? null, barcode: e.code ?? null, name: e.name,
          quantity: e.itemStock?.quantity ?? null, countedAt: e.modifiedTime ? new Date(e.modifiedTime).toISOString() : null,
        });
      }
      if ((body.elements ?? []).length < 1000) break;
    }
    return items;
  },

  async lookupQuantities(creds, ids) {
    const out = [];
    for (const id of ids.slice(0, 50)) {
      const s = await providerFetch<{ quantity?: number; modifiedTime?: number }>(
        `${api()}/v3/merchants/${encodeURIComponent(creds.accountId)}/item_stocks/${encodeURIComponent(id)}`,
        { headers: { authorization: `Bearer ${creds.accessToken}` } }, "Clover",
      );
      out.push({ externalId: id, quantity: s.quantity ?? null, occurredAt: s.modifiedTime ? new Date(s.modifiedTime).toISOString() : null });
    }
    return out;
  },

  verifyWebhook({ headers }) {
    return verifyCloverWebhook(headers.get("x-clover-auth"), serverEnv().CLOVER_WEBHOOK_AUTH_CODE ?? "");
  },

  parseWebhook(body) {
    const b = body as { appId?: string; merchants?: Record<string, { objectId: string; type: string; ts: number }[]> };
    const entries = Object.entries(b.merchants ?? {});
    if (entries.length !== 1) throw new IntegrationError("Expected one merchant per Clover event.");
    const [merchantId, updates] = entries[0];
    const itemIds = updates.filter((u) => /^I:/.test(u.objectId) && u.type !== "DELETE").map((u) => u.objectId.slice(2));
    const signature = updates.map((u) => `${u.objectId}@${u.ts}`).sort().join(",");
    return { eventId: `${merchantId}:${signature}`.slice(0, 200), type: "item.update", accountId: merchantId, changes: [], needsLookup: itemIds };
  },
};
