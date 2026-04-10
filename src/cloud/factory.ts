import type { CloudProvider } from './core.js';
import { AwsProvider } from './aws/provider.js';
import { GcpProvider } from './gcp/provider.js';

export interface CreateProviderOptions {
  provider: 'aws' | 'gcp';
  region: string;
  zone?: string;
  profile?: string;
  imageCacheFile: string;
}

export function createCloudProvider(opts: CreateProviderOptions): CloudProvider {
  switch (opts.provider) {
    case 'aws':
      return new AwsProvider({
        region: opts.region,
        profile: opts.profile,
        imageCacheFile: opts.imageCacheFile,
      });
    case 'gcp':
      if (!opts.zone) {
        throw new Error('cloud.zone is required when provider = "gcp"');
      }
      return new GcpProvider({
        zone: opts.zone,
        project: opts.profile,  // GCP: hermes.toml profile = GCP project ID
        imageCacheFile: opts.imageCacheFile,
      });
  }
}
