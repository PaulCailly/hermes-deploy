import {
  EC2Client,
  DeleteKeyPairCommand,
  DeleteSecurityGroupCommand,
  TerminateInstancesCommand,
  ReleaseAddressCommand,
  waitUntilInstanceTerminated,
} from '@aws-sdk/client-ec2';
import type { ResourceLedger } from '../core.js';

export async function destroyAws(ec2: EC2Client, ledger: ResourceLedger): Promise<void> {
  if (ledger.kind !== 'aws') throw new Error(`expected aws ledger, got ${ledger.kind}`);
  const r = ledger.resources;

  // Order: instance → EIP → SG → keypair (reverse of provision deps)
  if (r.instance_id) {
    try {
      await ec2.send(new TerminateInstancesCommand({ InstanceIds: [r.instance_id] }));
      await waitUntilInstanceTerminated(
        { client: ec2, maxWaitTime: 300 },
        { InstanceIds: [r.instance_id] },
      );
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
    delete r.instance_id;
  }

  if (r.eip_allocation_id) {
    try {
      await ec2.send(new ReleaseAddressCommand({ AllocationId: r.eip_allocation_id }));
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
    delete r.eip_allocation_id;
  }

  if (r.security_group_id) {
    try {
      await ec2.send(new DeleteSecurityGroupCommand({ GroupId: r.security_group_id }));
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
    delete r.security_group_id;
  }

  if (r.key_pair_name) {
    try {
      await ec2.send(new DeleteKeyPairCommand({ KeyName: r.key_pair_name }));
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
    delete r.key_pair_name;
  }
}

function isNotFound(e: unknown): boolean {
  const msg = (e as Error).message ?? '';
  return /NotFound|does not exist|InvalidInstanceID/.test(msg);
}
