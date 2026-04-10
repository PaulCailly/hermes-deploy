import type { ImageRef } from '../core.js';

/**
 * For GCP, NixOS publishes community images under the `nixos-cloud`
 * project with image families like `nixos-25-11`. Unlike AWS (where we
 * call DescribeImages to find the latest AMI), GCP lets us reference
 * images by family URL directly in the instance creation call — GCE
 * resolves the family to the latest image at creation time.
 *
 * This avoids the IAM issue where `compute.images.list` and
 * `compute.images.getFromFamily` require permissions on the
 * `nixos-cloud` project that ADC users don't have by default.
 * Using the family URL in `sourceImage` only needs
 * `compute.instances.create` on YOUR project, which is always granted.
 *
 * No API call, no cache needed. The "resolution" is a constant string.
 */
const NIXOS_GCE_PROJECT = 'nixos-cloud';
const NIXOS_GCE_FAMILY = 'nixos-25-11';

export async function resolveNixosGceImage(
  _cacheFile: string,
): Promise<ImageRef> {
  const familyUrl = `projects/${NIXOS_GCE_PROJECT}/global/images/family/${NIXOS_GCE_FAMILY}`;
  return {
    id: familyUrl,
    description: `${NIXOS_GCE_PROJECT}/${NIXOS_GCE_FAMILY} (family, resolved at instance creation)`,
  };
}
