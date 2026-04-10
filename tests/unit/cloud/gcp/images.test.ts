import { describe, it, expect } from 'vitest';
import { resolveNixosGceImage } from '../../../../src/cloud/gcp/images.js';

describe('resolveNixosGceImage', () => {
  it('returns a Debian family URL (nixos-infect converts to NixOS post-boot)', async () => {
    // nixos-cloud images are not publicly usable (403 on
    // compute.images.useReadOnly). The workaround is to boot Debian
    // and run nixos-infect. The image resolver returns Debian; the
    // orchestrator handles the nixos-infect step.
    const ref = await resolveNixosGceImage('/dev/null');
    expect(ref.id).toBe('projects/debian-cloud/global/images/family/debian-12');
    expect(ref.description).toContain('debian');
    expect(ref.description).toContain('nixos-infect');
  });

  it('returns the same result regardless of cache state', async () => {
    const a = await resolveNixosGceImage('/dev/null');
    const b = await resolveNixosGceImage('/dev/null');
    expect(a.id).toBe(b.id);
  });
});
