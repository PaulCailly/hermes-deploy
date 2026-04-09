import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import type { InstanceStatus, ResourceLedger } from '../core.js';

export async function statusAws(
  ec2: EC2Client,
  ledger: ResourceLedger,
): Promise<InstanceStatus> {
  if (ledger.kind !== 'aws') throw new Error('expected aws ledger');
  const id = ledger.resources.instance_id;
  if (!id) return { state: 'unknown', publicIp: null };

  const result = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [id] }));
  const inst = result.Reservations?.[0]?.Instances?.[0];
  if (!inst) return { state: 'unknown', publicIp: null };

  const state = (inst.State?.Name ?? 'unknown') as InstanceStatus['state'];
  return { state, publicIp: inst.PublicIpAddress ?? null };
}
