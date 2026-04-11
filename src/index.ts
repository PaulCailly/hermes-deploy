/**
 * Public library surface for `@paulcailly/hermes-deploy`.
 *
 * The CLI bin (`dist/cli.js`) is the primary distribution, but the
 * package also exposes a library entry so higher-level tools (the
 * managed-service control plane, test harnesses, third-party
 * integrations) can import the orchestrator, cloud-provider interface,
 * state store, and schemas directly without shelling out.
 *
 * **Stability:** this entry point follows the same semver contract as
 * the CLI surface. Breaking changes here require a major-version bump
 * and a state-file migration where applicable. Anything not re-exported
 * below is internal and may change without notice.
 */

// ---------- Cloud provider interface ----------
export type {
  CloudProvider,
  ImageRef,
  Instance,
  InstanceStatus,
  Location,
  NetworkRules,
  ProvisionSpec,
  ResourceLedger,
  Size,
} from './cloud/core.js';
export { SIZE_MAP_AWS, SIZE_MAP_GCP } from './cloud/core.js';
export { createCloudProvider } from './cloud/factory.js';
export type { CreateProviderOptions } from './cloud/factory.js';
export { AwsProvider } from './cloud/aws/provider.js';
export type { AwsProviderOptions } from './cloud/aws/provider.js';
export { GcpProvider } from './cloud/gcp/provider.js';
export type { GcpProviderOptions } from './cloud/gcp/provider.js';

// ---------- Schemas (Zod) + inferred types ----------
export {
  StateTomlSchema,
  type StateToml,
  type Deployment,
  type AwsResources,
  type GcpResources,
} from './schema/state-toml.js';
export { loadHermesToml } from './schema/load.js';

// ---------- State store + migrations ----------
export { StateStore } from './state/store.js';
export { getStatePaths, type StatePaths } from './state/paths.js';
export { runMigrations, CURRENT_SCHEMA_VERSION } from './state/migrations.js';

// ---------- Orchestrator (lifecycle) ----------
export { runDeploy, type DeployOptions, type DeployResult } from './orchestrator/deploy.js';
export { runUpdate, type UpdateOptions, type UpdateResult } from './orchestrator/update.js';
export { runDestroy, type DestroyOptions } from './orchestrator/destroy.js';
export {
  createPlainReporter,
  type Reporter,
} from './orchestrator/reporter.js';

// ---------- Errors ----------
export {
  HermesDeployError,
  CloudProvisionError,
  CloudQuotaError,
  SshBootstrapError,
  NixosRebuildError,
  HealthcheckTimeoutError,
} from './errors/index.js';

// ---------- Deployment adoption (state recovery) ----------
export {
  adoptDeployment,
  type AdoptOptions,
  type AdoptResult,
} from './commands/adopt.js';
