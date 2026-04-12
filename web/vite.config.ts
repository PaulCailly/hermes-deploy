import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@hermes/dto': path.resolve(__dirname, '../src/schema/dto.ts'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4173',
      '/ws': {
        target: 'ws://127.0.0.1:4173',
        ws: true,
      },
      '/healthz': 'http://127.0.0.1:4173',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
