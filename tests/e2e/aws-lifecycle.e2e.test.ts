import { describe, it, expect } from 'vitest';
import { EC2Client } from '@aws-sdk/client-ec2';
import { AwsProvider } from '../../src/cloud/aws/provider.js';
import type {
  ProvisionSpec,
  ResourceLedger,
} from '../../src/cloud/core.js';

/**
 * End-to-end AWS lifecycle test. Runs provision → reconcileNetwork →
 * status → adopt → destroy against a real AWS account.
 *
 * Skipped unless `HERMES_E2E_AWS=1` is set. Requires:
 *   - AWS credentials in the standard SDK chain (env, ~/.aws, etc.)
 *   - A region in AWS_REGION (defaults to us-east-1)
 *   - Permissions: ec2:Describe*, ec2:RunInstances, ec2:TerminateInstances,
 *     ec2:CreateSecurityGroup, ec2:AuthorizeSecurityGroupIngress,
 *     ec2:ImportKeyPair, ec2:AllocateAddress, ec2:AssociateAddress,
 *     and the corresponding Delete/Release equivalents.
 *
 * This test does NOT invoke nixos-rebuild — it only exercises the
 * CloudProvider verbs. The remote-ops layer is covered by the unit
 * suite via ssh2 mocks and by the `test:e2e:full` entry (not yet
 * wired) which runs the orchestrator against a real box.
 *
 * All resources carry the `hermes-deploy/e2e-run` tag so nightly
 * cleanup can sweep up anything the test leaks on a mid-run crash.
 */
const E2E_ENABLED = process.env.HERMES_E2E_AWS === '1';
const REGION = process.env.AWS_REGION ?? 'us-east-1';
const RUN_ID = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe.skipIf(!E2E_ENABLED)('AWS CloudProvider E2E', () => {
  const deploymentName = `e2e-${RUN_ID}`;
  let provider: AwsProvider;
  let ledger: ResourceLedger;

  it('resolves a current NixOS AMI', async () => {
    provider = new AwsProvider({
      region: REGION,
      imageCacheFile: `/tmp/hermes-e2e-images-${RUN_ID}.json`,
    });
    const image = await provider.resolveNixosImage({ region: REGION });
    expect(image.id).toMatch(/^ami-/);
  });

  it('provisions a full deployment', async () => {
    ledger = { kind: 'aws', resources: {} };
    const image = await provider.resolveNixosImage({ region: REGION });
    const spec: ProvisionSpec = {
      deploymentName,
      location: { region: REGION },
      size: 'small',
      diskGb: 10,
      image,
      publicSshKey:
        'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHermesDeployE2ETestKey e2e-test',
      networkRules: {
        sshAllowedFrom: '0.0.0.0/0',
        inboundPorts: [],
      },
    };
    const instance = await provider.provision(spec, ledger);
    expect(instance.publicIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(ledger.kind).toBe('aws');
    if (ledger.kind === 'aws') {
      expect(ledger.resources.instance_id).toBeDefined();
      expect(ledger.resources.security_group_id).toBeDefined();
      expect(ledger.resources.eip_allocation_id).toBeDefined();
      expect(ledger.resources.key_pair_name).toBeDefined();
    }
  });

  it('reports a status for the new instance', async () => {
    const status = await provider.status(ledger);
    expect(['pending', 'running']).toContain(status.state);
    expect(status.publicIp).toBeTruthy();
  });

  it('adopts the deployment by tag discovery', async () => {
    const result = await provider.adopt(deploymentName);
    expect(result.ledger.kind).toBe('aws');
    if (result.ledger.kind === 'aws' && ledger.kind === 'aws') {
      expect(result.ledger.resources.instance_id).toBe(
        ledger.resources.instance_id,
      );
      expect(result.ledger.resources.security_group_id).toBe(
        ledger.resources.security_group_id,
      );
    }
  });

  it('destroys everything in the ledger', async () => {
    await provider.destroy(ledger);
    if (ledger.kind === 'aws') {
      expect(ledger.resources.instance_id).toBeUndefined();
      expect(ledger.resources.security_group_id).toBeUndefined();
      expect(ledger.resources.eip_allocation_id).toBeUndefined();
      expect(ledger.resources.key_pair_name).toBeUndefined();
    }
  });

  it('adopt throws when nothing remains to adopt', async () => {
    const ec2 = new EC2Client({ region: REGION });
    const reprovider = new AwsProvider({
      region: REGION,
      imageCacheFile: `/tmp/hermes-e2e-images-${RUN_ID}.json`,
    });
    // Silence unused-var lint:
    expect(ec2).toBeDefined();
    await expect(reprovider.adopt(deploymentName)).rejects.toThrow(
      /no AWS resources/,
    );
  });
});
