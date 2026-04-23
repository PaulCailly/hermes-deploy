import { DNS } from '@google-cloud/dns';

export interface ManagedZoneRef {
  zoneName: string;
  dnsName: string;
}

export async function findManagedZoneGcp(project: string, fqdn: string): Promise<ManagedZoneRef> {
  const dns = new DNS({ projectId: project });
  const [zones] = await dns.getZones();

  // Walk up domain labels from parent zone to TLD.
  // Start at i=1 to skip the full FQDN itself (which is a record, not a zone).
  const labels = fqdn.split('.');
  for (let i = 1; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join('.') + '.';
    const match = zones.find((z: any) => z.metadata?.dnsName === candidate);
    if (match) {
      return { zoneName: match.name as string, dnsName: candidate };
    }
  }

  throw new Error(`No managed zone found for "${fqdn}" in GCP project "${project}"`);
}

export async function upsertDnsRecordGcp(
  project: string,
  zoneName: string,
  fqdn: string,
  ip: string,
): Promise<void> {
  const dns = new DNS({ projectId: project });
  const zone = dns.zone(zoneName);

  const fqdnDot = fqdn.endsWith('.') ? fqdn : `${fqdn}.`;

  const [existing] = await zone.getRecords({ name: fqdnDot, type: 'A' });
  const newRecord = zone.record('a', { name: fqdnDot, ttl: 300, data: ip });

  if (existing && existing.length > 0) {
    await zone.createChange({ delete: existing, add: newRecord } as any);
  } else {
    await zone.createChange({ add: newRecord } as any);
  }
}

export async function deleteDnsRecordGcp(
  project: string,
  zoneName: string,
  fqdn: string,
): Promise<void> {
  const dns = new DNS({ projectId: project });
  const zone = dns.zone(zoneName);

  const fqdnDot = fqdn.endsWith('.') ? fqdn : `${fqdn}.`;

  const [existing] = await zone.getRecords({ name: fqdnDot, type: 'A' });

  if (existing && existing.length > 0) {
    await zone.createChange({ delete: existing });
  }
}
