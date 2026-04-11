import { execFileSync } from 'node:child_process';
import type {
  AdoptResult,
  CloudProvider,
  ImageRef,
  Instance,
  InstanceStatus,
  Location,
  NetworkRules,
  ProvisionSpec,
  ResourceLedger,
} from '../core.js';
import { resolveNixosGceImage } from './images.js';
import { provisionGcp } from './provision.js';
import { reconcileNetworkGcp } from './reconcile-network.js';
import { destroyGcp } from './destroy.js';
import { statusGcp } from './status.js';
import { adoptGcp } from './adopt.js';

export interface GcpProviderOptions {
  zone: string;
  project?: string;
  imageCacheFile: string;
}

export class GcpProvider implements CloudProvider {
  readonly name = 'gcp' as const;
  private resolvedProject: string | undefined;

  constructor(private readonly opts: GcpProviderOptions) {
    this.resolvedProject = opts.project;
  }

  private async getProject(): Promise<string> {
    if (this.resolvedProject) return this.resolvedProject;

    if (process.env.GOOGLE_CLOUD_PROJECT) {
      this.resolvedProject = process.env.GOOGLE_CLOUD_PROJECT;
      return this.resolvedProject;
    }

    try {
      const result = execFileSync('gcloud', ['config', 'get-value', 'project'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      if (result && result !== '(unset)') {
        this.resolvedProject = result;
        return this.resolvedProject;
      }
    } catch {
      // gcloud not installed or not configured
    }

    throw new Error(
      'Could not determine GCP project. Set GOOGLE_CLOUD_PROJECT env var or run `gcloud config set project <id>`.',
    );
  }

  async resolveNixosImage(_loc: Location): Promise<ImageRef> {
    return resolveNixosGceImage(this.opts.imageCacheFile);
  }

  async provision(spec: ProvisionSpec, ledger: ResourceLedger): Promise<Instance> {
    const project = await this.getProject();
    return provisionGcp(project, spec, ledger);
  }

  async reconcileNetwork(ledger: ResourceLedger, rules: NetworkRules): Promise<void> {
    return reconcileNetworkGcp(ledger, rules);
  }

  destroy(ledger: ResourceLedger): Promise<void> {
    return destroyGcp(ledger);
  }

  status(ledger: ResourceLedger): Promise<InstanceStatus> {
    return statusGcp(ledger);
  }

  async adopt(deploymentName: string): Promise<AdoptResult> {
    const project = await this.getProject();
    return adoptGcp(project, this.opts.zone, deploymentName);
  }
}
