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
  /** When true, ports 80 and 443 are automatically added for nginx/ACME. */
  hasDomain?: boolean;
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

/**
 * Result of a successful adoption: the reconstructed ResourceLedger
 * (ready to persist into state.toml) plus the currently-reachable public
 * IP (if any), which the orchestrator needs to write `instance_ip` into
 * state alongside the ledger.
 */
export interface AdoptResult {
  ledger: ResourceLedger;
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
  /**
   * Reconstruct a ResourceLedger for a deployment whose state entry was
   * lost (e.g. the user moved to a new machine, or ~/.config/hermes-deploy
   * was wiped). Looks up cloud resources by their provision-time tag
   * markers (`managed-by=hermes-deploy` + `hermes-deploy/deployment=<name>`
   * on AWS; equivalent labels on GCP). Returns the rebuilt ledger and the
   * current public IP.
   *
   * Throws if no resources carrying the expected markers are found — the
   * caller should present a clear "no deployment named X found in this
   * cloud/region" error. The tag check is the safety rail: this method
   * must NEVER adopt resources that don't carry the hermes-deploy
   * provenance markers.
   */
  adopt(deploymentName: string): Promise<AdoptResult>;
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
