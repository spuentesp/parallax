/**
 * Re-export del harness compartido: los tests de api importan fcDefaults desde
 * aquí, y su implementación vive junto a los arbitraries en
 * `@parallax/shared/test/prop-arbitraries` (un solo lugar que mantener).
 */
export { fcDefaults } from '@parallax/shared/test/prop-arbitraries';
