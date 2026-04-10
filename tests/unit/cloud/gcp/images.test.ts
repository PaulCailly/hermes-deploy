import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockList = vi.fn();
vi.mock('@google-cloud/compute', () => ({
  ImagesClient: vi.fn().mockImplementation(() => ({ list: mockList })),
}));

import { resolveNixosGceImage } from '../../../../src/cloud/gcp/images.js';

describe('resolveNixosGceImage', () => {
  let cacheFile: string;

  beforeEach(() => {
    mockList.mockReset();
    cacheFile = join(mkdtempSync(join(tmpdir(), 'hermes-gcp-img-')), 'images.json');
  });

  afterEach(() => {
    if (existsSync(cacheFile)) rmSync(cacheFile, { recursive: true });
  });

  it('queries GCE images and returns the newest one', async () => {
    mockList.mockResolvedValueOnce([[
      { name: 'nixos-25-11-old', selfLink: 'projects/nixos-foundation-org/global/images/nixos-25-11-old', creationTimestamp: '2026-01-01T00:00:00Z' },
      { name: 'nixos-25-11-new', selfLink: 'projects/nixos-foundation-org/global/images/nixos-25-11-new', creationTimestamp: '2026-06-01T00:00:00Z' },
    ]]);
    const ref = await resolveNixosGceImage(cacheFile);
    expect(ref.id).toContain('nixos-25-11-new');
    expect(ref.description).toContain('nixos-25-11-new');
  });

  it('returns the cached value on a second call within TTL', async () => {
    mockList.mockResolvedValueOnce([[
      { name: 'nixos-25-11-cached', selfLink: 'projects/nixos-foundation-org/global/images/nixos-25-11-cached', creationTimestamp: '2026-06-01T00:00:00Z' },
    ]]);
    await resolveNixosGceImage(cacheFile);
    expect(mockList).toHaveBeenCalledTimes(1);
    await resolveNixosGceImage(cacheFile);
    expect(mockList).toHaveBeenCalledTimes(1); // not re-called
  });

  it('throws when no images are returned', async () => {
    mockList.mockResolvedValueOnce([[]]);
    await expect(resolveNixosGceImage(cacheFile)).rejects.toThrow(/no NixOS GCE image/);
  });
});
