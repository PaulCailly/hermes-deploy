import { randomBytes } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

function buildHostPatterns(bindHost: string): RegExp[] {
  const loopback = [
    /^127\.0\.0\.1(:\d+)?$/,
    /^localhost(:\d+)?$/,
    /^\[::1\](:\d+)?$/,
  ];

  // 0.0.0.0 means "all interfaces" — allow any Host header
  if (bindHost === '0.0.0.0' || bindHost === '::') {
    return [/.*/];
  }

  // Always include loopback patterns for safety
  const escaped = bindHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...loopback, new RegExp(`^${escaped}(:\\d+)?$`)];
}

export function createAuthHook(token: string, authEnabled: boolean, bindHost: string) {
  const allowedPatterns = buildHostPatterns(bindHost);

  return async (request: FastifyRequest, reply: FastifyReply) => {
    // DNS rebinding protection: always check Host header
    const host = request.headers.host ?? '';
    if (!allowedPatterns.some(p => p.test(host))) {
      reply.code(400).send({ error: 'invalid host header' });
      return;
    }

    // Skip auth for healthcheck
    if (request.url === '/healthz') return;

    // Skip auth if disabled
    if (!authEnabled) return;

    // Skip auth for static assets
    if (!request.url.startsWith('/api/') && !request.url.startsWith('/ws/')) return;

    // Check Authorization header or ?token= query param
    const authHeader = request.headers.authorization;
    if (authHeader === `Bearer ${token}`) return;

    const queryToken = (request.query as Record<string, string>).token;
    if (queryToken === token) return;

    reply.code(401).send({ error: 'unauthorized' });
  };
}
