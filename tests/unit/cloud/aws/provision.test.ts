import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  EC2Client,
  ImportKeyPairCommand,
  CreateSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand,
  RunInstancesCommand,
  AllocateAddressCommand,
  AssociateAddressCommand,
  DeleteKeyPairCommand,
  DeleteSecurityGroupCommand,
  DescribeInstancesCommand,
} from '@aws-sdk/client-ec2';
import { provisionAws } from '../../../../src/cloud/aws/provision.js';
import type { ProvisionSpec, ResourceLedger } from '../../../../src/cloud/core.js';

describe('provisionAws', () => {
  const ec2Mock = mockClient(EC2Client);
  beforeEach(() => ec2Mock.reset());

  const spec: ProvisionSpec = {
    deploymentName: 'test',
    location: { region: 'eu-west-3' },
    size: 'small',
    image: { id: 'ami-1', description: 'nixos' },
    publicSshKey: 'ssh-ed25519 AAAA test',
    networkRules: { sshAllowedFrom: '203.0.113.1/32', inboundPorts: [443] },
  };

  it('runs the full sequence and returns an instance', async () => {
    ec2Mock.on(ImportKeyPairCommand).resolves({ KeyName: 'hermes-deploy-test' });
    ec2Mock.on(CreateSecurityGroupCommand).resolves({ GroupId: 'sg-1' });
    ec2Mock.on(AuthorizeSecurityGroupIngressCommand).resolves({});
    ec2Mock.on(RunInstancesCommand).resolves({
      Instances: [{ InstanceId: 'i-1' }],
    });
    ec2Mock.on(AllocateAddressCommand).resolves({
      AllocationId: 'eipalloc-1',
      PublicIp: '203.0.113.42',
    });
    // waitUntilInstanceRunning polls DescribeInstances; return 'running'
    // immediately so the waiter resolves without retrying.
    ec2Mock.on(DescribeInstancesCommand).resolves({
      Reservations: [{
        Instances: [{ InstanceId: 'i-1', State: { Name: 'running' } }],
      }],
    });
    ec2Mock.on(AssociateAddressCommand).resolves({});

    const ec2 = new EC2Client({ region: 'eu-west-3' });
    const ledger: ResourceLedger = { kind: 'aws', resources: {} };
    const instance = await provisionAws(ec2, spec, ledger);

    expect(instance.publicIp).toBe('203.0.113.42');
    expect(ledger.kind === 'aws' && ledger.resources.instance_id).toBe('i-1');
    expect(ledger.kind === 'aws' && ledger.resources.security_group_id).toBe('sg-1');
    expect(ledger.kind === 'aws' && ledger.resources.eip_allocation_id).toBe('eipalloc-1');
  });

  it('rolls back resources created so far if RunInstances fails', async () => {
    ec2Mock.on(ImportKeyPairCommand).resolves({ KeyName: 'hermes-deploy-test' });
    ec2Mock.on(CreateSecurityGroupCommand).resolves({ GroupId: 'sg-1' });
    ec2Mock.on(AuthorizeSecurityGroupIngressCommand).resolves({});
    ec2Mock.on(RunInstancesCommand).rejects(new Error('InsufficientInstanceCapacity'));
    ec2Mock.on(DeleteSecurityGroupCommand).resolves({});
    ec2Mock.on(DeleteKeyPairCommand).resolves({});

    const ec2 = new EC2Client({ region: 'eu-west-3' });
    const ledger: ResourceLedger = { kind: 'aws', resources: {} };
    await expect(provisionAws(ec2, spec, ledger)).rejects.toThrow(/InsufficientInstanceCapacity/);

    // After rollback, the ledger should be empty
    expect(ledger.kind === 'aws' && ledger.resources.instance_id).toBeUndefined();
    expect(ledger.kind === 'aws' && ledger.resources.security_group_id).toBeUndefined();
    expect(ledger.kind === 'aws' && ledger.resources.key_pair_name).toBeUndefined();

    // And rollback API calls were made
    expect(ec2Mock.commandCalls(DeleteSecurityGroupCommand)).toHaveLength(1);
    expect(ec2Mock.commandCalls(DeleteKeyPairCommand)).toHaveLength(1);
  });
});
