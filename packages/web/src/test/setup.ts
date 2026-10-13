// No jest-dom: its lodash/isEqualWith import is not compatible with pnpm's
// strict node_modules layout in this workspace. Use vitest's built-in
// assertions (expect(...).toBeInTheDocument() is not needed — we assert
// text content and role instead).
