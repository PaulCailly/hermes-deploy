import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';
import { createCloudProvider } from '../cloud/factory.js';
import type { CloudProvider, ResourceLedger } from '../cloud/core.js';

declare const HERMES_DEPLOY_VERSION: string;

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
  hermesAgentTag?: string;
  hermesAgentRev?: string;
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
        ((deployment: { cloud: 'aws' | 'gcp'; region: string }, resources: Record<string, unknown>) =>
          createCloudProvider({
            provider: deployment.cloud,
            region: deployment.region,
            imageCacheFile: paths.imageCacheFile,
            ...(deployment.cloud === 'gcp'
              ? { zone: (resources as any)?.zone, profile: (resources as any)?.project_id }
              : {}),
          }));
      const provider = factory({ cloud: d.cloud, region: d.region }, d.cloud_resources);
      const ledger: ResourceLedger =
        d.cloud === 'aws'
          ? { kind: 'aws', resources: { ...d.cloud_resources } }
          : { kind: 'gcp', resources: { ...d.cloud_resources } };
      try {
        const live = await provider.status(ledger);
        summary.liveState = live.state;
        summary.livePublicIp = live.publicIp;
        summary.hermesAgentTag = (d as any).hermes_agent_tag || '';
        summary.hermesAgentRev = (d as any).hermes_agent_rev || 'unknown';
      } catch {
        summary.liveState = 'error';
      }
    }

    summaries.push(summary);
  }
  return summaries;
}

/**
 * CLI entry — renders a plain-text table, or JSON when `json: true`.
 * A future Ink dashboard will wrap collectDeploymentSummaries for the
 * --watch case (deferred to the M2 follow-up that builds the live
 * Dashboard component).
 */
export async function lsCommand(opts: {
  watch?: boolean;
  json?: boolean;
}): Promise<void> {
  if (opts.watch) {
    throw new Error(
      '--watch is not yet implemented. The live Ink dashboard ships in a follow-up to phase H.',
    );
  }

  const summaries = await collectDeploymentSummaries({ live: true });

  if (opts.json) {
    process.stdout.write(JSON.stringify(summaries, null, 2) + '\n');
    return;
  }

  if (summaries.length === 0) {
    console.log('No deployments.');
    return;
  }

  const header = ['NAME', 'CLOUD', 'REGION', 'IP', 'AGENT', 'STORED', 'LIVE', 'LAST DEPLOYED'];
  const rows = summaries.map(s => {
    const agentLabel = s.hermesAgentTag || (s.hermesAgentRev && s.hermesAgentRev !== 'unknown' ? s.hermesAgentRev.slice(0, 10) : '-');
    return [
      s.name, s.cloud, s.region, s.instanceIp, agentLabel,
      s.storedHealth, s.liveState ?? '-', s.lastDeployedAt,
    ];
  });
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  console.log(line(header));
  console.log(widths.map(w => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));

  // npm update notice
  try {
    const { checkCliUpdate } = await import('../updates/cli-update-check.js');
    const { getStatePaths } = await import('../state/paths.js');
    const { join } = await import('node:path');
    const updatePaths = getStatePaths();
    const cacheFile = join(updatePaths.configDir, 'npm-update-check.json');
    const check = await checkCliUpdate(HERMES_DEPLOY_VERSION, cacheFile);
    if (check.updateAvailable) {
      console.error(
        `\nUpdate available: @paulcailly/hermes-deploy@${check.latest} (current: ${check.current})` +
        `\nRun: npm install -g @paulcailly/hermes-deploy@latest`,
      );
    }
  } catch {
    // Non-fatal
  }
}
