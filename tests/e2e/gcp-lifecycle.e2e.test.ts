import { describe, it, expect } from 'vitest';
import { GcpProvider } from '../../src/cloud/gcp/provider.js';
import type {
  ProvisionSpec,
  ResourceLedger,
} from '../../src/cloud/core.js';

/**
 * End-to-end GCP lifecycle test. Symmetric with aws-lifecycle.e2e.test.ts.
 *
 * Skipped unless `HERMES_E2E_GCP=1` is set. Requires:
 *   - Application Default Credentials (ADC) in the standard SDK chain
 *     (`gcloud auth application-default login` locally, or a service
 *     account key in CI)
 *   - `GOOGLE_CLOUD_PROJECT` set to the target project id
 *   - `HERMES_E2E_GCP_ZONE` (defaults to `europe-west1-b`)
 *   - Compute Admin permissions on the project
 *   - The Compute Engine API enabled
 *
 * The test uses a Debian image override because the public NixOS GCE
 * image family is not universally readable; real deploys use
 * nixos-infect, which is out of scope here (this test only exercises
 * the CloudProvider verbs, not the orchestrator's nixos-rebuild path).
 *
 * All resources carry the `hermes-deploy/e2e-run` label so nightly
 * cleanup can sweep up leaks on a mid-run crash.
 */
const E2E_ENABLED = process.env.HERMES_E2E_GCP === '1';
const ZONE = process.env.HERMES_E2E_GCP_ZONE ?? 'europe-west1-b';
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT;
const RUN_ID = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Debian bookworm family in the debian-cloud public project — a tiny,
// universally readable image we can boot to exercise the provider.
const TEST_IMAGE =
  'projects/debian-cloud/global/images/family/debian-12';

describe.skipIf(!E2E_ENABLED || !PROJECT)('GCP CloudProvider E2E', () => {
  const deploymentName = `e2e-${RUN_ID}`;
  let provider: GcpProvider;
  let ledger: ResourceLedger;

  it('instantiates with the test project + zone', () => {
    provider = new GcpProvider({
      zone: ZONE,
      project: PROJECT!,
      imageCacheFile: `/tmp/hermes-e2e-gcp-images-${RUN_ID}.json`,
    });
    expect(provider.name).toBe('gcp');
  });

  it('provisions a full deployment', async () => {
    ledger = { kind: 'gcp', resources: {} };
    const spec: ProvisionSpec = {
      deploymentName,
      location: { region: ZONE.replace(/-[a-z]$/, ''), zone: ZONE },
      size: 'small',
      diskGb: 10,
      image: { id: TEST_IMAGE, description: 'debian-12 (e2e)' },
      publicSshKey:
        'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHermesDeployE2ETestKey e2e-test',
      networkRules: {
        sshAllowedFrom: '0.0.0.0/0',
        inboundPorts: [],
      },
    };
    const instance = await provider.provision(spec, ledger);
    expect(instance.publicIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    if (ledger.kind === 'gcp') {
      expect(ledger.resources.instance_name).toBeDefined();
      expect(ledger.resources.static_ip_name).toBeDefined();
      expect(ledger.resources.firewall_rule_names).toBeDefined();
      expect(ledger.resources.project_id).toBe(PROJECT);
    }
  });

  it('reports a status for the new instance', async () => {
    const status = await provider.status(ledger);
    expect(['pending', 'running']).toContain(status.state);
    expect(status.publicIp).toBeTruthy();
  });

  it('adopts the deployment by label discovery', async () => {
    const result = await provider.adopt(deploymentName);
    expect(result.ledger.kind).toBe('gcp');
    if (result.ledger.kind === 'gcp' && ledger.kind === 'gcp') {
      expect(result.ledger.resources.instance_name).toBe(
        ledger.resources.instance_name,
      );
    }
  });

  it('destroys everything in the ledger', async () => {
    await provider.destroy(ledger);
    if (ledger.kind === 'gcp') {
      expect(ledger.resources.instance_name).toBeUndefined();
      expect(ledger.resources.static_ip_name).toBeUndefined();
      expect(ledger.resources.firewall_rule_names).toBeUndefined();
    }
  });
});
