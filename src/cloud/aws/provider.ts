import { EC2Client } from '@aws-sdk/client-ec2';
import type {
  CloudProvider,
  ImageRef,
  Instance,
  InstanceStatus,
  Location,
  NetworkRules,
  ProvisionSpec,
  ResourceLedger,
} from '../core.js';
import { resolveNixosAmi } from './images.js';
import { provisionAws } from './provision.js';
import { reconcileNetworkAws } from './reconcile-network.js';
import { destroyAws } from './destroy.js';
import { statusAws } from './status.js';

export interface AwsProviderOptions {
  region: string;
  profile?: string;
  imageCacheFile: string;
}

export class AwsProvider implements CloudProvider {
  readonly name = 'aws' as const;
  private readonly ec2: EC2Client;

  constructor(private readonly opts: AwsProviderOptions) {
    if (opts.profile) process.env.AWS_PROFILE = opts.profile;
    this.ec2 = new EC2Client({ region: opts.region });
  }

  async resolveNixosImage(_loc: Location): Promise<ImageRef> {
    return resolveNixosAmi(this.ec2, this.opts.region, this.opts.imageCacheFile);
  }

  provision(spec: ProvisionSpec, ledger: ResourceLedger): Promise<Instance> {
    return provisionAws(this.ec2, spec, ledger);
  }

  reconcileNetwork(ledger: ResourceLedger, rules: NetworkRules): Promise<void> {
    return reconcileNetworkAws(this.ec2, ledger, rules);
  }

  destroy(ledger: ResourceLedger): Promise<void> {
    return destroyAws(this.ec2, ledger);
  }

  status(ledger: ResourceLedger): Promise<InstanceStatus> {
    return statusAws(this.ec2, ledger);
  }
}
