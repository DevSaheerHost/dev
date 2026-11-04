import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The money, date and ledger modules are deliberately free of React and
 * Firestore, so the whole financial core is testable in plain Node.
 */
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
