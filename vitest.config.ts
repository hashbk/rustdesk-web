import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@proto': fileURLToPath(new URL('./vendor/hbb_common/protos', import.meta.url)),
    },
  },
  define: {
    __BRIDGE_BUILD_DATE__: JSON.stringify('test-build-date'),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.ts'],
  },
});