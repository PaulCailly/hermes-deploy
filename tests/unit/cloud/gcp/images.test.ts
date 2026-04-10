import { describe, it, expect } from 'vitest';
import { resolveNixosGceImage } from '../../../../src/cloud/gcp/images.js';

describe('resolveNixosGceImage', () => {
  it('returns the NixOS family URL without making an API call', async () => {
    // No cache file needed — the function returns a constant family URL.
    // GCE resolves the family to the latest image at instance creation time.
    const ref = await resolveNixosGceImage('/dev/null');
    expect(ref.id).toBe('projects/nixos-cloud/global/images/family/nixos-25-11');
    expect(ref.description).toContain('nixos-cloud');
    expect(ref.description).toContain('nixos-25-11');
  });

  it('returns the same result regardless of cache state', async () => {
    const a = await resolveNixosGceImage('/dev/null');
    const b = await resolveNixosGceImage('/dev/null');
    expect(a.id).toBe(b.id);
  });
});
