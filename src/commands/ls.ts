import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';
import { createCloudProvider } from '../cloud/factory.js';
import type { CloudProvider, ResourceLedger } from '../cloud/core.js';

export interface DeploymentSummary {
  name: string;
  cloud: 'aws' | 'gcp';
  region: string;
  instanceIp: string;
  storedHealth: 'healthy' | 'unhealthy' | 'unknown';
  lastDeployedAt: string;
  /** Live state from provider.status() — only present when live=true. */
  liveState?: string;
  livePublicIp?: string | null;
}

export interface CollectOptions {
  /** When true, calls provider.status() for each deployment. */
  live: boolean;
  /**
   * Factory for constructing a CloudProvider per deployment. Injected so
   * tests can stub it. Defaults to createCloudProvider with the standard
   * image cache file.
   */
  providerFactory?: (deployment: { cloud: 'aws' | 'gcp'; region: string }) => CloudProvider;
}

/**
 * Read all deployments from the global state and optionally enrich each
 * with a live status() call. Returns a sorted array (alphabetic by name)
 * for stable output. Live-status errors don't fail the whole listing —
 * they just set liveState='error' on the affected entry.
 */
export async function collectDeploymentSummaries(
  opts: CollectOptions,
): Promise<DeploymentSummary[]> {
  const paths = getStatePaths();
  const store = new StateStore(paths);
  const state = await store.read();

  const names = Object.keys(state.deployments).sort();
  const summaries: DeploymentSummary[] = [];

  for (const name of names) {
    const d = state.deployments[name]!;
    const summary: DeploymentSummary = {
      name,
      cloud: d.cloud,
      region: d.region,
      instanceIp: d.instance_ip,
      storedHealth: d.health,
      lastDeployedAt: d.last_deployed_at,
    };

    if (opts.live) {
      const factory =
        opts.providerFactory ??
        ((deployment) =>
          createCloudProvider({
            provider: deployment.cloud,
            region: deployment.region,
            imageCacheFile: paths.imageCacheFile,
          }));
      const provider = factory({ cloud: d.cloud, region: d.region });
      const ledger: ResourceLedger =
        d.cloud === 'aws'
          ? { kind: 'aws', resources: { ...d.cloud_resources } }
          : { kind: 'gcp', resources: { ...d.cloud_resources } };
      try {
        const live = await provider.status(ledger);
        summary.liveState = live.state;
        summary.livePublicIp = live.publicIp;
      } catch {
        summary.liveState = 'error';
      }
    }

    summaries.push(summary);
  }
  return summaries;
}

/**
 * CLI entry — renders a plain-text table. The Ink dashboard from
 * Phase H wraps this for the --watch case.
 */
export async function lsCommand(opts: { watch?: boolean }): Promise<void> {
  const summaries = await collectDeploymentSummaries({ live: true });
  if (summaries.length === 0) {
    console.log('No deployments.');
    return;
  }

  const header = ['NAME', 'CLOUD', 'REGION', 'IP', 'STORED', 'LIVE', 'LAST DEPLOYED'];
  const rows = summaries.map(s => [
    s.name,
    s.cloud,
    s.region,
    s.instanceIp,
    s.storedHealth,
    s.liveState ?? '-',
    s.lastDeployedAt,
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  console.log(line(header));
  console.log(widths.map(w => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));

  if (opts.watch) {
    console.log('\n(--watch not yet wired to Ink; see phase H)');
  }
}
