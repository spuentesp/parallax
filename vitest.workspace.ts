import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/shared',
  'packages/api',
  'packages/mcp',
  'packages/web',
  'packages/gates',
]);
