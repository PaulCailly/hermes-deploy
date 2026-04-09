import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
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

  // Remove the per-deployment SSH + age keys from the global config dir
  // AND the project-local sops artifacts (.sops.yaml, secrets.enc.yaml)
  // so a subsequent `up` under the same name starts from a clean slate.
  //
  // Why the sops files too: the sops bootstrap is "create only if missing",
  // so if we left them they'd remain encrypted against the now-deleted age
  // key and the next bootstrap would generate a fresh key but keep the
  // stale file — leaving the next `up` unable to decrypt anything.
  //
  // In M1.1 the only content in secrets.enc.yaml is the bootstrap-written
  // `placeholder: bootstrap` entry, so this cleanup is lossless. M2's
  // real secret-management flow will need to rethink this policy.
  const filesToUnlink = [
    deployment.ssh_key_path,
    `${deployment.ssh_key_path}.pub`,
    deployment.age_key_path,
    join(deployment.project_path, '.sops.yaml'),
    join(deployment.project_path, 'secrets.env.enc'),
  ];
  for (const path of filesToUnlink) {
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
