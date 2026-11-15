import "server-only";
import { serverEnv } from "@/lib/env";
import { isValidShopDomain, verifyShopifyOAuthQuery, verifyShopifyWebhook } from "@/lib/security/webhooks";
import { IntegrationError, providerFetch, type ExternalItem, type PosAdapter } from "./types";

const API_VERSION = "2025-01";

async function gql<T>(shop: string, token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const body = await providerFetch<{ data?: T; errors?: { message: string }[] }>(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "x-shopify-access-token": token, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  }, "Shopify");
  if (body.errors?.length || !body.data) throw new IntegrationError(`Shopify query failed: ${body.errors?.[0]?.message ?? "no data"}`);
  return body.data;
}

const numericId = (gid: string) => gid.split("/").pop() ?? gid;

export const shopifyAdapter: PosAdapter = {
  provider: "shopify",
  label: "Shopify",
  capabilities: { oauth: true, pullCatalog: true, webhooks: true, pushCounts: false },
  configured: () => !!serverEnv().SHOPIFY_API_KEY && !!serverEnv().SHOPIFY_API_SECRET,

  authorizeUrl({ state, redirectUri, shop }) {
    if (!shop || !isValidShopDomain(shop)) throw new IntegrationError("Enter your store as name.myshopify.com.");
    const u = new URL(`https://${shop}/admin/oauth/authorize`);
    u.searchParams.set("client_id", serverEnv().SHOPIFY_API_KEY!);
    u.searchParams.set("scope", "read_products,read_inventory");
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    return u.toString();
  },

  async exchangeCode({ code, shop, query }) {
    const env = serverEnv();
    if (!shop || !isValidShopDomain(shop)) throw new IntegrationError("Invalid shop domain.");
    if (!verifyShopifyOAuthQuery(query, env.SHOPIFY_API_SECRET!)) throw new IntegrationError("Shopify's response signature was invalid.");
    const t = await providerFetch<{ access_token: string; scope: string }>(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: env.SHOPIFY_API_KEY, client_secret: env.SHOPIFY_API_SECRET, code }),
    }, "Shopify");
    return { accessToken: t.access_token, accountId: shop, shopDomain: shop, scopes: t.scope };
  },

  async listCatalog(creds) {
    const shop = creds.shopDomain!;
    const items: ExternalItem[] = [];
    let after: string | null = null;
    for (let page = 0; page < 40; page++) {
      const data: { productVariants: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { id: string; sku: string | null; barcode: string | null; displayName: string; inventoryQuantity: number | null; updatedAt: string; inventoryItem: { id: string } }[] } } = await gql(
        shop, creds.accessToken,
        `query($after: String) { productVariants(first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes { id sku barcode displayName inventoryQuantity updatedAt inventoryItem { id } } } }`,
        { after },
      );
      for (const v of data.productVariants.nodes) {
        items.push({ itemId: numericId(v.inventoryItem.id), variantId: numericId(v.id), sku: v.sku || null, barcode: v.barcode || null, name: v.displayName, quantity: v.inventoryQuantity, countedAt: v.updatedAt });
      }
      if (!data.productVariants.pageInfo.hasNextPage) break;
      after = data.productVariants.pageInfo.endCursor;
    }
    return items;
  },

  async registerWebhooks(creds, callbackUrl) {
    await gql(creds.shopDomain!, creds.accessToken,
      `mutation($url: URL!) { webhookSubscriptionCreate(topic: INVENTORY_LEVELS_UPDATE, webhookSubscription: { callbackUrl: $url, format: JSON }) { userErrors { message } } }`,
      { url: callbackUrl });
  },

  verifyWebhook({ rawBody, headers }) {
    return verifyShopifyWebhook(rawBody, headers.get("x-shopify-hmac-sha256"), serverEnv().SHOPIFY_API_SECRET ?? "");
  },

  parseWebhook(body, headers) {
    const eventId = headers.get("x-shopify-webhook-id") ?? headers.get("x-shopify-event-id");
    const topic = headers.get("x-shopify-topic") ?? "";
    const shop = headers.get("x-shopify-shop-domain");
    if (!eventId) throw new IntegrationError("Malformed Shopify webhook.");
    const b = body as { inventory_item_id?: number; available?: number | null; updated_at?: string };
    return {
      eventId,
      type: topic,
      accountId: shop,
      changes: topic === "inventory_levels/update" && b.inventory_item_id
        ? [{ externalId: String(b.inventory_item_id), matchOn: "item" as const, quantity: b.available ?? null, occurredAt: b.updated_at ?? null }]
        : [],
    };
  },
};
