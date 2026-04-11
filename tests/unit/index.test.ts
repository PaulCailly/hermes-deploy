import { describe, it, expect } from 'vitest';
import * as api from '../../src/index.js';

/**
 * The library entry re-exports the orchestrator, cloud-provider
 * interfaces, schemas, state store, and error types. This test pins
 * the contract so that accidental removals from src/index.ts show up
 * as a red test instead of a silent downstream breakage.
 *
 * Adding new exports is fine; removing or renaming one fails here.
 */
describe('@hermes-deploy/cli library entry', () => {
  it('re-exports the cloud provider surface', () => {
    expect(api.createCloudProvider).toBeTypeOf('function');
    expect(api.AwsProvider).toBeTypeOf('function');
    expect(api.GcpProvider).toBeTypeOf('function');
    expect(api.SIZE_MAP_AWS).toBeDefined();
    expect(api.SIZE_MAP_GCP).toBeDefined();
    expect(api.SIZE_MAP_AWS.small).toBeTypeOf('string');
    expect(api.SIZE_MAP_GCP.small).toBeTypeOf('string');
  });

  it('re-exports schemas and state', () => {
    expect(api.StateTomlSchema).toBeDefined();
    expect(api.StateTomlSchema.safeParse).toBeTypeOf('function');
    expect(api.loadHermesToml).toBeTypeOf('function');
    expect(api.StateStore).toBeTypeOf('function');
    expect(api.getStatePaths).toBeTypeOf('function');
    expect(api.runMigrations).toBeTypeOf('function');
    expect(api.CURRENT_SCHEMA_VERSION).toBeTypeOf('number');
  });

  it('re-exports the orchestrator', () => {
    expect(api.runDeploy).toBeTypeOf('function');
    expect(api.runUpdate).toBeTypeOf('function');
    expect(api.runDestroy).toBeTypeOf('function');
    expect(api.createPlainReporter).toBeTypeOf('function');
  });

  it('re-exports error classes', () => {
    expect(api.HermesDeployError).toBeTypeOf('function');
    expect(api.CloudProvisionError).toBeTypeOf('function');
    expect(api.CloudQuotaError).toBeTypeOf('function');
    expect(api.SshBootstrapError).toBeTypeOf('function');
    expect(api.NixosRebuildError).toBeTypeOf('function');
    expect(api.HealthcheckTimeoutError).toBeTypeOf('function');

    // Error classes should still be instanceof Error
    const err = new api.HermesDeployError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('HermesDeployError');
  });

  it('re-exports the adopt API', () => {
    expect(api.adoptDeployment).toBeTypeOf('function');
  });
});
