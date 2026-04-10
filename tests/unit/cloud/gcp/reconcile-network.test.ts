import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResourceLedger } from '../../../../src/cloud/core.js';

const mockFirewallsGet = vi.fn();
const mockFirewallsPatch = vi.fn();
const mockFirewallsInsert = vi.fn();
const mockFirewallsDelete = vi.fn();

const mockOpsWait = vi.fn().mockResolvedValue([{ done: true }]);

vi.mock('@google-cloud/compute', () => ({
  FirewallsClient: vi.fn().mockImplementation(() => ({
    get: mockFirewallsGet,
    patch: mockFirewallsPatch,
    insert: mockFirewallsInsert,
    delete: mockFirewallsDelete,
  })),
  GlobalOperationsClient: vi.fn().mockImplementation(() => ({ wait: mockOpsWait })),
}));

import { reconcileNetworkGcp } from '../../../../src/cloud/gcp/reconcile-network.js';

describe('reconcileNetworkGcp', () => {
  beforeEach(() => {
    mockFirewallsGet.mockReset();
    mockFirewallsPatch.mockReset();
    mockFirewallsInsert.mockReset();
    mockFirewallsDelete.mockReset();
  });

  const makeLedger = (ruleNames: string[]): ResourceLedger => ({
    kind: 'gcp',
    resources: {
      instance_name: 'hermes-deploy-test',
      project_id: 'my-project',
      zone: 'europe-west1-b',
      firewall_rule_names: ruleNames,
    },
  });

  it('patches the SSH rule when the CIDR changes', async () => {
    mockFirewallsGet.mockResolvedValueOnce([{
      name: 'hermes-deploy-test-ssh',
      allowed: [{ IPProtocol: 'tcp', ports: ['22'] }],
      sourceRanges: ['1.1.1.1/32'],
    }]);
    mockFirewallsPatch.mockResolvedValueOnce([{ name: 'op-mock' }]);

    await reconcileNetworkGcp(makeLedger(['hermes-deploy-test-ssh']), {
      sshAllowedFrom: '2.2.2.2/32',
      inboundPorts: [],
    });

    expect(mockFirewallsPatch).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when rules already match', async () => {
    mockFirewallsGet.mockResolvedValueOnce([{
      name: 'hermes-deploy-test-ssh',
      allowed: [{ IPProtocol: 'tcp', ports: ['22'] }],
      sourceRanges: ['1.2.3.4/32'],
    }]);

    await reconcileNetworkGcp(makeLedger(['hermes-deploy-test-ssh']), {
      sshAllowedFrom: '1.2.3.4/32',
      inboundPorts: [],
    });

    expect(mockFirewallsPatch).not.toHaveBeenCalled();
    expect(mockFirewallsInsert).not.toHaveBeenCalled();
    expect(mockFirewallsDelete).not.toHaveBeenCalled();
  });

  it('creates a ports rule when inboundPorts are added', async () => {
    mockFirewallsGet.mockResolvedValueOnce([{
      sourceRanges: ['1.2.3.4/32'],
    }]);
    mockFirewallsInsert.mockResolvedValueOnce([{ name: 'op-mock' }]);

    const ledger = makeLedger(['hermes-deploy-test-ssh']);
    await reconcileNetworkGcp(ledger, {
      sshAllowedFrom: '1.2.3.4/32',
      inboundPorts: [443, 8080],
    });

    expect(mockFirewallsInsert).toHaveBeenCalledTimes(1);
    if (ledger.kind === 'gcp') {
      expect(ledger.resources.firewall_rule_names).toContain('hermes-deploy-test-ports');
    }
  });
});
