import { defineConfig } from 'vitest/config';

// Suite held-out (T_test): composición e invariantes de punta a punta. NO
// corre en `pnpm test` (el include de vitest.config.ts es test/** y src/**);
// corre sólo con `pnpm test:heldout`, en un job de CI propio.
export default defineConfig({
  test: {
    name: '@parallax/api-heldout',
    environment: 'node',
    include: ['test-heldout/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
