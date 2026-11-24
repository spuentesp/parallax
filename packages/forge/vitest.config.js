import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@parallax/forge',
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
});
