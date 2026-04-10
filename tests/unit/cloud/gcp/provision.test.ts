import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProvisionSpec, ResourceLedger } from '../../../../src/cloud/core.js';

const mockAddressesInsert = vi.fn();
const mockAddressesGet = vi.fn();
const mockAddressesDelete = vi.fn();
const mockFirewallsInsert = vi.fn();
const mockFirewallsDelete = vi.fn();
const mockInstancesInsert = vi.fn();
const mockInstancesGet = vi.fn();
const mockInstancesDelete = vi.fn();

vi.mock('@google-cloud/compute', () => ({
  AddressesClient: vi.fn().mockImplementation(() => ({
    insert: mockAddressesInsert,
    get: mockAddressesGet,
    delete: mockAddressesDelete,
  })),
  FirewallsClient: vi.fn().mockImplementation(() => ({
    insert: mockFirewallsInsert,
    delete: mockFirewallsDelete,
  })),
  InstancesClient: vi.fn().mockImplementation(() => ({
    insert: mockInstancesInsert,
    get: mockInstancesGet,
    delete: mockInstancesDelete,
  })),
}));

import { provisionGcp } from '../../../../src/cloud/gcp/provision.js';

const spec: ProvisionSpec = {
  deploymentName: 'test',
  location: { region: 'europe-west1', zone: 'europe-west1-b' },
  size: 'large',
  diskGb: 30,
  image: { id: 'projects/nixos-foundation-org/global/images/nixos-img', description: 'nixos' },
  publicSshKey: 'ssh-ed25519 AAAA test',
  networkRules: { sshAllowedFrom: '203.0.113.1/32', inboundPorts: [443] },
};

describe('provisionGcp', () => {
  beforeEach(() => {
    mockAddressesInsert.mockReset();
    mockAddressesGet.mockReset();
    mockAddressesDelete.mockReset();
    mockFirewallsInsert.mockReset();
    mockFirewallsDelete.mockReset();
    mockInstancesInsert.mockReset();
    mockInstancesGet.mockReset();
    mockInstancesDelete.mockReset();
  });

  it('happy path: provisions all resources and returns instance', async () => {
    mockAddressesInsert.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);
    mockAddressesGet.mockResolvedValueOnce([{ address: '34.78.1.2' }]);
    mockFirewallsInsert.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]); // ssh rule
    mockFirewallsInsert.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]); // ports rule
    mockInstancesInsert.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);
    mockInstancesGet.mockResolvedValueOnce([{
      status: 'RUNNING',
      networkInterfaces: [{ accessConfigs: [{ natIP: '34.78.1.2' }] }],
    }]);

    const ledger: ResourceLedger = { kind: 'gcp', resources: {} };
    const instance = await provisionGcp('my-project', spec, ledger);

    expect(instance).toEqual({ publicIp: '34.78.1.2', sshUser: 'root' });

    // Verify ledger was populated
    expect(ledger.kind).toBe('gcp');
    if (ledger.kind === 'gcp') {
      expect(ledger.resources.instance_name).toBe('hermes-deploy-test');
      expect(ledger.resources.static_ip_name).toBe('hermes-deploy-test');
      expect(ledger.resources.firewall_rule_names).toEqual([
        'hermes-deploy-test-ssh',
        'hermes-deploy-test-ports',
      ]);
      expect(ledger.resources.project_id).toBe('my-project');
      expect(ledger.resources.zone).toBe('europe-west1-b');
    }

    // Verify SDK calls
    expect(mockAddressesInsert).toHaveBeenCalledTimes(1);
    expect(mockAddressesGet).toHaveBeenCalledTimes(1);
    expect(mockFirewallsInsert).toHaveBeenCalledTimes(2);
    expect(mockInstancesInsert).toHaveBeenCalledTimes(1);
    expect(mockInstancesGet).toHaveBeenCalledTimes(1);
  });

  it('rolls back on failure and throws CloudProvisionError', async () => {
    // Address reservation succeeds
    mockAddressesInsert.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);
    mockAddressesGet.mockResolvedValueOnce([{ address: '34.78.1.2' }]);
    // Firewall rules succeed
    mockFirewallsInsert.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]); // ssh
    mockFirewallsInsert.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]); // ports
    // Instance creation fails
    mockInstancesInsert.mockRejectedValueOnce(new Error('QUOTA_EXCEEDED'));

    // Rollback mocks (destroy will attempt to clean up what was recorded)
    mockInstancesDelete.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);
    mockAddressesDelete.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);
    mockFirewallsDelete.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);
    mockFirewallsDelete.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);

    const ledger: ResourceLedger = { kind: 'gcp', resources: {} };

    await expect(provisionGcp('my-project', spec, ledger)).rejects.toThrow(/QUOTA_EXCEEDED/);

    // Rollback should have called delete on the address and firewall rules
    expect(mockAddressesDelete).toHaveBeenCalled();
    expect(mockFirewallsDelete).toHaveBeenCalled();
  });
});
