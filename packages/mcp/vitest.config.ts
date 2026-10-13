import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@parallax/mcp',
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      thresholds: { lines: 60, functions: 60, branches: 60, statements: 60 },
    },
  },
});
