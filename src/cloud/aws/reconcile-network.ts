import {
  EC2Client,
  DescribeSecurityGroupsCommand,
  AuthorizeSecurityGroupIngressCommand,
  RevokeSecurityGroupIngressCommand,
  type IpPermission,
} from '@aws-sdk/client-ec2';
import type { ResourceLedger, NetworkRules } from '../core.js';

interface DesiredRule {
  port: number;
  cidr: string;
}

/**
 * Apply the desired NetworkRules to an existing security group in place.
 * Adds rules that are missing, revokes rules that are no longer wanted.
 *
 * The rule set modeled here is intentionally tight: one SSH rule from
 * `sshAllowedFrom`, plus one rule per `inboundPorts` entry from
 * 0.0.0.0/0. We only consider rules with matching FromPort/ToPort and
 * the tcp protocol — anything else (UDP, port ranges, IPv6, security
 * group sources) is left alone. This is a conservative diff: it never
 * touches rules we didn't create.
 *
 * Idempotent: calling with rules that already match the SG state is a
 * no-op (no API calls beyond the initial Describe).
 */
export async function reconcileNetworkAws(
  ec2: EC2Client,
  ledger: ResourceLedger,
  rules: NetworkRules,
): Promise<void> {
  if (ledger.kind !== 'aws') throw new Error(`expected aws ledger, got ${ledger.kind}`);
  const groupId = ledger.resources.security_group_id;
  if (!groupId) throw new Error('reconcileNetworkAws: ledger has no security_group_id');

  const desired: DesiredRule[] = [
    { port: 22, cidr: rules.sshAllowedFrom },
    ...rules.inboundPorts.map(port => ({ port, cidr: '0.0.0.0/0' })),
  ];

  const result = await ec2.send(new DescribeSecurityGroupsCommand({ GroupIds: [groupId] }));
  const current = flatten(result.SecurityGroups?.[0]?.IpPermissions ?? []);

  const toAdd = desired.filter(
    d => !current.some(c => c.port === d.port && c.cidr === d.cidr),
  );
  for (const rule of toAdd) {
    await ec2.send(
      new AuthorizeSecurityGroupIngressCommand({
        GroupId: groupId,
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: rule.port,
            ToPort: rule.port,
            IpRanges: [{ CidrIp: rule.cidr }],
          },
        ],
      }),
    );
  }

  const toRevoke = current.filter(
    c => !desired.some(d => d.port === c.port && d.cidr === c.cidr),
  );
  for (const rule of toRevoke) {
    await ec2.send(
      new RevokeSecurityGroupIngressCommand({
        GroupId: groupId,
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: rule.port,
            ToPort: rule.port,
            IpRanges: [{ CidrIp: rule.cidr }],
          },
        ],
      }),
    );
  }
}

function flatten(perms: IpPermission[]): DesiredRule[] {
  const out: DesiredRule[] = [];
  for (const p of perms) {
    if (p.IpProtocol !== 'tcp') continue;
    if (p.FromPort !== p.ToPort || p.FromPort === undefined) continue;
    const port = p.FromPort;
    for (const range of p.IpRanges ?? []) {
      if (range.CidrIp) out.push({ port, cidr: range.CidrIp });
    }
  }
  return out;
}
