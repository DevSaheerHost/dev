import "server-only";
import { cloverAdapter } from "./clover";
import { shopifyAdapter } from "./shopify";
import { squareAdapter } from "./square";
import { PROVIDERS, type PosAdapter, type Provider } from "./types";

export const ADAPTERS: Record<Provider, PosAdapter> = { square: squareAdapter, shopify: shopifyAdapter, clover: cloverAdapter };

export function getAdapter(provider: string): PosAdapter | null {
  return (PROVIDERS as readonly string[]).includes(provider) ? ADAPTERS[provider as Provider] : null;
}
