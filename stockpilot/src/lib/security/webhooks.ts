/** Webhook / OAuth signature verification for POS providers. */
import { createHmac } from "node:crypto";
import { safeEqual } from "./crypto";

/**
 * Square: base64(HMAC-SHA256(signatureKey, notificationUrl + rawBody)),
 * sent in `x-square-hmacsha256-signature`.
 */
export function verifySquareSignature(rawBody: string, signature: string | null, signatureKey: string, notificationUrl: string): boolean {
  if (!signature || !signatureKey) return false;
  const expected = createHmac("sha256", signatureKey).update(notificationUrl + rawBody).digest("base64");
  return safeEqual(expected, signature);
}

/** Shopify webhooks: base64(HMAC-SHA256(appSecret, rawBody)) in `X-Shopify-Hmac-Sha256`. */
export function verifyShopifyWebhook(rawBody: string, hmacHeader: string | null, appSecret: string): boolean {
  if (!hmacHeader || !appSecret) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("base64");
  return safeEqual(expected, hmacHeader);
}

/**
 * Shopify OAuth redirect: hex HMAC over the sorted query string without
 * `hmac`/`signature`.
 */
export function verifyShopifyOAuthQuery(params: URLSearchParams, appSecret: string): boolean {
  const hmac = params.get("hmac");
  if (!hmac || !appSecret) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const expected = createHmac("sha256", appSecret).update(message).digest("hex");
  return safeEqual(expected, hmac);
}

/** Clover webhooks carry the app's verification code in `X-Clover-Auth`. */
export function verifyCloverWebhook(authHeader: string | null, expectedCode: string): boolean {
  if (!authHeader || !expectedCode) return false;
  return safeEqual(authHeader, expectedCode);
}

export function isValidShopDomain(shop: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop);
}
