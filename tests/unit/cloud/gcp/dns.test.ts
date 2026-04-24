import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetZones, mockCreateChange, mockGetRecords, mockRecord } = vi.hoisted(() => ({
  mockGetZones: vi.fn(),
  mockCreateChange: vi.fn(),
  mockGetRecords: vi.fn(),
  mockRecord: vi.fn(),
}));

vi.mock('@google-cloud/dns', () => ({
  DNS: vi.fn().mockImplementation(() => ({
    getZones: mockGetZones,
    zone: vi.fn((name: string) => ({
      name,
      createChange: mockCreateChange,
      getRecords: mockGetRecords,
      record: mockRecord,
    })),
  })),
}));

import {
  findManagedZoneGcp,
  upsertDnsRecordGcp,
  deleteDnsRecordGcp,
} from '../../../../src/cloud/gcp/dns.js';

describe('findManagedZoneGcp', () => {
  beforeEach(() => {
    mockGetZones.mockReset();
  });

  it('finds matching zone by walking up domain labels', async () => {
    mockGetZones.mockResolvedValue([
      [
        { name: 'backresto-com', metadata: { dnsName: 'backresto.com.' } },
        { name: 'other-org', metadata: { dnsName: 'other.org.' } },
      ],
    ]);

    const result = await findManagedZoneGcp('my-project', 'jarvis.backresto.com');

    expect(result).toEqual({ zoneName: 'backresto-com', dnsName: 'backresto.com.' });
  });

  it('throws when no matching zone is found', async () => {
    mockGetZones.mockResolvedValue([
      [
        { name: 'other-org', metadata: { dnsName: 'other.org.' } },
      ],
    ]);

    await expect(
      findManagedZoneGcp('my-project', 'jarvis.backresto.com'),
    ).rejects.toThrow('No managed zone found for "jarvis.backresto.com" in GCP project "my-project"');
  });
});

describe('upsertDnsRecordGcp', () => {
  beforeEach(() => {
    mockGetRecords.mockReset();
    mockCreateChange.mockReset();
    mockRecord.mockReset();
  });

  it('creates A record when none exists', async () => {
    const fakeRecord = { name: 'jarvis.backresto.com.', type: 'A', ttl: 300, data: ['1.2.3.4'] };
    mockGetRecords.mockResolvedValue([[]]);
    mockCreateChange.mockResolvedValue([{}]);
    mockRecord.mockReturnValue(fakeRecord);

    await upsertDnsRecordGcp('my-project', 'backresto-com', 'jarvis.backresto.com', '1.2.3.4');

    expect(mockGetRecords).toHaveBeenCalledWith({ name: 'jarvis.backresto.com.', type: 'A' });
    expect(mockRecord).toHaveBeenCalledWith('a', { name: 'jarvis.backresto.com.', ttl: 300, data: '1.2.3.4' });
    expect(mockCreateChange).toHaveBeenCalledWith({
      add: fakeRecord,
    });
  });

  it('replaces existing A record when one exists', async () => {
    const existingRecord = { name: 'jarvis.backresto.com.', type: 'A', ttl: 300, data: ['9.9.9.9'] };
    const fakeRecord = { name: 'jarvis.backresto.com.', type: 'A', ttl: 300, data: ['1.2.3.4'] };
    mockGetRecords.mockResolvedValue([[existingRecord]]);
    mockCreateChange.mockResolvedValue([{}]);
    mockRecord.mockReturnValue(fakeRecord);

    await upsertDnsRecordGcp('my-project', 'backresto-com', 'jarvis.backresto.com', '1.2.3.4');

    expect(mockCreateChange).toHaveBeenCalledWith({
      delete: [existingRecord],
      add: fakeRecord,
    });
  });
});

describe('deleteDnsRecordGcp', () => {
  beforeEach(() => {
    mockGetRecords.mockReset();
    mockCreateChange.mockReset();
  });

  it('deletes existing A record', async () => {
    const existingRecord = { name: 'jarvis.backresto.com.', type: 'A', ttl: 300, data: ['1.2.3.4'] };
    mockGetRecords.mockResolvedValue([[existingRecord]]);
    mockCreateChange.mockResolvedValue([{}]);

    await deleteDnsRecordGcp('my-project', 'backresto-com', 'jarvis.backresto.com');

    expect(mockGetRecords).toHaveBeenCalledWith({ name: 'jarvis.backresto.com.', type: 'A' });
    expect(mockCreateChange).toHaveBeenCalledWith({ delete: [existingRecord] });
  });

  it('does nothing when no record exists', async () => {
    mockGetRecords.mockResolvedValue([[]]);

    await deleteDnsRecordGcp('my-project', 'backresto-com', 'jarvis.backresto.com');

    expect(mockCreateChange).not.toHaveBeenCalled();
  });
});
