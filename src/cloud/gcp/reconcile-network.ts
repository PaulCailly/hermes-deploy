import { FirewallsClient } from '@google-cloud/compute';
import type { ResourceLedger, NetworkRules } from '../core.js';
import { waitGlobalOp } from './wait-op.js';

export async function reconcileNetworkGcp(
  ledger: ResourceLedger,
  rules: NetworkRules,
): Promise<void> {
  if (ledger.kind !== 'gcp') throw new Error(`expected gcp ledger, got ${ledger.kind}`);
  const r = ledger.resources;
  const project = r.project_id;
  if (!project || !r.instance_name) {
    throw new Error('reconcileNetworkGcp: ledger missing project_id or instance_name');
  }

  const client = new FirewallsClient();
  const baseName = r.instance_name; // hermes-deploy-<name>
  const sshRuleName = `${baseName}-ssh`;
  const portsRuleName = `${baseName}-ports`;
  const ruleNames = r.firewall_rule_names ?? [];

  // --- SSH rule ---
  if (ruleNames.includes(sshRuleName)) {
    const [current] = await client.get({ project, firewall: sshRuleName });
    const currentCidr = current.sourceRanges?.[0];
    if (currentCidr !== rules.sshAllowedFrom) {
      const [op] = await client.patch({
        project,
        firewall: sshRuleName,
        firewallResource: { sourceRanges: [rules.sshAllowedFrom] },
      });
      await waitGlobalOp(project, op);
    }
  }

  // --- Ports rule ---
  const hasPortsRule = ruleNames.includes(portsRuleName);
  const allInboundPorts = [...rules.inboundPorts];
  if (rules.hasDomain) {
    if (!allInboundPorts.includes(80)) allInboundPorts.push(80);
    if (!allInboundPorts.includes(443)) allInboundPorts.push(443);
  }
  const wantsPorts = allInboundPorts.length > 0;

  if (wantsPorts && !hasPortsRule) {
    // Create the ports rule
    const [op] = await client.insert({
      project,
      firewallResource: {
        name: portsRuleName,
        network: `projects/${project}/global/networks/default`,
        direction: 'INGRESS',
        allowed: [{ IPProtocol: 'tcp', ports: allInboundPorts.map(String) }],
        sourceRanges: ['0.0.0.0/0'],
        targetTags: [baseName],
      },
    });
    await waitGlobalOp(project, op);
    r.firewall_rule_names = [...ruleNames, portsRuleName];
  } else if (wantsPorts && hasPortsRule) {
    // Patch existing ports rule if ports changed
    const [current] = await client.get({ project, firewall: portsRuleName });
    const currentPorts = current.allowed?.[0]?.ports ?? [];
    const desiredPorts = allInboundPorts.map(String).sort();
    if (JSON.stringify([...currentPorts].sort()) !== JSON.stringify(desiredPorts)) {
      const [op] = await client.patch({
        project,
        firewall: portsRuleName,
        firewallResource: {
          allowed: [{ IPProtocol: 'tcp', ports: desiredPorts }],
        },
      });
      await waitGlobalOp(project, op);
    }
  } else if (!wantsPorts && hasPortsRule) {
    // Delete the ports rule
    const [op] = await client.delete({ project, firewall: portsRuleName });
    await waitGlobalOp(project, op);
    r.firewall_rule_names = ruleNames.filter(n => n !== portsRuleName);
  }
}
