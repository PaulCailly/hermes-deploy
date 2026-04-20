import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { generateToken, createAuthHook } from './auth.js';
import { registerStatic } from './static.js';
import { ReporterBus } from './reporter-bus.js';
import { SingleFlight } from './singleflight.js';
import { healthRoutes } from './routes/health.js';
import { deploymentRoutes } from './routes/deployments.js';
import { configRoutes } from './routes/config.js';
import { secretRoutes } from './routes/secrets.js';
import { keyRoutes } from './routes/keys.js';
import { initRoutes } from './routes/init.js';
import { jobRoutes } from './routes/jobs.js';
import { logRoutes } from './routes/logs.js';
import { sshRoutes } from './routes/ssh.js';
import { agentDataRoutes } from './routes/agent-data.js';
import { orgRoutes } from './routes/org.js';
import { updateRoutes } from './routes/updates.js';

export interface CreateServerOptions {
  host: string;
  port: number;
  auth: boolean;
}

export interface DashboardServer {
  start(): Promise<{ url: string; token: string | null }>;
  stop(): Promise<void>;
}

export async function createDashboardServer(opts: CreateServerOptions): Promise<DashboardServer> {
  const token = opts.auth ? generateToken() : '';
  const app = Fastify({ logger: false });

  // WebSocket support
  await app.register(websocket);

  // Text/plain body parser (used for skill file writes)
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  // Auth + DNS rebinding protection
  app.addHook('onRequest', createAuthHook(token, opts.auth, opts.host));

  // Shared state
  const bus = new ReporterBus();
  const singleFlight = new SingleFlight();

  // Register routes
  await app.register(async (instance) => healthRoutes(instance));
  await app.register(async (instance) => deploymentRoutes(instance, { bus, singleFlight }));
  await app.register(async (instance) => configRoutes(instance));
  await app.register(async (instance) => secretRoutes(instance));
  await app.register(async (instance) => keyRoutes(instance));
  await app.register(async (instance) => initRoutes(instance));
  await app.register(async (instance) => jobRoutes(instance, bus));
  await app.register(async (instance) => logRoutes(instance));
  await app.register(async (instance) => sshRoutes(instance));
  await app.register(async (instance) => agentDataRoutes(instance));
  await app.register(async (instance) => orgRoutes(instance));
  await app.register(async (instance) => updateRoutes(instance));

  // Static SPA serving (must be last — has the wildcard fallback)
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const webDistDir = join(thisDir, 'web');
  await registerStatic(app, webDistDir);

  return {
    async start() {
      const address = await app.listen({ host: opts.host, port: opts.port });
      return { url: address, token: opts.auth ? token : null };
    },
    async stop() {
      await app.close();
    },
  };
}
