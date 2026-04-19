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
  // longest to shortest: "backresto.com" → tries "backresto.com.", "com."
  // Starting at i=0 handles apex domains (e.g. "backresto.com" where the
  // FQDN itself is the hosted zone). Stop before bare TLDs (i < length - 1).
  const bare = fqdn.replace(/\.$/, '');
  const labels = bare.split('.');
  const candidates: string[] = [];
  for (let i = 0; i < labels.length - 1; i++) {
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
  _ip: string,
): Promise<void> {
  const name = fqdn.endsWith('.') ? fqdn : `${fqdn}.`;

  // Route53 DELETE requires the exact record set (TTL + values) to match.
  // Look up the existing record instead of assuming TTL=300 and the passed IP.
  const { ListResourceRecordSetsCommand } = await import('@aws-sdk/client-route-53');
  const listResult = await r53.send(
    new ListResourceRecordSetsCommand({
      HostedZoneId: zoneId,
      StartRecordName: name,
      StartRecordType: 'A',
      MaxItems: 1,
    }),
  );
  const existing = listResult.ResourceRecordSets?.find(
    rrs => rrs.Name === name && rrs.Type === 'A',
  );
  if (!existing) return; // no record to delete

  await r53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: zoneId,
      ChangeBatch: {
        Changes: [
          {
            Action: 'DELETE',
            ResourceRecordSet: existing,
          },
        ],
      },
    }),
  );
}
