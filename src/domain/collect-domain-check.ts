import type { DomainCheckDto } from '../schema/dto.js';
import type { Deployment } from '../schema/state-toml.js';

/**
 * Gather domain health checks for a deployment — both external (DNS, TLS,
 * HTTPS from the client) and remote (nginx, cert, upstream via SSH).
 *
 * Checks both state (domain_name) and hermes.toml ([domain] section) so
 * the domain card appears even before the user re-deploys with the new
 * [domain] config.
 *
 * Returns undefined when no domain is configured in either place.
 */
export async function collectDomainCheck(
  deployment: Deployment,
  liveRunning: boolean,
): Promise<DomainCheckDto | undefined> {
  const { join } = await import('node:path');
  const { loadHermesToml } = await import('../schema/load.js');

  // Resolve domain name and upstream port from state OR hermes.toml
  let domainName = deployment.domain_name;
  let upstreamPort = 3000;
  try {
    const config = loadHermesToml(join(deployment.project_path, 'hermes.toml'));
    if (config.domain) {
      domainName = domainName ?? config.domain.name;
      upstreamPort = config.domain.upstream_port;
    }
  } catch { /* use fallback */ }

  if (!domainName) return undefined;

  const { runExternalDomainChecks } = await import('./external-check.js');
  const external = await runExternalDomainChecks(domainName, deployment.instance_ip);

  let nginxCheck = { ok: false, active: false, configValid: false };
  let remoteTls = { ok: false, expiresAt: null as string | null, daysRemaining: null as number | null };
  let upstreamCheck = { ok: false, httpStatus: null as number | null };

  if (liveRunning) {
    try {
      const { readFileSync } = await import('node:fs');
      const { createSshSession } = await import('../remote-ops/session.js');
      const { runRemoteDomainChecks } = await import('../remote-ops/domain-check.js');
      const privateKey = readFileSync(deployment.ssh_key_path, 'utf-8');
      const session = await createSshSession({ host: deployment.instance_ip, username: 'root', privateKey });
      try {
        const remote = await runRemoteDomainChecks(session, domainName, upstreamPort);
        nginxCheck = remote.nginx;
        remoteTls = remote.tls;
        upstreamCheck = remote.upstream;
      } finally {
        await session.dispose();
      }
    } catch { /* SSH failed, use defaults */ }
  }

  return {
    name: domainName,
    checks: {
      dns: external.dns,
      tls: external.tls.ok
        ? external.tls
        : { ok: remoteTls.ok, valid: remoteTls.ok, expiresAt: remoteTls.expiresAt, daysRemaining: remoteTls.daysRemaining },
      nginx: nginxCheck,
      upstream: upstreamCheck,
      https: external.https,
    },
  };
}
