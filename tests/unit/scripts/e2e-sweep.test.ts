import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeSecurityGroupsCommand,
  DescribeKeyPairsCommand,
  DescribeAddressesCommand,
  TerminateInstancesCommand,
  DeleteSecurityGroupCommand,
  DeleteKeyPairCommand,
  ReleaseAddressCommand,
} from '@aws-sdk/client-ec2';

// scripts/e2e-sweep.mjs is plain ESM JavaScript with JSDoc types.
// TypeScript resolves it via the sidecar scripts/e2e-sweep.d.mts
// declaration file.
import {
  isOlderThan,
  getTagValue,
  isAwsSweepEligible,
  isGcpSweepEligible,
  parseArgs,
  sweepAws,
} from '../../../scripts/e2e-sweep.mjs';

/**
 * Tests for the E2E cleanup script. We cover:
 *
 *   1. The three safety-rail predicates (provenance tag, e2e prefix,
 *      age threshold) as pure functions.
 *   2. parseArgs — lightweight enough that a misbehaving arg parser
 *      would make the CI workflow silently wrong.
 *   3. sweepAws end-to-end against aws-sdk-client-mock. Verifies
 *      that (a) only eligible resources are terminated, (b) the
 *      age threshold is honored, (c) the e2e prefix filter blocks
 *      non-e2e deployments, and (d) dry-run does not call any
 *      mutation commands.
 */

const NOW = new Date('2026-04-11T12:00:00Z');
const TWO_HOURS_AGO = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
const FIVE_HOURS_AGO = new Date(NOW.getTime() - 5 * 60 * 60 * 1000);

describe('isOlderThan', () => {
  it('returns true when the timestamp is older than the threshold', () => {
    expect(isOlderThan(FIVE_HOURS_AGO, 4, NOW)).toBe(true);
  });
  it('returns false when the timestamp is younger than the threshold', () => {
    expect(isOlderThan(TWO_HOURS_AGO, 4, NOW)).toBe(false);
  });
  it('returns false when createdAt is null/undefined/invalid', () => {
    expect(isOlderThan(null, 4, NOW)).toBe(false);
    expect(isOlderThan(undefined, 4, NOW)).toBe(false);
    expect(isOlderThan('not-a-date', 4, NOW)).toBe(false);
  });
  it('accepts RFC3339 strings (GCP creationTimestamp format)', () => {
    expect(isOlderThan('2026-04-11T06:00:00Z', 4, NOW)).toBe(true);
    expect(isOlderThan('2026-04-11T11:30:00Z', 4, NOW)).toBe(false);
  });
  it('accepts epoch numbers', () => {
    expect(isOlderThan(FIVE_HOURS_AGO.getTime(), 4, NOW)).toBe(true);
  });
});

describe('getTagValue', () => {
  it('returns the value for a matching key', () => {
    expect(
      getTagValue(
        [
          { Key: 'managed-by', Value: 'hermes-deploy' },
          { Key: 'other', Value: 'x' },
        ],
        'managed-by',
      ),
    ).toBe('hermes-deploy');
  });
  it('returns undefined for missing keys', () => {
    expect(getTagValue([], 'managed-by')).toBeUndefined();
    expect(getTagValue(undefined, 'managed-by')).toBeUndefined();
  });
});

describe('isAwsSweepEligible', () => {
  const commonTags = [
    { Key: 'managed-by', Value: 'hermes-deploy' },
    { Key: 'hermes-deploy/deployment', Value: 'e2e-12345-abc' },
  ];

  it('passes all three rails when everything matches', () => {
    const result = isAwsSweepEligible({
      tags: commonTags,
      createdAt: FIVE_HOURS_AGO,
      maxAgeHours: 4,
      now: NOW,
    });
    expect(result.eligible).toBe(true);
    expect(result.deploymentName).toBe('e2e-12345-abc');
  });

  it('fails rail 1 when managed-by tag is missing', () => {
    const result = isAwsSweepEligible({
      tags: [{ Key: 'hermes-deploy/deployment', Value: 'e2e-x' }],
      createdAt: FIVE_HOURS_AGO,
      maxAgeHours: 4,
      now: NOW,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/managed-by/);
  });

  it('fails rail 1 when managed-by tag has the wrong value', () => {
    const result = isAwsSweepEligible({
      tags: [
        { Key: 'managed-by', Value: 'terraform' },
        { Key: 'hermes-deploy/deployment', Value: 'e2e-x' },
      ],
      createdAt: FIVE_HOURS_AGO,
      maxAgeHours: 4,
      now: NOW,
    });
    expect(result.eligible).toBe(false);
  });

  it('fails rail 2 when deployment name does not start with "e2e-"', () => {
    const result = isAwsSweepEligible({
      tags: [
        { Key: 'managed-by', Value: 'hermes-deploy' },
        { Key: 'hermes-deploy/deployment', Value: 'production-bot' },
      ],
      createdAt: FIVE_HOURS_AGO,
      maxAgeHours: 4,
      now: NOW,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/does not start with "e2e-"/);
    expect(result.deploymentName).toBe('production-bot');
  });

  it('fails rail 2 when the deployment tag is missing entirely', () => {
    const result = isAwsSweepEligible({
      tags: [{ Key: 'managed-by', Value: 'hermes-deploy' }],
      createdAt: FIVE_HOURS_AGO,
      maxAgeHours: 4,
      now: NOW,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/\(unset\)/);
  });

  it('fails rail 3 when resource is younger than the threshold', () => {
    const result = isAwsSweepEligible({
      tags: commonTags,
      createdAt: TWO_HOURS_AGO,
      maxAgeHours: 4,
      now: NOW,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/last 4h/);
  });
});

describe('isGcpSweepEligible', () => {
  it('passes when label + prefix + age all match', () => {
    const result = isGcpSweepEligible({
      labels: {
        'managed-by': 'hermes-deploy',
        'hermes-deploy-deployment': 'e2e-abc',
      },
      creationTimestamp: FIVE_HOURS_AGO.toISOString(),
      maxAgeHours: 4,
      now: NOW,
    });
    expect(result.eligible).toBe(true);
    expect(result.deploymentName).toBe('e2e-abc');
  });

  it('rejects non-hermes resources', () => {
    const result = isGcpSweepEligible({
      labels: { 'managed-by': 'pulumi' },
      creationTimestamp: FIVE_HOURS_AGO.toISOString(),
      maxAgeHours: 4,
      now: NOW,
    });
    expect(result.eligible).toBe(false);
  });

  it('rejects non-e2e deployments even when hermes-owned', () => {
    const result = isGcpSweepEligible({
      labels: {
        'managed-by': 'hermes-deploy',
        'hermes-deploy-deployment': 'client-acme',
      },
      creationTimestamp: FIVE_HOURS_AGO.toISOString(),
      maxAgeHours: 4,
      now: NOW,
    });
    expect(result.eligible).toBe(false);
    expect(result.deploymentName).toBe('client-acme');
  });

  it('rejects recent resources', () => {
    const result = isGcpSweepEligible({
      labels: {
        'managed-by': 'hermes-deploy',
        'hermes-deploy-deployment': 'e2e-new',
      },
      creationTimestamp: TWO_HOURS_AGO.toISOString(),
      maxAgeHours: 4,
      now: NOW,
    });
    expect(result.eligible).toBe(false);
  });
});

describe('parseArgs', () => {
  it('parses --flag=value form', () => {
    expect(parseArgs(['--cloud=aws', '--region=us-east-1'])).toEqual({
      cloud: 'aws',
      region: 'us-east-1',
    });
  });
  it('parses --flag value form', () => {
    expect(parseArgs(['--cloud', 'gcp', '--project', 'myproj'])).toEqual({
      cloud: 'gcp',
      project: 'myproj',
    });
  });
  it('treats a lone --flag as a boolean true', () => {
    expect(parseArgs(['--dry-run', '--cloud', 'aws'])).toEqual({
      'dry-run': true,
      cloud: 'aws',
    });
  });
  it('ignores unknown positional arguments', () => {
    expect(parseArgs(['unused', '--cloud=aws'])).toEqual({ cloud: 'aws' });
  });
});

describe('sweepAws (end-to-end, mocked)', () => {
  const ec2Mock = mockClient(EC2Client);
  beforeEach(() => ec2Mock.reset());

  // Mark the enum strings as `as const` so TypeScript narrows them
  // to the AWS SDK's `InstanceStateName` union rather than plain
  // `string` when the fixtures are passed into `resolves({...})`.
  const staleInstance = {
    InstanceId: 'i-stale',
    LaunchTime: FIVE_HOURS_AGO,
    State: { Name: 'running' as const },
    Tags: [
      { Key: 'managed-by', Value: 'hermes-deploy' },
      { Key: 'hermes-deploy/deployment', Value: 'e2e-stale' },
    ],
  };
  const freshInstance = {
    InstanceId: 'i-fresh',
    LaunchTime: TWO_HOURS_AGO,
    State: { Name: 'running' as const },
    Tags: [
      { Key: 'managed-by', Value: 'hermes-deploy' },
      { Key: 'hermes-deploy/deployment', Value: 'e2e-fresh' },
    ],
  };
  const productionInstance = {
    InstanceId: 'i-prod',
    LaunchTime: FIVE_HOURS_AGO,
    State: { Name: 'running' as const },
    Tags: [
      { Key: 'managed-by', Value: 'hermes-deploy' },
      { Key: 'hermes-deploy/deployment', Value: 'production-acme' },
    ],
  };

  it('terminates only the stale e2e instance, leaving fresh + production alone', async () => {
    ec2Mock.on(DescribeInstancesCommand).resolves({
      Reservations: [
        { Instances: [staleInstance, freshInstance, productionInstance] },
      ],
    });
    ec2Mock.on(DescribeSecurityGroupsCommand).resolves({ SecurityGroups: [] });
    ec2Mock.on(DescribeKeyPairsCommand).resolves({ KeyPairs: [] });
    ec2Mock.on(DescribeAddressesCommand).resolves({ Addresses: [] });
    ec2Mock.on(TerminateInstancesCommand).resolves({});

    const report = await sweepAws({
      ec2: ec2Mock as unknown as EC2Client,
      region: 'us-east-1',
      maxAgeHours: 4,
      dryRun: true, // avoid the waitUntilInstanceTerminated call
      now: NOW,
    });

    expect(report.swept).toBe(1);
    expect(report.skipped).toBe(2);
    expect(report.errors).toBe(0);
    expect(report.notes.some((n: string) => n.includes('TERMINATE instance i-stale'))).toBe(true);
    expect(report.notes.some((n: string) => n.includes('SKIP instance i-fresh'))).toBe(true);
    expect(report.notes.some((n: string) => n.includes('SKIP instance i-prod'))).toBe(true);
  });

  it('does not call any mutation commands in dry-run mode', async () => {
    ec2Mock.on(DescribeInstancesCommand).resolves({
      Reservations: [{ Instances: [staleInstance] }],
    });
    ec2Mock.on(DescribeSecurityGroupsCommand).resolves({
      SecurityGroups: [
        {
          GroupId: 'sg-1',
          Tags: [
            { Key: 'managed-by', Value: 'hermes-deploy' },
            { Key: 'hermes-deploy/deployment', Value: 'e2e-stale' },
          ],
        },
      ],
    });
    ec2Mock.on(DescribeKeyPairsCommand).resolves({
      KeyPairs: [
        {
          KeyName: 'hermes-deploy-e2e-stale',
          CreateTime: FIVE_HOURS_AGO,
          Tags: [
            { Key: 'managed-by', Value: 'hermes-deploy' },
            { Key: 'hermes-deploy/deployment', Value: 'e2e-stale' },
          ],
        },
      ],
    });
    ec2Mock.on(DescribeAddressesCommand).resolves({
      Addresses: [
        {
          AllocationId: 'eipalloc-1',
          Tags: [
            { Key: 'managed-by', Value: 'hermes-deploy' },
            { Key: 'hermes-deploy/deployment', Value: 'e2e-stale' },
          ],
        },
      ],
    });

    const report = await sweepAws({
      ec2: ec2Mock as unknown as EC2Client,
      region: 'us-east-1',
      maxAgeHours: 4,
      dryRun: true,
      now: NOW,
    });

    // All 4 resource types should be "swept" in dry-run
    expect(report.swept).toBe(4);
    expect(report.errors).toBe(0);
    // No mutation commands should have been issued
    expect(ec2Mock.commandCalls(TerminateInstancesCommand)).toHaveLength(0);
    expect(ec2Mock.commandCalls(DeleteSecurityGroupCommand)).toHaveLength(0);
    expect(ec2Mock.commandCalls(DeleteKeyPairCommand)).toHaveLength(0);
    expect(ec2Mock.commandCalls(ReleaseAddressCommand)).toHaveLength(0);
  });

  it('skips security groups and elastic IPs belonging to non-e2e deployments', async () => {
    ec2Mock.on(DescribeInstancesCommand).resolves({ Reservations: [] });
    ec2Mock.on(DescribeSecurityGroupsCommand).resolves({
      SecurityGroups: [
        {
          GroupId: 'sg-prod',
          Tags: [
            { Key: 'managed-by', Value: 'hermes-deploy' },
            { Key: 'hermes-deploy/deployment', Value: 'production-acme' },
          ],
        },
      ],
    });
    ec2Mock.on(DescribeKeyPairsCommand).resolves({ KeyPairs: [] });
    ec2Mock.on(DescribeAddressesCommand).resolves({
      Addresses: [
        {
          AllocationId: 'eipalloc-prod',
          Tags: [
            { Key: 'managed-by', Value: 'hermes-deploy' },
            { Key: 'hermes-deploy/deployment', Value: 'production-acme' },
          ],
        },
      ],
    });

    const report = await sweepAws({
      ec2: ec2Mock as unknown as EC2Client,
      region: 'us-east-1',
      maxAgeHours: 4,
      dryRun: false,
      now: NOW,
    });

    expect(report.swept).toBe(0);
    expect(report.skipped).toBe(2);
    expect(ec2Mock.commandCalls(DeleteSecurityGroupCommand)).toHaveLength(0);
    expect(ec2Mock.commandCalls(ReleaseAddressCommand)).toHaveLength(0);
  });
});
