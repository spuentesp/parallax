import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules', 'dist', '.next', '**/test-heldout/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/test/**', '**/test-heldout/**', '**/*.d.ts'],
    },
    alias: {
      '@parallax/api': fileURLToPath(new URL('./packages/api/src', import.meta.url)),
      '@parallax/gates': fileURLToPath(new URL('./packages/gates/src', import.meta.url)),
      '@parallax/mcp': fileURLToPath(new URL('./packages/mcp/src', import.meta.url)),
      '@parallax/shared': fileURLToPath(new URL('./packages/shared/src', import.meta.url)),
      '@parallax/web': fileURLToPath(new URL('./packages/web/src', import.meta.url)),
    },
  },
});