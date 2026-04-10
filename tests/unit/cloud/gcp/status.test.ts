import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
vi.mock('@google-cloud/compute', () => ({
  InstancesClient: vi.fn().mockImplementation(() => ({ get: mockGet })),
}));

import { statusGcp } from '../../../../src/cloud/gcp/status.js';
import type { ResourceLedger } from '../../../../src/cloud/core.js';

describe('statusGcp', () => {
  beforeEach(() => mockGet.mockReset());

  it('returns running and the public ip', async () => {
    mockGet.mockResolvedValueOnce([{
      status: 'RUNNING',
      networkInterfaces: [{ accessConfigs: [{ natIP: '34.78.1.2' }] }],
    }]);
    const ledger: ResourceLedger = {
      kind: 'gcp',
      resources: { instance_name: 'i-1', project_id: 'p', zone: 'z' },
    };
    const result = await statusGcp(ledger);
    expect(result.state).toBe('running');
    expect(result.publicIp).toBe('34.78.1.2');
  });

  it('returns unknown if instance_name is missing', async () => {
    const ledger: ResourceLedger = { kind: 'gcp', resources: { project_id: 'p', zone: 'z' } };
    const result = await statusGcp(ledger);
    expect(result.state).toBe('unknown');
    expect(result.publicIp).toBeNull();
  });
});
