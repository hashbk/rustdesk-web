import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
    exclude: ['tweetnacl'],
  },
});