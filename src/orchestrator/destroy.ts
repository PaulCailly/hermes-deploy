import { existsSync, unlinkSync } from 'node:fs';
import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';
import type { CloudProvider, ResourceLedger } from '../cloud/core.js';
import { createPlainReporter, type Reporter } from './reporter.js';

export interface DestroyOptions {
  deploymentName: string;
  provider: CloudProvider;
  reporter?: Reporter;
}

export async function runDestroy(opts: DestroyOptions): Promise<void> {
  const reporter = opts.reporter ?? createPlainReporter();
  const store = new StateStore(getStatePaths());
  const state = await store.read();
  const deployment = state.deployments[opts.deploymentName];
  if (!deployment) {
    throw new Error(`deployment "${opts.deploymentName}" not found in state`);
  }

  const ledger: ResourceLedger =
    deployment.cloud === 'aws'
      ? { kind: 'aws', resources: { ...deployment.cloud_resources } }
      : { kind: 'gcp', resources: { ...deployment.cloud_resources } };

  reporter.phaseStart('provision', `Destroying ${opts.deploymentName} on ${deployment.cloud}`);
  await opts.provider.destroy(ledger);
  reporter.phaseDone('provision');

  // Remove the per-deployment SSH and age keys from disk so a subsequent
  // `up` under the same name can regenerate them without tripping the
  // "key already exists" guard. This mirrors what we're doing to cloud
  // resources: destroy means destroy completely, not "leave the secrets".
  for (const path of [
    deployment.ssh_key_path,
    `${deployment.ssh_key_path}.pub`,
    deployment.age_key_path,
  ]) {
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {
        // best-effort cleanup: if the file is locked or has odd
        // permissions, leave it and let the user sort it out — the
        // cloud teardown has already succeeded.
      }
    }
  }

  await store.update(s => {
    delete s.deployments[opts.deploymentName];
  });

  reporter.success(`removed ${opts.deploymentName}`);
}
