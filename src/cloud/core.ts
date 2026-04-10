import type { AwsResources, GcpResources } from '../schema/state-toml.js';

export type Size = 'small' | 'medium' | 'large';

export interface Location {
  region: string;
  zone?: string;
}

export interface ImageRef {
  id: string;       // ami-xxx or projects/.../images/...
  description: string;
}

export interface NetworkRules {
  sshAllowedFrom: string; // CIDR
  inboundPorts: number[];
}

export interface ProvisionSpec {
  deploymentName: string;
  location: Location;
  size: Size;
  diskGb: number;             // root volume size in GB
  image: ImageRef;
  publicSshKey: string;       // OpenSSH-format public key line
  networkRules: NetworkRules;
}

export interface Instance {
  publicIp: string;
  sshUser: string;            // 'root' for NixOS
}

export type ResourceLedger =
  | { kind: 'aws'; resources: Partial<AwsResources> }
  | { kind: 'gcp'; resources: Partial<GcpResources> };

export interface InstanceStatus {
  state: 'pending' | 'running' | 'shutting-down' | 'stopping' | 'stopped' | 'terminated' | 'unknown';
  publicIp: string | null;
}

export interface CloudProvider {
  readonly name: 'aws' | 'gcp';
  resolveNixosImage(loc: Location): Promise<ImageRef>;
  provision(spec: ProvisionSpec, ledger: ResourceLedger): Promise<Instance>;
  /**
   * Apply network rule changes in place, without recreating the instance.
   * Adds rules that aren't currently on the SG/firewall, removes rules that
   * are no longer required. Idempotent — safe to call when the rules
   * already match.
   */
  reconcileNetwork(ledger: ResourceLedger, rules: NetworkRules): Promise<void>;
  destroy(ledger: ResourceLedger): Promise<void>;
  status(ledger: ResourceLedger): Promise<InstanceStatus>;
}

export const SIZE_MAP_AWS: Record<Size, string> = {
  small: 't3.small',
  medium: 't3.medium',
  large: 't3.large',
};

export const SIZE_MAP_GCP: Record<Size, string> = {
  small: 'e2-small',        // 2 vCPU, 2 GB
  medium: 'e2-medium',      // 2 vCPU, 4 GB
  large: 'e2-standard-2',   // 2 vCPU, 8 GB
};
