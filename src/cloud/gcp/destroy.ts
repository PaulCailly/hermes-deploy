import { InstancesClient, AddressesClient, FirewallsClient } from '@google-cloud/compute';
import type { ResourceLedger } from '../core.js';
import { waitZoneOp, waitRegionOp, waitGlobalOp } from './wait-op.js';

export async function destroyGcp(ledger: ResourceLedger): Promise<void> {
  if (ledger.kind !== 'gcp') throw new Error(`expected gcp ledger, got ${ledger.kind}`);
  const r = ledger.resources;
  const project = r.project_id;
  const zone = r.zone;

  // Order: instance → static IP → firewall rules (reverse of provision deps)
  if (r.instance_name && project && zone) {
    try {
      const client = new InstancesClient();
      const [op] = await client.delete({ project, zone, instance: r.instance_name });
      await waitZoneOp(project, zone, op);
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
    delete r.instance_name;
  }

  if (r.static_ip_name && project && zone) {
    const region = zoneToRegion(zone);
    try {
      const client = new AddressesClient();
      const [op] = await client.delete({ project, region, address: r.static_ip_name });
      await waitRegionOp(project, region, op);
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
    delete r.static_ip_name;
  }

  if (r.firewall_rule_names && project) {
    const client = new FirewallsClient();
    for (const name of r.firewall_rule_names) {
      try {
        const [op] = await client.delete({ project, firewall: name });
        await waitGlobalOp(project, op);
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
    }
    delete r.firewall_rule_names;
  }
}

export function zoneToRegion(zone: string): string {
  return zone.replace(/-[a-z]$/, '');
}

function isNotFound(e: unknown): boolean {
  const msg = (e as Error).message ?? '';
  return /NOT_FOUND|not found|does not exist|notFound/i.test(msg);
}
