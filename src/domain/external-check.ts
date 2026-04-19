import { resolve4 } from 'node:dns/promises';
import https from 'node:https';
import tls from 'node:tls';

export interface ExternalDomainChecks {
  dns: { ok: boolean; resolvedIp: string | null; expectedIp: string; matches: boolean };
  tls: { ok: boolean; valid: boolean; expiresAt: string | null; daysRemaining: number | null };
  https: { ok: boolean; httpStatus: number | null };
}

export async function runExternalDomainChecks(
  domainName: string,
  expectedIp: string,
): Promise<ExternalDomainChecks> {
  // 1. DNS resolution
  let resolvedIp: string | null = null;
  let dnsOk = false;
  let dnsMatches = false;
  try {
    const ips = await resolve4(domainName);
    resolvedIp = ips[0] ?? null;
    dnsOk = ips.length > 0;
    dnsMatches = ips.includes(expectedIp);
  } catch {
    // DNS resolution failed
  }

  // 2. TLS check
  let tlsValid = false;
  let tlsExpiresAt: string | null = null;
  let tlsDaysRemaining: number | null = null;
  try {
    const cert = await getTlsCert(domainName);
    if (cert) {
      const validTo = (cert as any).valid_to;
      if (validTo) {
        const expiry = new Date(validTo);
        if (!isNaN(expiry.getTime())) {
          tlsExpiresAt = expiry.toISOString();
          tlsDaysRemaining = Math.floor((expiry.getTime() - Date.now()) / 86_400_000);
          tlsValid = tlsDaysRemaining > 0;
        }
      }
    }
  } catch {
    // TLS connection failed
  }

  // 3. HTTPS check
  let httpsStatus: number | null = null;
  try {
    httpsStatus = await getHttpsStatus(domainName);
  } catch {
    // HTTPS request failed
  }

  return {
    dns: { ok: dnsOk, resolvedIp, expectedIp, matches: dnsMatches },
    tls: { ok: tlsValid, valid: tlsValid, expiresAt: tlsExpiresAt, daysRemaining: tlsDaysRemaining },
    https: { ok: httpsStatus !== null && httpsStatus >= 200 && httpsStatus < 500, httpStatus: httpsStatus },
  };
}

function getTlsCert(hostname: string): Promise<tls.PeerCertificate | null> {
  return new Promise((resolve) => {
    const socket = tls.connect(443, hostname, { servername: hostname, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(cert && cert.subject ? cert : null);
    });
    socket.setTimeout(5000);
    socket.on('timeout', () => { socket.destroy(); resolve(null); });
    socket.on('error', () => resolve(null));
  });
}

function getHttpsStatus(hostname: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = https.get(`https://${hostname}`, { timeout: 10000 }, (res) => {
      res.resume(); // drain the response
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}
