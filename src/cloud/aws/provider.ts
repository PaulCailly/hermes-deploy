import { EC2Client } from '@aws-sdk/client-ec2';
import { Route53Client } from '@aws-sdk/client-route-53';
import type {
  AdoptResult,
  CloudProvider,
  DnsRecord,
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
import { adoptAws } from './adopt.js';
import { findHostedZoneAws, upsertDnsRecordAws, deleteDnsRecordAws } from './dns.js';

export interface AwsProviderOptions {
  region: string;
  profile?: string;
  imageCacheFile: string;
}

export class AwsProvider implements CloudProvider {
  readonly name = 'aws' as const;
  private readonly ec2: EC2Client;
  private readonly r53: Route53Client;

  constructor(private readonly opts: AwsProviderOptions) {
    if (opts.profile) process.env.AWS_PROFILE = opts.profile;
    this.ec2 = new EC2Client({ region: opts.region });
    this.r53 = new Route53Client({ region: opts.region });
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

  adopt(deploymentName: string): Promise<AdoptResult> {
    return adoptAws(this.ec2, deploymentName, this.opts.region);
  }

  async upsertDnsRecord(fqdn: string, ip: string): Promise<DnsRecord> {
    const zone = await findHostedZoneAws(this.r53, fqdn);
    await upsertDnsRecordAws(this.r53, zone.zoneId, fqdn, ip);
    return { zoneId: zone.zoneId, fqdn };
  }

  async deleteDnsRecord(record: DnsRecord, ip: string): Promise<void> {
    try {
      await deleteDnsRecordAws(this.r53, record.zoneId, record.fqdn, ip);
    } catch {
      // Best-effort cleanup
    }
  }
}
