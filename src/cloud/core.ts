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
  state: 'pending' | 'running' | 'stopping' | 'stopped' | 'terminated' | 'unknown';
  publicIp: string | null;
}

export interface CloudProvider {
  readonly name: 'aws' | 'gcp';
  resolveNixosImage(loc: Location): Promise<ImageRef>;
  provision(spec: ProvisionSpec, ledger: ResourceLedger): Promise<Instance>;
  destroy(ledger: ResourceLedger): Promise<void>;
  status(ledger: ResourceLedger): Promise<InstanceStatus>;
}

export const SIZE_MAP_AWS: Record<Size, string> = {
  small: 't3.small',
  medium: 't3.medium',
  large: 't3.large',
};
