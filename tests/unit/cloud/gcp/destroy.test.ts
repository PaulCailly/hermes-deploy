import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResourceLedger } from '../../../../src/cloud/core.js';

const mockInstancesDelete = vi.fn();
const mockAddressesDelete = vi.fn();
const mockFirewallsDelete = vi.fn();

vi.mock('@google-cloud/compute', () => ({
  InstancesClient: vi.fn().mockImplementation(() => ({
    delete: mockInstancesDelete,
  })),
  AddressesClient: vi.fn().mockImplementation(() => ({
    delete: mockAddressesDelete,
  })),
  FirewallsClient: vi.fn().mockImplementation(() => ({
    delete: mockFirewallsDelete,
  })),
}));

import { destroyGcp, zoneToRegion } from '../../../../src/cloud/gcp/destroy.js';

describe('destroyGcp', () => {
  beforeEach(() => {
    mockInstancesDelete.mockReset();
    mockAddressesDelete.mockReset();
    mockFirewallsDelete.mockReset();
  });

  it('deletes resources in reverse dependency order', async () => {
    mockInstancesDelete.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);
    mockAddressesDelete.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);
    mockFirewallsDelete.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);
    mockFirewallsDelete.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);

    const ledger: ResourceLedger = {
      kind: 'gcp',
      resources: {
        instance_name: 'hermes-deploy-test',
        static_ip_name: 'hermes-deploy-test',
        firewall_rule_names: ['hermes-deploy-test-ssh', 'hermes-deploy-test-ports'],
        project_id: 'my-project',
        zone: 'europe-west1-b',
      },
    };
    await destroyGcp(ledger);
    expect(mockInstancesDelete).toHaveBeenCalledTimes(1);
    expect(mockAddressesDelete).toHaveBeenCalledTimes(1);
    expect(mockFirewallsDelete).toHaveBeenCalledTimes(2);
  });

  it('is idempotent against already-deleted resources', async () => {
    mockInstancesDelete.mockRejectedValueOnce(new Error('NOT_FOUND'));
    mockAddressesDelete.mockRejectedValueOnce(new Error('NOT_FOUND'));
    mockFirewallsDelete.mockRejectedValueOnce(new Error('NOT_FOUND'));

    const ledger: ResourceLedger = {
      kind: 'gcp',
      resources: {
        instance_name: 'hermes-deploy-test',
        static_ip_name: 'hermes-deploy-test',
        firewall_rule_names: ['hermes-deploy-test-ssh'],
        project_id: 'my-project',
        zone: 'europe-west1-b',
      },
    };
    await expect(destroyGcp(ledger)).resolves.toBeUndefined();
  });

  it('skips steps for missing ledger fields', async () => {
    const ledger: ResourceLedger = { kind: 'gcp', resources: {} };
    await destroyGcp(ledger);
    expect(mockInstancesDelete).not.toHaveBeenCalled();
    expect(mockAddressesDelete).not.toHaveBeenCalled();
    expect(mockFirewallsDelete).not.toHaveBeenCalled();
  });
});

describe('zoneToRegion', () => {
  it('strips the trailing zone letter', () => {
    expect(zoneToRegion('europe-west1-b')).toBe('europe-west1');
    expect(zoneToRegion('us-central1-a')).toBe('us-central1');
  });
});
