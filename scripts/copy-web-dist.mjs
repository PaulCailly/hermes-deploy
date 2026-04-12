#!/usr/bin/env node
/**
 * Copy the Vite-built web bundle into dist/web/ so it ships
 * inside the npm package alongside the CLI and library entry.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'web', 'dist');
const dest = join(root, 'dist', 'web');

if (!existsSync(src)) {
  console.error('web/dist does not exist — run "cd web && npm run build" first');
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log('copied web/dist → dist/web');
