import { describe, it, expect } from 'vitest';
import { detectPublicIp } from '../../../../src/cloud/aws/public-ip.js';

describe('detectPublicIp', () => {
  it('returns a CIDR ending in /32 when given a public IP', async () => {
    const result = await detectPublicIp(async () => '203.0.113.42');
    expect(result).toBe('203.0.113.42/32');
  });

  it('throws on a syntactically invalid response', async () => {
    await expect(detectPublicIp(async () => 'not an ip')).rejects.toThrow(/invalid/);
  });
});
