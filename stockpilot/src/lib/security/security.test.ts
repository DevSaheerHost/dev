import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, safeEqual, sha256Hex } from "./crypto";
import { sniffAudio, sniffImage } from "./upload";
import { isValidShopDomain, verifyCloverWebhook, verifyShopifyOAuthQuery, verifyShopifyWebhook, verifySquareSignature } from "./webhooks";
import { can } from "./permissions";

const KEY = randomBytes(32).toString("base64");

describe("secret encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret("sq0atp-token", KEY);
    const b = encryptSecret("sq0atp-token", KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe("sq0atp-token");
  });

  it("detects tampering and wrong keys", () => {
    const c = encryptSecret("secret", KEY);
    const parts = c.split(".");
    parts[3] = Buffer.from("SECRET").toString("base64url");
    expect(() => decryptSecret(parts.join("."), KEY)).toThrow();
    expect(() => decryptSecret(c, randomBytes(32).toString("base64"))).toThrow();
    expect(() => encryptSecret("x", Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
  });

  it("hashes and compares in constant time", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("webhook signatures", () => {
  const body = JSON.stringify({ event_id: "evt_1", type: "inventory.count.updated" });

  it("verifies Square signatures over URL + body", () => {
    const url = "https://app.example.com/api/webhooks/square";
    const sig = createHmac("sha256", "sq-key").update(url + body).digest("base64");
    expect(verifySquareSignature(body, sig, "sq-key", url)).toBe(true);
    expect(verifySquareSignature(body + " ", sig, "sq-key", url)).toBe(false);
    expect(verifySquareSignature(body, sig, "sq-key", "https://attacker.example/api/webhooks/square")).toBe(false);
    expect(verifySquareSignature(body, null, "sq-key", url)).toBe(false);
  });

  it("verifies Shopify webhook and OAuth HMACs", () => {
    const sig = createHmac("sha256", "shp-secret").update(body).digest("base64");
    expect(verifyShopifyWebhook(body, sig, "shp-secret")).toBe(true);
    expect(verifyShopifyWebhook(body, sig, "other")).toBe(false);

    const params = new URLSearchParams({ code: "abc", shop: "demo.myshopify.com", state: "s1", timestamp: "1700000000" });
    const message = "code=abc&shop=demo.myshopify.com&state=s1&timestamp=1700000000";
    params.set("hmac", createHmac("sha256", "shp-secret").update(message).digest("hex"));
    expect(verifyShopifyOAuthQuery(params, "shp-secret")).toBe(true);
    params.set("shop", "evil.myshopify.com");
    expect(verifyShopifyOAuthQuery(params, "shp-secret")).toBe(false);
  });

  it("verifies Clover auth codes and Shopify domains", () => {
    expect(verifyCloverWebhook("code-123", "code-123")).toBe(true);
    expect(verifyCloverWebhook("code-124", "code-123")).toBe(false);
    expect(verifyCloverWebhook(null, "code-123")).toBe(false);
    expect(isValidShopDomain("my-shop.myshopify.com")).toBe(true);
    expect(isValidShopDomain("my-shop.myshopify.com.evil.io")).toBe(false);
    expect(isValidShopDomain("https://x.myshopify.com")).toBe(false);
  });
});

describe("upload sniffing", () => {
  const pad = (b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
  it("identifies images by magic bytes, not by name", () => {
    expect(sniffImage(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ...."))).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>......"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("GIF89a.........."))).toBeNull();
  });
  it("identifies audio containers", () => {
    expect(sniffAudio(pad([0x1a, 0x45, 0xdf, 0xa3]))).toBe("audio/webm");
    expect(sniffAudio(new TextEncoder().encode("OggS............"))).toBe("audio/ogg");
    expect(sniffAudio(new TextEncoder().encode("\0\0\0\x20ftypM4A ...."))).toBe("audio/mp4");
    expect(sniffAudio(new TextEncoder().encode("#!/bin/sh echo hi...."))).toBeNull();
  });
});

describe("role capabilities", () => {
  it("matches the role matrix", () => {
    expect(can("employee", "inventory.audit")).toBe(true);
    expect(can("employee", "products.write")).toBe(false);
    expect(can("employee", "inventory.view_costs")).toBe(false);
    expect(can("manager", "purchase_orders.create")).toBe(true);
    expect(can("manager", "purchase_orders.approve")).toBe(false);
    expect(can("owner", "purchase_orders.approve")).toBe(true);
    expect(can(null, "inventory.view")).toBe(false);
  });
});
