import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  EC2Client,
  TerminateInstancesCommand,
  ReleaseAddressCommand,
  DeleteSecurityGroupCommand,
  DeleteKeyPairCommand,
  DescribeInstancesCommand,
} from '@aws-sdk/client-ec2';
import { destroyAws } from '../../../../src/cloud/aws/destroy.js';
import type { ResourceLedger } from '../../../../src/cloud/core.js';

describe('destroyAws', () => {
  const ec2Mock = mockClient(EC2Client);
  beforeEach(() => ec2Mock.reset());

  it('deletes resources in reverse dependency order', async () => {
    ec2Mock.on(TerminateInstancesCommand).resolves({});
    ec2Mock.on(ReleaseAddressCommand).resolves({});
    ec2Mock.on(DeleteSecurityGroupCommand).resolves({});
    ec2Mock.on(DeleteKeyPairCommand).resolves({});
    ec2Mock.on(DescribeInstancesCommand).resolves({
      Reservations: [{ Instances: [{ InstanceId: 'i-1', State: { Name: 'terminated' } }] }],
    });

    const ledger: ResourceLedger = {
      kind: 'aws',
      resources: {
        instance_id: 'i-1',
        eip_allocation_id: 'eipalloc-1',
        security_group_id: 'sg-1',
        key_pair_name: 'kp-1',
        region: 'eu-west-3',
      },
    };
    await destroyAws(ec2Mock as any, ledger);
    expect(ec2Mock.commandCalls(TerminateInstancesCommand)).toHaveLength(1);
    expect(ec2Mock.commandCalls(ReleaseAddressCommand)).toHaveLength(1);
    expect(ec2Mock.commandCalls(DeleteSecurityGroupCommand)).toHaveLength(1);
    expect(ec2Mock.commandCalls(DeleteKeyPairCommand)).toHaveLength(1);
  });

  it('is idempotent against already-deleted resources', async () => {
    ec2Mock.on(TerminateInstancesCommand).rejects(new Error('InvalidInstanceID.NotFound'));
    ec2Mock.on(ReleaseAddressCommand).rejects(new Error('InvalidAllocationID.NotFound'));
    ec2Mock.on(DeleteSecurityGroupCommand).rejects(new Error('InvalidGroup.NotFound'));
    ec2Mock.on(DeleteKeyPairCommand).resolves({});

    const ledger: ResourceLedger = {
      kind: 'aws',
      resources: {
        instance_id: 'i-1',
        eip_allocation_id: 'eipalloc-1',
        security_group_id: 'sg-1',
        key_pair_name: 'kp-1',
        region: 'eu-west-3',
      },
    };
    await expect(destroyAws(ec2Mock as any, ledger)).resolves.toBeUndefined();
  });

  it('skips steps for missing ledger fields', async () => {
    const ledger: ResourceLedger = { kind: 'aws', resources: { region: 'eu-west-3' } };
    await destroyAws(ec2Mock as any, ledger);
    expect(ec2Mock.calls()).toHaveLength(0);
  });
});
