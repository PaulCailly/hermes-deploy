import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeSecurityGroupsCommand,
  DescribeKeyPairsCommand,
  DescribeAddressesCommand,
} from '@aws-sdk/client-ec2';
import { adoptAws } from '../../../../src/cloud/aws/adopt.js';

describe('adoptAws', () => {
  const ec2Mock = mockClient(EC2Client);
  beforeEach(() => ec2Mock.reset());

  it('rebuilds a full ledger when all four resource types are tagged', async () => {
    ec2Mock.on(DescribeInstancesCommand).resolves({
      Reservations: [
        {
          Instances: [
            {
              InstanceId: 'i-abc',
              PublicIpAddress: '203.0.113.42',
              State: { Name: 'running' },
            },
          ],
        },
      ],
    });
    ec2Mock.on(DescribeSecurityGroupsCommand).resolves({
      SecurityGroups: [{ GroupId: 'sg-def' }],
    });
    ec2Mock.on(DescribeKeyPairsCommand).resolves({
      KeyPairs: [{ KeyName: 'hermes-deploy-test' }],
    });
    ec2Mock.on(DescribeAddressesCommand).resolves({
      Addresses: [{ AllocationId: 'eipalloc-ghi', PublicIp: '203.0.113.42' }],
    });

    const result = await adoptAws(ec2Mock as any, 'test', 'eu-west-3');

    expect(result.ledger.kind).toBe('aws');
    expect(result.ledger.resources).toMatchObject({
      instance_id: 'i-abc',
      security_group_id: 'sg-def',
      key_pair_name: 'hermes-deploy-test',
      eip_allocation_id: 'eipalloc-ghi',
      region: 'eu-west-3',
    });
    expect(result.publicIp).toBe('203.0.113.42');
  });

  it('returns a partial ledger when only the security group survives', async () => {
    ec2Mock.on(DescribeInstancesCommand).resolves({ Reservations: [] });
    ec2Mock.on(DescribeSecurityGroupsCommand).resolves({
      SecurityGroups: [{ GroupId: 'sg-orphan' }],
    });
    ec2Mock.on(DescribeKeyPairsCommand).resolves({ KeyPairs: [] });
    ec2Mock.on(DescribeAddressesCommand).resolves({ Addresses: [] });

    const result = await adoptAws(ec2Mock as any, 'test', 'eu-west-3');

    expect(result.ledger.kind).toBe('aws');
    if (result.ledger.kind !== 'aws') return;
    expect(result.ledger.resources.security_group_id).toBe('sg-orphan');
    expect(result.ledger.resources.instance_id).toBeUndefined();
    expect(result.publicIp).toBeNull();
  });

  it('throws when nothing tagged is found', async () => {
    ec2Mock.on(DescribeInstancesCommand).resolves({ Reservations: [] });
    ec2Mock.on(DescribeSecurityGroupsCommand).resolves({ SecurityGroups: [] });
    ec2Mock.on(DescribeKeyPairsCommand).resolves({ KeyPairs: [] });
    ec2Mock.on(DescribeAddressesCommand).resolves({ Addresses: [] });

    await expect(adoptAws(ec2Mock as any, 'missing', 'eu-west-3')).rejects.toThrow(
      /no AWS resources tagged/,
    );
  });

  it('refuses to adopt when multiple instances carry the same deployment tag', async () => {
    ec2Mock.on(DescribeInstancesCommand).resolves({
      Reservations: [
        { Instances: [{ InstanceId: 'i-1', State: { Name: 'running' } }] },
        { Instances: [{ InstanceId: 'i-2', State: { Name: 'running' } }] },
      ],
    });
    ec2Mock.on(DescribeSecurityGroupsCommand).resolves({ SecurityGroups: [] });
    ec2Mock.on(DescribeKeyPairsCommand).resolves({ KeyPairs: [] });
    ec2Mock.on(DescribeAddressesCommand).resolves({ Addresses: [] });

    await expect(adoptAws(ec2Mock as any, 'test', 'eu-west-3')).rejects.toThrow(
      /refusing to adopt: found 2 instances/,
    );
  });

  it('issues DescribeInstances with the managed-by + deployment tag filters', async () => {
    ec2Mock.on(DescribeInstancesCommand).resolves({
      Reservations: [
        { Instances: [{ InstanceId: 'i-x', State: { Name: 'running' } }] },
      ],
    });
    ec2Mock.on(DescribeSecurityGroupsCommand).resolves({ SecurityGroups: [] });
    ec2Mock.on(DescribeKeyPairsCommand).resolves({ KeyPairs: [] });
    ec2Mock.on(DescribeAddressesCommand).resolves({ Addresses: [] });

    await adoptAws(ec2Mock as any, 'my-deployment', 'us-east-1');

    const call = ec2Mock.commandCalls(DescribeInstancesCommand)[0]!;
    const filters = (call.args[0].input as any).Filters as Array<{
      Name: string;
      Values: string[];
    }>;
    const managedBy = filters.find((f) => f.Name === 'tag:managed-by');
    const deployment = filters.find(
      (f) => f.Name === 'tag:hermes-deploy/deployment',
    );
    expect(managedBy?.Values).toEqual(['hermes-deploy']);
    expect(deployment?.Values).toEqual(['my-deployment']);
  });
});
