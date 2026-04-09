import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  sourcemap: true,
  minify: false,
  splitting: false,
  // env -S splits the rest into args; --no-warnings suppresses Node's
  // ExperimentalWarning chatter (e.g. JSON module imports from a
  // transitive dep) that would otherwise leak into stderr on every CLI
  // invocation and break scripting use cases.
  banner: { js: '#!/usr/bin/env -S node --no-warnings' },
});
