import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadHermesToml } from '../schema/load.js';
import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';
import type { CloudProvider, NetworkRules, ResourceLedger } from '../cloud/core.js';

export interface RefreshSshIngressOptions {
  deploymentName: string;
  provider: CloudProvider;
  detectPublicIp: () => Promise<string>;
}

/**
 * Re-authorize SSH ingress for the operator's CURRENT public IP.
 *
 * With `ssh_allowed_from = "auto"` the security group pins the IP the
 * operator had at deploy time; when that IP changes, the box silently
 * becomes unreachable (observed 2026-09-01: jarvis SSH timed out behind
 * a rule from 11 days earlier). `hermes-deploy ssh` calls this before
 * connecting so the lockout self-heals exactly when the operator is
 * trying to get in.
 *
 * Returns the CIDR applied, or null when skipped: the config pins an
 * explicit CIDR (respect it), or the project's hermes.toml is not where
 * state points (e.g. the project moved) — in both cases the connection
 * attempt proceeds unchanged.
 */
export async function refreshSshIngress(
  opts: RefreshSshIngressOptions,
): Promise<string | null> {
  const store = new StateStore(getStatePaths());
  const state = await store.read();
  const deployment = state.deployments[opts.deploymentName];
  if (!deployment) throw new Error(`deployment "${opts.deploymentName}" not found in state`);

  const tomlPath = join(deployment.project_path, 'hermes.toml');
  if (!existsSync(tomlPath)) return null;
  const config = loadHermesToml(tomlPath);
  if (config.network.ssh_allowed_from !== 'auto') return null;

  const sshAllowedFrom = await opts.detectPublicIp();
  const rules: NetworkRules = {
    sshAllowedFrom,
    inboundPorts: config.network.inbound_ports,
    hasDomain: !!config.domain,
  };
  const ledger: ResourceLedger =
    deployment.cloud === 'aws'
      ? { kind: 'aws', resources: { ...deployment.cloud_resources } }
      : { kind: 'gcp', resources: { ...deployment.cloud_resources } };
  await opts.provider.reconcileNetwork(ledger, rules);
  return sshAllowedFrom;
}
