import { configDefaults, defineConfig } from 'vitest/config';

// Stryker deja sandboxes con copias de los tests en .stryker-tmp: no son tests del paquete.
export default defineConfig({
  test: {
    name: '@parallax/gates',
    environment: 'node',
    exclude: [...configDefaults.exclude, '**/.stryker-tmp/**'],
  },
});
