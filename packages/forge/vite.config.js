import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The Jira panel is a Forge Custom UI app: a static bundle that Forge serves to the issue
// view. `base: './'` keeps asset paths relative, which Forge requires.
export default defineConfig({
  root: 'panel',
  base: './',
  plugins: [react()],
  server: { port: 5180 },
  build: {
    outDir: '../static/panel',
    emptyOutDir: true,
    sourcemap: false,
  },
});
