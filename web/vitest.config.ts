import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@hermes/dto': path.resolve(dirname, '../src/schema/dto.ts') },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: './src/test-setup.ts',
    globals: true,
  },
});
