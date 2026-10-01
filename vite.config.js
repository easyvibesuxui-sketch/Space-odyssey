import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths so the build works on GitHub Pages (served from /Space-odyssey/).
  base: './',
  build: {
    // three.js alone is ~600 kB; that's expected for a 3D game.
    chunkSizeWarningLimit: 900,
  },
});
