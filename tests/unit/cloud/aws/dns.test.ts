import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  Route53Client,
  ListHostedZonesByNameCommand,
  ChangeResourceRecordSetsCommand,
} from '@aws-sdk/client-route-53';
import {
  findHostedZoneAws,
  upsertDnsRecordAws,
  deleteDnsRecordAws,
} from '../../../../src/cloud/aws/dns.js';

describe('findHostedZoneAws', () => {
  const r53Mock = mockClient(Route53Client);
  beforeEach(() => r53Mock.reset());

  it('returns the matching non-private hosted zone', async () => {
    r53Mock.on(ListHostedZonesByNameCommand).resolves({
      HostedZones: [
        {
          Id: '/hostedzone/Z0123456789ABCDEF',
          Name: 'backresto.com.',
          CallerReference: 'ref',
          Config: { PrivateZone: false },
          ResourceRecordSetCount: 5,
        },
      ],
      IsTruncated: false,
      MaxItems: 100,
    });

    const r53 = new Route53Client({ region: 'us-east-1' });
    const ref = await findHostedZoneAws(r53, 'jarvis.backresto.com');

    expect(ref.zoneId).toBe('Z0123456789ABCDEF');
    expect(ref.zoneName).toBe('backresto.com');
  });

  it('throws when no matching zone is found', async () => {
    r53Mock.on(ListHostedZonesByNameCommand).resolves({
      HostedZones: [],
      IsTruncated: false,
      MaxItems: 100,
    });

    const r53 = new Route53Client({ region: 'us-east-1' });
    await expect(findHostedZoneAws(r53, 'jarvis.backresto.com')).rejects.toThrow(
      /No public hosted zone found/,
    );
  });
});

describe('upsertDnsRecordAws', () => {
  const r53Mock = mockClient(Route53Client);
  beforeEach(() => r53Mock.reset());

  it('sends UPSERT with the correct A record shape', async () => {
    r53Mock.on(ChangeResourceRecordSetsCommand).resolves({});

    const r53 = new Route53Client({ region: 'us-east-1' });
    await upsertDnsRecordAws(r53, 'Z0123456789ABCDEF', 'jarvis.backresto.com', '203.0.113.42');

    const calls = r53Mock.commandCalls(ChangeResourceRecordSetsCommand);
    expect(calls).toHaveLength(1);

    const input = calls[0]!.args[0].input;
    expect(input.HostedZoneId).toBe('Z0123456789ABCDEF');

    const change = input.ChangeBatch?.Changes?.[0];
    expect(change?.Action).toBe('UPSERT');
    expect(change?.ResourceRecordSet?.Name).toBe('jarvis.backresto.com.');
    expect(change?.ResourceRecordSet?.Type).toBe('A');
    expect(change?.ResourceRecordSet?.TTL).toBe(300);
    expect(change?.ResourceRecordSet?.ResourceRecords?.[0]?.Value).toBe('203.0.113.42');
  });
});

describe('deleteDnsRecordAws', () => {
  const r53Mock = mockClient(Route53Client);
  beforeEach(() => r53Mock.reset());

  it('sends DELETE with the correct A record shape', async () => {
    r53Mock.on(ChangeResourceRecordSetsCommand).resolves({});

    const r53 = new Route53Client({ region: 'us-east-1' });
    await deleteDnsRecordAws(r53, 'Z0123456789ABCDEF', 'jarvis.backresto.com', '203.0.113.42');

    const calls = r53Mock.commandCalls(ChangeResourceRecordSetsCommand);
    expect(calls).toHaveLength(1);

    const input = calls[0]!.args[0].input;
    expect(input.HostedZoneId).toBe('Z0123456789ABCDEF');

    const change = input.ChangeBatch?.Changes?.[0];
    expect(change?.Action).toBe('DELETE');
    expect(change?.ResourceRecordSet?.Name).toBe('jarvis.backresto.com.');
    expect(change?.ResourceRecordSet?.Type).toBe('A');
    expect(change?.ResourceRecordSet?.TTL).toBe(300);
    expect(change?.ResourceRecordSet?.ResourceRecords?.[0]?.Value).toBe('203.0.113.42');
  });
});
