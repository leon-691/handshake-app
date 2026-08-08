import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative base -- this app is deployed to a GitHub Pages PROJECT subpath
  // (e.g. leon-691.github.io/handshake-app/), not domain root. With the
  // default base:'/', built asset URLs are root-absolute (/assets/...),
  // which 404s under a subpath and leaves the page blank since the JS
  // bundle never loads and React never mounts. './' makes every asset URL
  // relative to index.html's own location, correct under any subpath.
  base: './',
  server: {
    // Required for getUserMedia in some contexts
    // https: false,
    port: 60000, // Changed port to avoid conflict
    strictPort: true
  },
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision'],
    include: ['zustand']
  }
})