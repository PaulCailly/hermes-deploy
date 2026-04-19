import {
  Route53Client,
  ListHostedZonesByNameCommand,
  ChangeResourceRecordSetsCommand,
} from '@aws-sdk/client-route-53';

export interface HostedZoneRef {
  zoneId: string;
  zoneName: string;
}

/**
 * Walk up the domain labels of `fqdn` until a non-private hosted zone is found.
 * e.g. "jarvis.backresto.com" → tries "backresto.com." then "com."
 */
export async function findHostedZoneAws(
  r53: Route53Client,
  fqdn: string,
): Promise<HostedZoneRef> {
  // Strip trailing dot, then build the list of candidate zone names from
  // longest to shortest: "backresto.com", "com"
  const bare = fqdn.replace(/\.$/, '');
  const labels = bare.split('.');
  // Candidate suffixes: skip the first label (the host part)
  const candidates: string[] = [];
  for (let i = 1; i < labels.length; i++) {
    candidates.push(labels.slice(i).join('.'));
  }

  for (const candidate of candidates) {
    const dnsName = `${candidate}.`;
    const result = await r53.send(
      new ListHostedZonesByNameCommand({ DNSName: dnsName }),
    );

    const zones = result.HostedZones ?? [];
    const match = zones.find(
      z =>
        z.Name === dnsName &&
        z.Config?.PrivateZone === false,
    );

    if (match && match.Id) {
      // AWS returns IDs like "/hostedzone/Z1234"; strip the prefix
      const zoneId = match.Id.replace(/^\/hostedzone\//, '');
      return { zoneId, zoneName: candidate };
    }
  }

  throw new Error(
    `No public hosted zone found in Route53 for FQDN "${fqdn}". ` +
      `Tried candidates: ${candidates.join(', ')}`,
  );
}

export async function upsertDnsRecordAws(
  r53: Route53Client,
  zoneId: string,
  fqdn: string,
  ip: string,
): Promise<void> {
  const name = fqdn.endsWith('.') ? fqdn : `${fqdn}.`;
  await r53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: zoneId,
      ChangeBatch: {
        Changes: [
          {
            Action: 'UPSERT',
            ResourceRecordSet: {
              Name: name,
              Type: 'A',
              TTL: 300,
              ResourceRecords: [{ Value: ip }],
            },
          },
        ],
      },
    }),
  );
}

export async function deleteDnsRecordAws(
  r53: Route53Client,
  zoneId: string,
  fqdn: string,
  ip: string,
): Promise<void> {
  const name = fqdn.endsWith('.') ? fqdn : `${fqdn}.`;
  await r53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: zoneId,
      ChangeBatch: {
        Changes: [
          {
            Action: 'DELETE',
            ResourceRecordSet: {
              Name: name,
              Type: 'A',
              TTL: 300,
              ResourceRecords: [{ Value: ip }],
            },
          },
        ],
      },
    }),
  );
}
