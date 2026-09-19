import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The app builds into `app/dist` and `scripts/publish.mjs` then copies that
 * output one directory up, so the repository serves it as a plain static folder
 * at `/transferbox/` while the source keeps a conventional layout. Relative
 * `base` means the same build works from any path.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Keep the SDK and the QR libraries out of the entry chunk so the
        // shell paints before either of them is parsed.
        manualChunks(id: string) {
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
            return 'firebase';
          }
          if (id.includes('node_modules/qrcode') || id.includes('node_modules/jsqr')) {
            return 'qr';
          }
          return undefined;
        },
      },
    },
  },
});
