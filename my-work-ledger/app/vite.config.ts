import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The app builds into `app/dist`, and `scripts/publish.mjs` then copies that
 * output one directory up so the repository serves it as a plain static folder
 * at `/my-work-ledger/`. A relative `base` keeps the same build working from
 * any path, including the `file://`-style origin a Capacitor WebView uses.
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
        // The Firebase SDK, the animation runtime and the PDF writer are all
        // large and none of them is needed to paint the first screen.
        manualChunks(id: string) {
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
            return 'firebase';
          }
          if (id.includes('node_modules/framer-motion') || id.includes('node_modules/motion')) {
            return 'motion';
          }
          // jsPDF is deliberately NOT named here. Forcing it into a manual
          // chunk promoted it to an initial chunk, so the entry page
          // modulepreloaded 400 KB that is only needed when someone asks for a
          // PDF. Left alone, it lands inside the dynamically imported
          // statement chunk, which is the whole point of importing it lazily.
          return undefined;
        },
      },
    },
  },
});
