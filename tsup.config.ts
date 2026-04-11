import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as {
  version: string;
};

export default defineConfig([
  // CLI entry — gets the shebang + --no-warnings banner.
  {
    entry: { cli: 'src/cli.ts' },
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
    // Inject the package version as a compile-time constant so
    // `hermes-deploy --version` always matches the published version.
    define: {
      HERMES_DEPLOY_VERSION: JSON.stringify(pkg.version),
    },
  },
  // Library entry — re-exports the orchestrator + schemas + cloud
  // interfaces for higher-level tools (managed-service control plane,
  // test harnesses, third-party integrations). Emits a .d.ts so
  // TypeScript consumers get full type coverage.
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'node20',
    clean: false, // CLI entry clean:true already wiped dist/
    dts: true,
    sourcemap: true,
    minify: false,
    splitting: false,
  },
]);
