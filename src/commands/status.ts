import { join } from 'node:path';
import { resolveDeployment } from './resolve.js';
import { createCloudProvider } from '../cloud/factory.js';
import { getStatePaths } from '../state/paths.js';
import { StateStore } from '../state/store.js';
import type { Deployment } from '../schema/state-toml.js';
import type { InstanceStatus } from '../cloud/core.js';
import type { DomainCheckDto } from '../schema/dto.js';

export interface StatusOptions {
  name?: string;
  projectPath?: string;
  /** Emit JSON on stdout instead of human-formatted text. */
  json?: boolean;
}

/**
 * Machine-readable shape of a `status` result. Stable: field names and
 * types here follow the same semver contract as the CLI surface.
 */
export interface StatusPayload {
  name: string;
  found: boolean;
  stored?: {
    cloud: Deployment['cloud'];
    region: string;
    instance_ip: string;
    last_config_hash: string;
    last_nix_hash: string;
    last_deployed_at: string;
    health: Deployment['health'];
    ssh_key_path: string;
    age_key_path: string;
  };
  live?: InstanceStatus;
  domain?: DomainCheckDto;
}

export async function statusCommand(opts: StatusOptions): Promise<void> {
  const { name } = await resolveDeployment({
    name: opts.name,
    projectPath: opts.projectPath,
    cwd: process.cwd(),
  });

  const paths = getStatePaths();
  const store = new StateStore(paths);
  const state = await store.read();
  const deployment = state.deployments[name];

  if (!deployment) {
    const payload: StatusPayload = { name, found: false };
    if (opts.json) {
      process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    } else {
      console.log(`No deployment named "${name}" found in state.`);
    }
    return;
  }

  const provider = createCloudProvider({
    provider: deployment.cloud as 'aws' | 'gcp',
    region: deployment.region,
    profile: deployment.cloud === 'gcp' ? (deployment.cloud_resources as any).project_id : undefined,
    zone: deployment.cloud === 'gcp' ? (deployment.cloud_resources as any).zone : undefined,
    imageCacheFile: paths.imageCacheFile,
  });

  const live = await provider.status(
    deployment.cloud === 'aws'
      ? { kind: 'aws', resources: deployment.cloud_resources }
      : { kind: 'gcp', resources: deployment.cloud_resources },
  );

  // Domain checks (when domain is configured)
  let domainCheck: DomainCheckDto | undefined;
  if (deployment.domain_name) {
    const { loadHermesToml } = await import('../schema/load.js');
    let upstreamPort = 3000; // fallback
    try {
      const config = loadHermesToml(join(deployment.project_path, 'hermes.toml'));
      if (config.domain) upstreamPort = config.domain.upstream_port;
    } catch { /* use fallback */ }

    const { runExternalDomainChecks } = await import('../domain/external-check.js');
    const external = await runExternalDomainChecks(deployment.domain_name, deployment.instance_ip);

    // SSH-based checks (only if instance is reachable)
    let nginxCheck = { ok: false, active: false, configValid: false };
    let remoteTls = { ok: false, expiresAt: null as string | null, daysRemaining: null as number | null };
    let upstreamCheck = { ok: false, httpStatus: null as number | null };

    if (live.state === 'running') {
      try {
        const { readFileSync } = await import('node:fs');
        const { createSshSession } = await import('../remote-ops/session.js');
        const { runRemoteDomainChecks } = await import('../remote-ops/domain-check.js');
        const privateKey = readFileSync(deployment.ssh_key_path, 'utf-8');
        const session = await createSshSession({ host: deployment.instance_ip, username: 'root', privateKey });
        try {
          const remote = await runRemoteDomainChecks(session, deployment.domain_name!, upstreamPort);
          nginxCheck = remote.nginx;
          remoteTls = remote.tls;
          upstreamCheck = remote.upstream;
        } finally {
          await session.dispose();
        }
      } catch { /* SSH failed, use defaults */ }
    }

    domainCheck = {
      name: deployment.domain_name!,
      checks: {
        dns: external.dns,
        tls: external.tls.ok ? external.tls : { ok: remoteTls.ok, valid: remoteTls.ok, expiresAt: remoteTls.expiresAt, daysRemaining: remoteTls.daysRemaining },
        nginx: nginxCheck,
        upstream: upstreamCheck,
        https: external.https,
      },
    };
  }

  const payload: StatusPayload = {
    name,
    found: true,
    stored: {
      cloud: deployment.cloud,
      region: deployment.region,
      instance_ip: deployment.instance_ip,
      last_config_hash: deployment.last_config_hash,
      last_nix_hash: deployment.last_nix_hash,
      last_deployed_at: deployment.last_deployed_at,
      health: deployment.health,
      ssh_key_path: deployment.ssh_key_path,
      age_key_path: deployment.age_key_path,
    },
    live,
    domain: domainCheck,
  };

  if (opts.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }

  console.log(`Deployment:    ${name}`);
  console.log(`  Cloud:       ${deployment.cloud}`);
  console.log(`  Region:      ${deployment.region}`);
  console.log(`  Instance:    ${live.state}`);
  console.log(`  Public IP:   ${live.publicIp ?? '(none)'}`);
  console.log(`  Last config: ${deployment.last_config_hash}`);
  console.log(`  Health:      ${deployment.health}`);
  console.log(`  Deployed at: ${deployment.last_deployed_at}`);
  console.log(`  SSH key:     ${deployment.ssh_key_path}`);

  if (domainCheck) {
    const c = domainCheck.checks;
    console.log('');
    console.log(`  Domain:      ${domainCheck.name}`);
    console.log(`  DNS:         ${c.dns.ok ? 'ok' : 'FAIL'} — ${c.dns.resolvedIp ?? '(unresolved)'}${c.dns.matches ? ' (matches)' : ` (expected ${c.dns.expectedIp})`}`);
    console.log(`  TLS:         ${c.tls.ok ? 'ok' : 'FAIL'} — ${c.tls.expiresAt ? `expires ${c.tls.expiresAt.slice(0, 10)} (${c.tls.daysRemaining}d)` : '(no cert)'}`);
    console.log(`  nginx:       ${c.nginx.ok ? 'ok' : 'FAIL'} — ${c.nginx.active ? 'active' : 'inactive'}, config ${c.nginx.configValid ? 'valid' : 'invalid'}`);
    console.log(`  Upstream:    ${c.upstream.ok ? 'ok' : 'FAIL'} — ${c.upstream.httpStatus !== null ? `HTTP ${c.upstream.httpStatus}` : '(unreachable)'}`);
    console.log(`  HTTPS:       ${c.https.ok ? 'ok' : 'FAIL'} — ${c.https.httpStatus !== null ? `HTTP ${c.https.httpStatus}` : '(unreachable)'}`);
  }
}
