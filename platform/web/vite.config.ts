import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: { tsconfigPaths: true },
  server: {
    port: 5173,
    // Keep the Host header (alpha.localhost:5173) so the API can resolve the tenant.
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/socket.io': {
        target: apiTarget,
        changeOrigin: false,
        ws: true,
      },
    },
  },
});
