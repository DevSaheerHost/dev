import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Unit tests run in Node, which provides Web Crypto — no browser needed. */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    reporters: 'dot',
  },
});
