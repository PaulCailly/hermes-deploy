import {
  InstancesClient,
  AddressesClient,
  FirewallsClient,
} from '@google-cloud/compute';
import type { AdoptResult } from '../core.js';
import type { GcpResources } from '../../schema/state-toml.js';
import { zoneToRegion } from './destroy.js';

/**
 * Rebuild a ResourceLedger for a GCP deployment whose state entry was
 * lost. Symmetric with adoptAws: searches for instance + address +
 * firewall rules carrying the hermes-deploy provenance labels, and
 * reconstructs a {@link GcpResources} record from whatever is found.
 *
 * Because GCP labels live on the instance (not on addresses or firewall
 * rules — those use naming convention + targetTags instead), we use a
 * two-step discovery:
 *
 *   1. Find the instance by label
 *      (managed-by=hermes-deploy + hermes-deploy-deployment=<name>).
 *   2. Derive the address name + firewall rule names from the naming
 *      convention used by `provisionGcp` (`hermes-deploy-<name>` and
 *      `hermes-deploy-<name>-ssh` / `hermes-deploy-<name>-ports`),
 *      then confirm those resources actually exist before recording
 *      them in the ledger.
 *
 * This function performs no mutations. It's safe to call repeatedly.
 */
export async function adoptGcp(
  project: string,
  zone: string,
  deploymentName: string,
): Promise<AdoptResult> {
  const region = zoneToRegion(zone);
  const expectedName = `hermes-deploy-${deploymentName}`;
  const labelFilter = `labels.managed-by=hermes-deploy AND labels.hermes-deploy-deployment=${deploymentName}`;

  // 1. Find the instance by label.
  const instancesClient = new InstancesClient();
  const foundInstances: Array<{ name: string; publicIp: string | null }> = [];
  for await (const inst of instancesClient.listAsync({
    project,
    zone,
    filter: labelFilter,
  })) {
    foundInstances.push({
      name: inst.name ?? '',
      publicIp:
        inst.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP ?? null,
    });
  }

  // 2. Check for the expected static address + firewall rules even if
  //    the instance is gone (partial recovery is still useful for
  //    destroy).
  const addressesClient = new AddressesClient();
  let addressExists = false;
  try {
    await addressesClient.get({ project, region, address: expectedName });
    addressExists = true;
  } catch {
    addressExists = false;
  }

  const firewallsClient = new FirewallsClient();
  const ruleNames: string[] = [];
  for (const suffix of ['ssh', 'ports']) {
    const ruleName = `${expectedName}-${suffix}`;
    try {
      await firewallsClient.get({ project, firewall: ruleName });
      ruleNames.push(ruleName);
    } catch {
      // not present — skip
    }
  }

  if (
    foundInstances.length === 0 &&
    !addressExists &&
    ruleNames.length === 0
  ) {
    throw new Error(
      `no GCP resources tagged managed-by=hermes-deploy + hermes-deploy-deployment=${deploymentName} found in project ${project} zone ${zone}`,
    );
  }

  if (foundInstances.length > 1) {
    const names = foundInstances.map((i) => i.name).join(', ');
    throw new Error(
      `refusing to adopt: found ${foundInstances.length} instances labeled for deployment "${deploymentName}" in ${project}/${zone} (${names}). Clean up the duplicates manually before running adopt.`,
    );
  }

  const instance = foundInstances[0];
  const resources: Partial<GcpResources> = {
    project_id: project,
    zone,
  };
  if (instance) resources.instance_name = instance.name;
  if (addressExists) resources.static_ip_name = expectedName;
  if (ruleNames.length > 0) resources.firewall_rule_names = ruleNames;

  return {
    ledger: { kind: 'gcp', resources },
    publicIp: instance?.publicIp ?? null,
  };
}
