import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env.VITE_SERVER_URL ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Monorepo package: no pre-bundling, so `tsc --watch` propagates.
  optimizeDeps: { exclude: ['@boggle/shared'] },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: API_TARGET, ws: true, changeOrigin: true },
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
