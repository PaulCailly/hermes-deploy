import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeSecurityGroupsCommand,
  DescribeKeyPairsCommand,
  DescribeAddressesCommand,
} from '@aws-sdk/client-ec2';
import type { AdoptResult } from '../core.js';
import type { AwsResources } from '../../schema/state-toml.js';

/**
 * Rebuild a ResourceLedger for an AWS deployment whose state entry was
 * lost. We search for every resource type we might have tagged during
 * `provision()` and reconstruct an {@link AwsResources} record from
 * whatever we find. The `managed-by=hermes-deploy` +
 * `hermes-deploy/deployment=<name>` pair is the only safety rail: we
 * will *only* return a ledger populated with resources that carry both
 * of those tags.
 *
 * Semantics:
 * - At least ONE tagged resource must exist, or we throw (nothing to
 *   adopt). The most authoritative signal is a tagged instance; if we
 *   find one but no matching SG/keypair/EIP, we still return a partial
 *   ledger — `destroy` is idempotent and tolerates missing entries.
 * - `region` is whatever the caller's EC2 client is configured against.
 * - The public IP is read from the adopted instance (if it has one) so
 *   the caller can populate `instance_ip` in state.
 *
 * This function performs no mutations. It's safe to call repeatedly.
 */
export async function adoptAws(
  ec2: EC2Client,
  deploymentName: string,
  region: string,
): Promise<AdoptResult> {
  const tagFilters = [
    { Name: 'tag:managed-by', Values: ['hermes-deploy'] },
    { Name: 'tag:hermes-deploy/deployment', Values: [deploymentName] },
  ];

  // Instance — the anchor. Skip terminated instances (they're invisible
  // to destroy anyway and would produce a useless ledger).
  const instancesResult = await ec2.send(
    new DescribeInstancesCommand({
      Filters: [
        ...tagFilters,
        {
          Name: 'instance-state-name',
          Values: ['pending', 'running', 'stopping', 'stopped'],
        },
      ],
    }),
  );
  const instances =
    instancesResult.Reservations?.flatMap((r) => r.Instances ?? []) ?? [];

  // Security group
  const sgResult = await ec2.send(
    new DescribeSecurityGroupsCommand({ Filters: tagFilters }),
  );
  const securityGroups = sgResult.SecurityGroups ?? [];

  // Key pair
  const keyPairsResult = await ec2.send(
    new DescribeKeyPairsCommand({ Filters: tagFilters }),
  );
  const keyPairs = keyPairsResult.KeyPairs ?? [];

  // Elastic IP
  const addressesResult = await ec2.send(
    new DescribeAddressesCommand({ Filters: tagFilters }),
  );
  const addresses = addressesResult.Addresses ?? [];

  const totalResources =
    instances.length +
    securityGroups.length +
    keyPairs.length +
    addresses.length;

  if (totalResources === 0) {
    throw new Error(
      `no AWS resources tagged managed-by=hermes-deploy + hermes-deploy/deployment=${deploymentName} found in region ${region}`,
    );
  }

  if (instances.length > 1) {
    const ids = instances.map((i) => i.InstanceId).join(', ');
    throw new Error(
      `refusing to adopt: found ${instances.length} instances tagged for deployment "${deploymentName}" in region ${region} (${ids}). Clean up the duplicates manually before running adopt.`,
    );
  }

  const instance = instances[0];
  const sg = securityGroups[0];
  const keyPair = keyPairs[0];
  const address = addresses[0];

  const resources: Partial<AwsResources> = { region };
  if (instance?.InstanceId) resources.instance_id = instance.InstanceId;
  if (sg?.GroupId) resources.security_group_id = sg.GroupId;
  if (keyPair?.KeyName) resources.key_pair_name = keyPair.KeyName;
  if (address?.AllocationId) resources.eip_allocation_id = address.AllocationId;

  return {
    ledger: { kind: 'aws', resources },
    publicIp: instance?.PublicIpAddress ?? address?.PublicIp ?? null,
  };
}
