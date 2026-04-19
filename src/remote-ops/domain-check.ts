import type { SshSession } from './session.js';

export interface RemoteDomainChecks {
  nginx: { ok: boolean; active: boolean; configValid: boolean };
  tls: { ok: boolean; expiresAt: string | null; daysRemaining: number | null };
  upstream: { ok: boolean; httpStatus: number | null };
}

export async function runRemoteDomainChecks(
  session: SshSession,
  domainName: string,
  upstreamPort: number,
): Promise<RemoteDomainChecks> {
  // 1. nginx status
  const nginxActive = await session.exec('systemctl is-active nginx');
  const isActive = nginxActive.exitCode === 0 && nginxActive.stdout.trim() === 'active';

  // 2. nginx config test
  const nginxTest = await session.exec('nginx -t 2>&1');
  const configValid = nginxTest.exitCode === 0;

  // 3. TLS cert expiry — read from the ACME cert path on NixOS
  let expiresAt: string | null = null;
  let daysRemaining: number | null = null;
  const certCheck = await session.exec(
    `openssl x509 -enddate -noout -in /var/lib/acme/${domainName}/cert.pem 2>/dev/null | sed 's/notAfter=//'`,
  );
  if (certCheck.exitCode === 0 && certCheck.stdout.trim()) {
    const dateStr = certCheck.stdout.trim();
    const expiry = new Date(dateStr);
    if (!isNaN(expiry.getTime())) {
      expiresAt = expiry.toISOString();
      daysRemaining = Math.floor((expiry.getTime() - Date.now()) / 86_400_000);
    }
  }
  const tlsOk = expiresAt !== null && (daysRemaining ?? 0) > 0;

  // 4. Upstream health — check if the app behind nginx responds
  const upstreamCheck = await session.exec(
    `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${upstreamPort} 2>/dev/null`,
  );
  const httpStatus = upstreamCheck.exitCode === 0 ? parseInt(upstreamCheck.stdout.trim(), 10) : null;
  const upstreamOk = httpStatus !== null && !isNaN(httpStatus) && httpStatus >= 200 && httpStatus < 500;

  return {
    nginx: { ok: isActive && configValid, active: isActive, configValid },
    tls: { ok: tlsOk, expiresAt, daysRemaining },
    upstream: { ok: upstreamOk, httpStatus: (httpStatus !== null && !isNaN(httpStatus)) ? httpStatus : null },
  };
}
