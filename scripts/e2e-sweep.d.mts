/**
 * TypeScript declaration for scripts/e2e-sweep.mjs.
 *
 * The sweep script itself is plain ES module JavaScript so it runs
 * directly under `node scripts/e2e-sweep.mjs` in CI without a
 * compile step. This sidecar declaration gives the unit tests (and
 * any future library consumers) type safety on the exported helpers
 * without having to enable `allowJs`/`checkJs` project-wide.
 *
 * Keep the shapes here in sync with the JSDoc types in the .mjs file.
 */

import type { EC2Client } from '@aws-sdk/client-ec2';
import type {
  InstancesClient,
  AddressesClient,
  FirewallsClient,
} from '@google-cloud/compute';

export interface SweepReport {
  swept: number;
  skipped: number;
  errors: number;
  notes: string[];
}

export interface EligibilityDecision {
  eligible: boolean;
  reason?: string;
  deploymentName?: string;
}

export function isOlderThan(
  createdAt: Date | string | number | null | undefined,
  hours: number,
  now?: Date,
): boolean;

export function getTagValue(
  tags: Array<{ Key?: string; Value?: string }> | undefined,
  key: string,
): string | undefined;

export function isAwsSweepEligible(params: {
  tags: Array<{ Key?: string; Value?: string }> | undefined;
  createdAt: Date | string | null | undefined;
  maxAgeHours: number;
  now?: Date;
}): EligibilityDecision;

export function isGcpSweepEligible(params: {
  labels: Record<string, string> | null | undefined;
  creationTimestamp: string | null | undefined;
  maxAgeHours: number;
  now?: Date;
}): EligibilityDecision;

export function parseArgs(argv: string[]): Record<string, string | true>;

export function sweepAws(params: {
  ec2: EC2Client;
  region: string;
  maxAgeHours: number;
  dryRun: boolean;
  now?: Date;
}): Promise<SweepReport>;

export function sweepGcp(params: {
  project: string;
  zone: string;
  maxAgeHours: number;
  dryRun: boolean;
  now?: Date;
  instancesClient?: InstancesClient;
  addressesClient?: AddressesClient;
  firewallsClient?: FirewallsClient;
}): Promise<SweepReport>;
