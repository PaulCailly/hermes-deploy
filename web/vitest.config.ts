import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@hermes/dto': path.resolve(__dirname, '../src/schema/dto.ts') },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: './src/test-setup.ts',
    globals: true,
  },
});
