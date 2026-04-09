import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  EC2Client,
  DescribeSecurityGroupsCommand,
  AuthorizeSecurityGroupIngressCommand,
  RevokeSecurityGroupIngressCommand,
} from '@aws-sdk/client-ec2';
import { reconcileNetworkAws } from '../../../../src/cloud/aws/reconcile-network.js';
import type { ResourceLedger } from '../../../../src/cloud/core.js';

describe('reconcileNetworkAws', () => {
  const ec2Mock = mockClient(EC2Client);
  beforeEach(() => ec2Mock.reset());

  const ledger: ResourceLedger = {
    kind: 'aws',
    resources: {
      security_group_id: 'sg-1',
      instance_id: 'i-1',
      key_pair_name: 'kp-1',
      eip_allocation_id: 'eip-1',
      region: 'eu-west-3',
    },
  };

  it('adds a new inbound port rule when not present', async () => {
    ec2Mock.on(DescribeSecurityGroupsCommand).resolves({
      SecurityGroups: [{
        GroupId: 'sg-1',
        IpPermissions: [
          { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '1.2.3.4/32' }] },
        ],
      }],
    });
    ec2Mock.on(AuthorizeSecurityGroupIngressCommand).resolves({});

    await reconcileNetworkAws(ec2Mock as any, ledger, {
      sshAllowedFrom: '1.2.3.4/32',
      inboundPorts: [443],
    });

    const authCalls = ec2Mock.commandCalls(AuthorizeSecurityGroupIngressCommand);
    expect(authCalls).toHaveLength(1);
    const perms = (authCalls[0]!.args[0].input as any).IpPermissions;
    expect(perms).toHaveLength(1);
    expect(perms[0].FromPort).toBe(443);
  });

  it('revokes a rule that is no longer required', async () => {
    ec2Mock.on(DescribeSecurityGroupsCommand).resolves({
      SecurityGroups: [{
        GroupId: 'sg-1',
        IpPermissions: [
          { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '1.2.3.4/32' }] },
          { IpProtocol: 'tcp', FromPort: 8080, ToPort: 8080, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
        ],
      }],
    });
    ec2Mock.on(RevokeSecurityGroupIngressCommand).resolves({});

    await reconcileNetworkAws(ec2Mock as any, ledger, {
      sshAllowedFrom: '1.2.3.4/32',
      inboundPorts: [],
    });

    expect(ec2Mock.commandCalls(RevokeSecurityGroupIngressCommand)).toHaveLength(1);
  });

  it('is a no-op when rules already match', async () => {
    ec2Mock.on(DescribeSecurityGroupsCommand).resolves({
      SecurityGroups: [{
        GroupId: 'sg-1',
        IpPermissions: [
          { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '1.2.3.4/32' }] },
          { IpProtocol: 'tcp', FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
        ],
      }],
    });

    await reconcileNetworkAws(ec2Mock as any, ledger, {
      sshAllowedFrom: '1.2.3.4/32',
      inboundPorts: [443],
    });

    expect(ec2Mock.commandCalls(AuthorizeSecurityGroupIngressCommand)).toHaveLength(0);
    expect(ec2Mock.commandCalls(RevokeSecurityGroupIngressCommand)).toHaveLength(0);
  });

  it('updates the SSH allow rule when the CIDR changes', async () => {
    ec2Mock.on(DescribeSecurityGroupsCommand).resolves({
      SecurityGroups: [{
        GroupId: 'sg-1',
        IpPermissions: [
          { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '1.1.1.1/32' }] },
        ],
      }],
    });
    ec2Mock.on(RevokeSecurityGroupIngressCommand).resolves({});
    ec2Mock.on(AuthorizeSecurityGroupIngressCommand).resolves({});

    await reconcileNetworkAws(ec2Mock as any, ledger, {
      sshAllowedFrom: '2.2.2.2/32',
      inboundPorts: [],
    });

    expect(ec2Mock.commandCalls(RevokeSecurityGroupIngressCommand)).toHaveLength(1);
    expect(ec2Mock.commandCalls(AuthorizeSecurityGroupIngressCommand)).toHaveLength(1);
  });
});
