import type { ImageRef } from '../core.js';

/**
 * GCP NixOS image strategy: boot a Debian instance, then nixos-infect.
 *
 * nixos-cloud publishes NixOS GCE images, but they require
 * `compute.images.useReadOnly` permission on the `nixos-cloud` project
 * which ADC users don't have. Neither user credentials nor service
 * account impersonation grants this — it's a project-level IAM issue
 * on nixos-cloud's side.
 *
 * The standard NixOS community workaround is nixos-infect: boot a
 * stock Debian instance, then run a script that replaces the root
 * filesystem with NixOS and kexecs into it. hermes-deploy runs this
 * as a GCP-specific bootstrap step between "SSH ready" and "upload
 * config + nixos-rebuild" (see shared.ts).
 *
 * We return a Debian 12 family image here. The GCP provisioner creates
 * the instance with this image, and the orchestrator's GCP-specific
 * bootstrap path handles the nixos-infect + reboot before proceeding
 * with the normal flake-based configuration.
 */
const DEBIAN_PROJECT = 'debian-cloud';
const DEBIAN_FAMILY = 'debian-12';

export async function resolveNixosGceImage(
  _cacheFile: string,
): Promise<ImageRef> {
  const familyUrl = `projects/${DEBIAN_PROJECT}/global/images/family/${DEBIAN_FAMILY}`;
  return {
    id: familyUrl,
    description: `${DEBIAN_PROJECT}/${DEBIAN_FAMILY} (boots Debian, then nixos-infect converts to NixOS)`,
  };
}
