import { defineConfig } from 'vitest/config';

/**
 * E2E test configuration. Runs the full deploy → update → destroy
 * lifecycle against real cloud providers.
 *
 * These tests:
 *   - Are skipped automatically when the required env vars are absent
 *     (HERMES_E2E_AWS=1 / HERMES_E2E_GCP=1), so running this config
 *     locally without cloud creds is safe.
 *   - Tag every resource with a unique
 *     `hermes-deploy/e2e-run=<run-id>` marker for nightly cleanup.
 *   - Have no concurrency cap and use generous timeouts — provisioning
 *     a NixOS VM and running nixos-rebuild takes several minutes.
 *
 * Invocation:
 *   HERMES_E2E_AWS=1 AWS_PROFILE=... AWS_REGION=... npm run test:e2e
 *   HERMES_E2E_GCP=1 GOOGLE_CLOUD_PROJECT=... HERMES_E2E_GCP_ZONE=europe-west1-b npm run test:e2e
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    // Provisioning + nixos-rebuild is slow; 30 minutes per test is
    // the upper bound on first-deploy latency even with a warm cache.
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 10 * 60 * 1000,
    // Run tests serially to avoid cross-test interference with the
    // same cloud account.
    fileParallelism: false,
    sequence: { concurrent: false },
    // No coverage for E2E — the unit suite owns coverage numbers.
    coverage: { enabled: false },
  },
});
