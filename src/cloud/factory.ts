import type { CloudProvider } from './core.js';
import { AwsProvider } from './aws/provider.js';

export interface CreateProviderOptions {
  provider: 'aws' | 'gcp';
  region: string;
  profile?: string;
  imageCacheFile: string;
}

/**
 * Construct a CloudProvider for the given cloud + region. M1 supports
 * `aws` only. M3 will add the `gcp` branch when GcpProvider lands.
 */
export function createCloudProvider(opts: CreateProviderOptions): CloudProvider {
  switch (opts.provider) {
    case 'aws':
      return new AwsProvider({
        region: opts.region,
        profile: opts.profile,
        imageCacheFile: opts.imageCacheFile,
      });
    case 'gcp':
      throw new Error('M1 does not support GCP yet — coming in M3');
  }
}
