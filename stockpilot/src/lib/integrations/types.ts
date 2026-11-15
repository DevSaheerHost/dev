export const PROVIDERS = ["square", "shopify", "clover"] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface Credentials {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  accountId: string;
  shopDomain?: string | null;
  locationId?: string | null;
  scopes?: string | null;
}

export interface ExternalItem {
  /** Provider item id (Shopify: inventory item id; Clover/Square: item id). */
  itemId: string;
  /** Sellable unit id we map to a product (variation / variant / item). */
  variantId: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  /** Absolute on-hand count reported by the POS, when known. */
  quantity: number | null;
  /** When the POS computed that count. */
  countedAt: string | null;
}

export interface WebhookChange {
  /** Matches ExternalItem.variantId or ExternalItem.itemId (see matchOn). */
  externalId: string;
  matchOn: "variant" | "item";
  quantity: number | null;
  occurredAt: string | null;
}

export interface ParsedWebhook {
  eventId: string;
  type: string;
  accountId: string | null;
  changes: WebhookChange[];
  /** Ids whose quantity must be fetched because the payload omits it (Clover). */
  needsLookup?: string[];
}

export interface WebhookRequest {
  rawBody: string;
  headers: Headers;
  url: string;
}

export interface PosAdapter {
  readonly provider: Provider;
  readonly label: string;
  readonly capabilities: { oauth: boolean; pullCatalog: boolean; webhooks: boolean; pushCounts: boolean };
  configured(): boolean;
  authorizeUrl(input: { state: string; redirectUri: string; shop?: string }): string;
  exchangeCode(input: { code: string; redirectUri: string; shop?: string; query: URLSearchParams }): Promise<Credentials>;
  refresh?(creds: Credentials): Promise<Credentials>;
  listCatalog(creds: Credentials): Promise<ExternalItem[]>;
  lookupQuantities?(creds: Credentials, ids: string[]): Promise<{ externalId: string; quantity: number | null; occurredAt: string | null }[]>;
  verifyWebhook(req: WebhookRequest): boolean;
  parseWebhook(body: unknown, headers: Headers): ParsedWebhook;
  registerWebhooks?(creds: Credentials, callbackUrl: string): Promise<void>;
}

export class IntegrationError extends Error {
  constructor(message: string, public retryable = false) {
    super(message);
  }
}

export async function providerFetch<T>(url: string, init: RequestInit, label: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new IntegrationError(`${label} could not be reached.`, true);
  }
  if (!res.ok) {
    const retryable = res.status === 429 || res.status >= 500;
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    console.error(`${label} API error`, res.status, detail);
    throw new IntegrationError(res.status === 401 ? `${label} rejected the credentials. Reconnect the integration.` : `${label} returned an error (${res.status}).`, retryable);
  }
  return (await res.json()) as T;
}
