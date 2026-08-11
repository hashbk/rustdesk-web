import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BUILD_DATE = new Date().toISOString().slice(0, 10);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@proto': fileURLToPath(new URL('./vendor/hbb_common/protos', import.meta.url)),
    },
  },
  define: {
    __BRIDGE_BUILD_DATE__: JSON.stringify(BUILD_DATE),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_CONSOLE_API ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          nacl: ['tweetnacl'],
          protobuf: ['protobufjs'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['tweetnacl'],
  },
});