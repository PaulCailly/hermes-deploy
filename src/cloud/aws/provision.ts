import {
  EC2Client,
  ImportKeyPairCommand,
  CreateSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand,
  RunInstancesCommand,
  AllocateAddressCommand,
  AssociateAddressCommand,
  waitUntilInstanceRunning,
} from '@aws-sdk/client-ec2';
import type { ProvisionSpec, ResourceLedger, Instance } from '../core.js';
import { SIZE_MAP_AWS } from '../core.js';
import { destroyAws } from './destroy.js';
import { CloudProvisionError } from '../../errors/index.js';

const TAG_MANAGED_BY = 'managed-by';
const TAG_DEPLOYMENT = 'hermes-deploy/deployment';
const TAG_VALUE = 'hermes-deploy';

export async function provisionAws(
  ec2: EC2Client,
  spec: ProvisionSpec,
  ledger: ResourceLedger,
): Promise<Instance> {
  if (ledger.kind !== 'aws') throw new Error(`expected aws ledger, got ${ledger.kind}`);
  const r = ledger.resources;
  const tagSpec = (resourceType: string) => ({
    ResourceType: resourceType,
    Tags: [
      { Key: TAG_MANAGED_BY, Value: TAG_VALUE },
      { Key: TAG_DEPLOYMENT, Value: spec.deploymentName },
      { Key: 'Name', Value: `hermes-deploy-${spec.deploymentName}` },
    ],
  });

  try {
    // 1. ImportKeyPair
    const keyName = `hermes-deploy-${spec.deploymentName}`;
    await ec2.send(
      new ImportKeyPairCommand({
        KeyName: keyName,
        PublicKeyMaterial: Buffer.from(spec.publicSshKey),
        TagSpecifications: [tagSpec('key-pair') as any],
      }),
    );
    r.key_pair_name = keyName;

    // 2. CreateSecurityGroup
    const sgResult = await ec2.send(
      new CreateSecurityGroupCommand({
        GroupName: `hermes-deploy-${spec.deploymentName}`,
        Description: `hermes-deploy security group for ${spec.deploymentName}`,
        TagSpecifications: [tagSpec('security-group') as any],
      }),
    );
    if (!sgResult.GroupId) throw new Error('CreateSecurityGroup returned no GroupId');
    r.security_group_id = sgResult.GroupId;

    // 3. AuthorizeSecurityGroupIngress
    const ipPermissions = [
      {
        IpProtocol: 'tcp',
        FromPort: 22,
        ToPort: 22,
        IpRanges: [{ CidrIp: spec.networkRules.sshAllowedFrom }],
      },
      ...spec.networkRules.inboundPorts.map(port => ({
        IpProtocol: 'tcp',
        FromPort: port,
        ToPort: port,
        IpRanges: [{ CidrIp: '0.0.0.0/0' }],
      })),
    ];
    await ec2.send(
      new AuthorizeSecurityGroupIngressCommand({
        GroupId: sgResult.GroupId,
        IpPermissions: ipPermissions,
      }),
    );

    // 4. RunInstances
    // NixOS community AMIs expose their root volume on /dev/xvda. We
    // override BlockDeviceMappings to enlarge the root volume because
    // the AMI snapshot is ~5 GB — far too small to build the hermes-agent
    // closure from source (first deploy's pynacl + pyproject wheels OOM
    // the disk otherwise). The size comes from cloud.disk_gb in
    // hermes.toml (default 30).
    const runResult = await ec2.send(
      new RunInstancesCommand({
        ImageId: spec.image.id,
        InstanceType: SIZE_MAP_AWS[spec.size] as any,
        MinCount: 1,
        MaxCount: 1,
        KeyName: keyName,
        SecurityGroupIds: [sgResult.GroupId],
        BlockDeviceMappings: [
          {
            DeviceName: '/dev/xvda',
            Ebs: {
              VolumeSize: spec.diskGb,
              VolumeType: 'gp3',
              DeleteOnTermination: true,
            },
          },
        ],
        TagSpecifications: [tagSpec('instance') as any],
      }),
    );
    const instanceId = runResult.Instances?.[0]?.InstanceId;
    if (!instanceId) throw new Error('RunInstances returned no instance id');
    r.instance_id = instanceId;

    // 5. AllocateAddress
    const eipResult = await ec2.send(
      new AllocateAddressCommand({
        Domain: 'vpc',
        TagSpecifications: [tagSpec('elastic-ip') as any],
      }),
    );
    if (!eipResult.AllocationId || !eipResult.PublicIp) {
      throw new Error('AllocateAddress returned incomplete data');
    }
    r.eip_allocation_id = eipResult.AllocationId;

    // 6. Wait for instance to reach 'running' before associating the EIP.
    // AssociateAddress rejects with "not in a valid state" during the brief
    // window between RunInstances returning and the instance reaching pending.
    await waitUntilInstanceRunning(
      { client: ec2, maxWaitTime: 300 },
      { InstanceIds: [instanceId] },
    );

    // 7. AssociateAddress
    await ec2.send(
      new AssociateAddressCommand({
        AllocationId: eipResult.AllocationId,
        InstanceId: instanceId,
      }),
    );

    r.region = spec.location.region;

    return { publicIp: eipResult.PublicIp, sshUser: 'root' };
  } catch (e) {
    // Roll back whatever was created so far, then re-throw a typed error
    try {
      await destroyAws(ec2, ledger);
    } catch {
      // Swallow rollback errors; surface the original
    }
    throw new CloudProvisionError(
      `AWS provisioning failed: ${(e as Error).message}`,
      e,
    );
  }
}
