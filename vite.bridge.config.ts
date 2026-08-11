/**
 * Vite config for the bridge bundle.
 *
 * Produces `dist/bridge.js` as a single IIFE bundle (no code splitting,
 * no React) that Flutter Web loads via `<script>`.  Kept separate from the
 * main `vite.config.ts` so the React app can still use ES module chunking.
 */

import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const BUILD_DATE = new Date().toISOString().slice(0, 10);

export default defineConfig({
  plugins: [],
  resolve: {
    alias: {
      '@proto': fileURLToPath(new URL('./vendor/hbb_common/protos', import.meta.url)),
    },
  },
  define: {
    __BRIDGE_BUILD_DATE__: JSON.stringify(BUILD_DATE),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    outDir: 'dist',
    emptyOutDir: false,
    minify: true,
    lib: {
      entry: fileURLToPath(new URL('./src/bridge/main.ts', import.meta.url)),
      name: 'RustDeskBridge',
      formats: ['iife'],
      fileName: () => 'bridge.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});