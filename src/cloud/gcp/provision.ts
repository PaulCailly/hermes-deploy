import {
  InstancesClient,
  AddressesClient,
  FirewallsClient,
} from '@google-cloud/compute';
import type { ProvisionSpec, ResourceLedger, Instance } from '../core.js';
import { SIZE_MAP_GCP } from '../core.js';
import { destroyGcp, zoneToRegion } from './destroy.js';
import { CloudProvisionError } from '../../errors/index.js';

const LABEL_MANAGED_BY = 'managed-by';
const LABEL_DEPLOYMENT = 'hermes-deploy-deployment';
const LABEL_VALUE = 'hermes-deploy';

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 300_000;

export async function provisionGcp(
  project: string,
  spec: ProvisionSpec,
  ledger: ResourceLedger,
): Promise<Instance> {
  if (ledger.kind !== 'gcp') throw new Error(`expected gcp ledger, got ${ledger.kind}`);
  const r = ledger.resources;
  const zone = spec.location.zone!;
  const region = zoneToRegion(zone);
  const name = `hermes-deploy-${spec.deploymentName}`;

  r.project_id = project;
  r.zone = zone;

  try {
    // 1. Reserve static external IP
    const addressesClient = new AddressesClient();
    const [addressOp] = await addressesClient.insert({
      project,
      region,
      addressResource: {
        name,
        addressType: 'EXTERNAL',
        networkTier: 'PREMIUM',
      },
    });
    await addressOp.promise();
    r.static_ip_name = name;

    // Retrieve the allocated IP address
    const [addressInfo] = await addressesClient.get({ project, region, address: name });
    const publicIp = addressInfo.address!;

    // 2. Create firewall rules
    const firewallsClient = new FirewallsClient();
    const ruleNames: string[] = [];

    // Rule A: SSH from user IP
    const sshRuleName = `${name}-ssh`;
    const [sshOp] = await firewallsClient.insert({
      project,
      firewallResource: {
        name: sshRuleName,
        network: `projects/${project}/global/networks/default`,
        direction: 'INGRESS',
        allowed: [{ IPProtocol: 'tcp', ports: ['22'] }],
        sourceRanges: [spec.networkRules.sshAllowedFrom],
        targetTags: [name],
      },
    });
    await sshOp.promise();
    ruleNames.push(sshRuleName);

    // Rule B: inbound ports (only if non-empty)
    if (spec.networkRules.inboundPorts.length > 0) {
      const portsRuleName = `${name}-ports`;
      const [portsOp] = await firewallsClient.insert({
        project,
        firewallResource: {
          name: portsRuleName,
          network: `projects/${project}/global/networks/default`,
          direction: 'INGRESS',
          allowed: [{ IPProtocol: 'tcp', ports: spec.networkRules.inboundPorts.map(String) }],
          sourceRanges: ['0.0.0.0/0'],
          targetTags: [name],
        },
      });
      await portsOp.promise();
      ruleNames.push(portsRuleName);
    }
    r.firewall_rule_names = ruleNames;

    // 3. Create instance
    const instancesClient = new InstancesClient();
    const [instanceOp] = await instancesClient.insert({
      project,
      zone,
      instanceResource: {
        name,
        machineType: `zones/${zone}/machineTypes/${SIZE_MAP_GCP[spec.size]}`,
        disks: [{
          initializeParams: {
            sourceImage: spec.image.id,
            diskSizeGb: String(spec.diskGb),
            diskType: `zones/${zone}/diskTypes/pd-ssd`,
          },
          boot: true,
          autoDelete: true,
        }],
        networkInterfaces: [{
          network: `projects/${project}/global/networks/default`,
          accessConfigs: [{
            name: 'External NAT',
            natIP: publicIp,
            type: 'ONE_TO_ONE_NAT',
          }],
        }],
        metadata: {
          items: [{ key: 'ssh-keys', value: `root:${spec.publicSshKey}` }],
        },
        tags: { items: [name] },
        labels: {
          [LABEL_MANAGED_BY]: LABEL_VALUE,
          [LABEL_DEPLOYMENT]: spec.deploymentName,
        },
      },
    });
    await instanceOp.promise();
    r.instance_name = name;

    // 4. Poll until RUNNING
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const [inst] = await instancesClient.get({ project, zone, instance: name });
      if (inst.status === 'RUNNING') {
        return { publicIp, sshUser: 'root' };
      }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error(`instance ${name} did not reach RUNNING within ${POLL_TIMEOUT_MS / 1000}s`);
  } catch (e) {
    try {
      await destroyGcp(ledger);
    } catch {
      // Swallow rollback errors; surface the original
    }
    throw new CloudProvisionError(
      `GCP provisioning failed: ${(e as Error).message}`,
      e,
    );
  }
}
