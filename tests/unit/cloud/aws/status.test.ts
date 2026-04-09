import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { statusAws } from '../../../../src/cloud/aws/status.js';

describe('statusAws', () => {
  const ec2Mock = mockClient(EC2Client);
  beforeEach(() => ec2Mock.reset());

  it('returns running and the public ip', async () => {
    ec2Mock.on(DescribeInstancesCommand).resolves({
      Reservations: [{
        Instances: [{
          InstanceId: 'i-1',
          State: { Name: 'running' },
          PublicIpAddress: '203.0.113.42',
        }],
      }],
    });
    const result = await statusAws(ec2Mock as any, { kind: 'aws', resources: { instance_id: 'i-1', region: 'r' } });
    expect(result.state).toBe('running');
    expect(result.publicIp).toBe('203.0.113.42');
  });

  it('returns unknown if instance not found', async () => {
    ec2Mock.on(DescribeInstancesCommand).resolves({ Reservations: [] });
    const result = await statusAws(ec2Mock as any, { kind: 'aws', resources: { instance_id: 'i-x', region: 'r' } });
    expect(result.state).toBe('unknown');
  });
});
