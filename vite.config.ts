import { defineConfig } from 'vite';

// Client source lives in ./client. Production build goes to ./dist,
// which the Express server serves. In dev, /api is proxied to the server.
export default defineConfig({
  root: 'client',
  build: {
    outDir: '../dist',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001'
    }
  }
});
