import { describe, it, expect, vi } from 'vitest';

// Mock node:dns/promises before importing the module
vi.mock('node:dns/promises', () => ({
  resolve4: vi.fn(),
}));

// Mock node:tls to avoid real network calls
vi.mock('node:tls', () => ({
  default: {
    connect: vi.fn((_port: number, _host: string, _opts: any, _connectCb?: Function) => {
      const events: Record<string, Function> = {};
      const socket = {
        on: vi.fn((event: string, cb: Function) => { events[event] = cb; }),
        setTimeout: vi.fn(),
        getPeerCertificate: vi.fn(() => null),
        end: vi.fn(),
        destroy: vi.fn(),
      };
      // Trigger the error event asynchronously so getTlsCert resolves via the error handler
      setTimeout(() => events['error']?.(new Error('mocked tls error')), 0);
      return socket;
    }),
  },
}));

// Mock node:https to avoid real network calls
vi.mock('node:https', () => ({
  default: {
    get: vi.fn((_url: string, _opts: any, _cb: Function) => {
      // Simulate connection error by default
      const events: Record<string, Function> = {};
      const req = {
        on: vi.fn((event: string, handler: Function) => { events[event] = handler; }),
        destroy: vi.fn(),
      };
      // Call error handler asynchronously
      setTimeout(() => events['error']?.(new Error('mocked')), 0);
      return req;
    }),
  },
}));

import { runExternalDomainChecks } from '../../../src/domain/external-check.js';
import { resolve4 } from 'node:dns/promises';

describe('runExternalDomainChecks', () => {
  it('reports DNS match when resolved IP matches expected', async () => {
    vi.mocked(resolve4).mockResolvedValue(['13.39.38.162']);
    const result = await runExternalDomainChecks('jarvis.backresto.com', '13.39.38.162');
    expect(result.dns.ok).toBe(true);
    expect(result.dns.resolvedIp).toBe('13.39.38.162');
    expect(result.dns.matches).toBe(true);
  });

  it('reports DNS mismatch when IP differs', async () => {
    vi.mocked(resolve4).mockResolvedValue(['1.2.3.4']);
    const result = await runExternalDomainChecks('jarvis.backresto.com', '13.39.38.162');
    expect(result.dns.ok).toBe(true);
    expect(result.dns.matches).toBe(false);
  });

  it('reports DNS failure when resolution fails', async () => {
    vi.mocked(resolve4).mockRejectedValue(new Error('ENOTFOUND'));
    const result = await runExternalDomainChecks('bad.example.com', '1.2.3.4');
    expect(result.dns.ok).toBe(false);
    expect(result.dns.resolvedIp).toBeNull();
  });
});
