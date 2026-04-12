import type { FastifyInstance } from 'fastify';
import { collectDeploymentSummaries } from '../../commands/ls.js';
import { StateStore } from '../../state/store.js';
import { getStatePaths } from '../../state/paths.js';
import { createCloudProvider } from '../../cloud/factory.js';
import { createSshSession } from '../../remote-ops/session.js';
import { runDeploy } from '../../orchestrator/deploy.js';
import { runUpdate } from '../../orchestrator/update.js';
import { runDestroy } from '../../orchestrator/destroy.js';
import { adoptDeployment } from '../../commands/adopt.js';
import { generateSshKeypair } from '../../crypto/ssh-keygen.js';
import { generateAgeKeypair } from '../../crypto/age-keygen.js';
import { ensureSopsBootstrap } from '../../sops/bootstrap.js';
import { waitForSshPort } from '../../remote-ops/wait-ssh.js';
import { detectPublicIp } from '../../utils/public-ip.js';
import type { ReporterBus } from '../reporter-bus.js';
import type { SingleFlight } from '../singleflight.js';

interface Deps {
  bus: ReporterBus;
  singleFlight: SingleFlight;
}

export async function deploymentRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { bus, singleFlight } = deps;

  // GET /api/deployments — list all
  app.get('/api/deployments', async () => {
    return collectDeploymentSummaries({ live: true });
  });

  // GET /api/deployments/:name — single deployment status
  app.get<{ Params: { name: string } }>('/api/deployments/:name', async (request, reply) => {
    const { name } = request.params;
    const paths = getStatePaths();
    const store = new StateStore(paths);
    const state = await store.read();
    const deployment = state.deployments[name];

    if (!deployment) {
      reply.code(404).send({ error: `deployment "${name}" not found` });
      return;
    }

    const provider = createCloudProvider({
      provider: deployment.cloud,
      region: deployment.region,
      profile: deployment.cloud === 'gcp' ? (deployment.cloud_resources as any).project_id : undefined,
      zone: deployment.cloud === 'gcp' ? (deployment.cloud_resources as any).zone : undefined,
      imageCacheFile: paths.imageCacheFile,
    });

    const ledger = deployment.cloud === 'aws'
      ? { kind: 'aws' as const, resources: deployment.cloud_resources }
      : { kind: 'gcp' as const, resources: deployment.cloud_resources };

    let live;
    try {
      live = await provider.status(ledger);
    } catch {
      live = { state: 'unknown' as const, publicIp: null };
    }

    return {
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
    };
  });

  // POST /api/deployments/:name/up
  app.post<{ Params: { name: string }; Body: { projectPath: string } }>(
    '/api/deployments/:name/up',
    async (request, reply) => {
      const { name } = request.params;
      const { projectPath } = request.body;

      if (!projectPath) {
        reply.code(400).send({ error: 'projectPath is required' });
        return;
      }

      const existingJob = singleFlight.isRunning(name);
      if (existingJob) {
        reply.code(409).send({ error: 'busy', currentJobId: existingJob });
        return;
      }

      const { jobId, reporter } = bus.createJob(name, 'up');
      singleFlight.acquire(name, jobId);

      const paths = getStatePaths();
      const store = new StateStore(paths);
      const state = await store.read();
      const existing = state.deployments[name];
      const cloud = existing?.cloud ?? 'aws'; // fallback, config will override
      const region = existing?.region ?? 'us-east-1';

      // Load hermes.toml from project to get actual cloud config
      let actualCloud = cloud;
      let actualRegion = region;
      let providerOpts: Record<string, any> = {};
      try {
        const { loadHermesToml } = await import('../../schema/load.js');
        const config = loadHermesToml(`${projectPath}/hermes.toml`);
        actualCloud = config.cloud.provider;
        actualRegion = config.cloud.region;
        if (config.cloud.provider === 'gcp') {
          providerOpts = { zone: config.cloud.zone, profile: config.cloud.profile };
        }
      } catch {
        // Will be caught by runDeploy's own validation
      }

      const provider = createCloudProvider({
        provider: actualCloud,
        region: actualRegion,
        imageCacheFile: paths.imageCacheFile,
        ...providerOpts,
      });

      // Fire and forget — client subscribes via WS /ws/jobs/:jobId
      runDeploy({
        projectDir: projectPath,
        provider,
        sessionFactory: (host, privateKey) => createSshSession({ host, username: 'root', privateKey }),
        detectPublicIp: () => detectPublicIp(),
        sshKeyGenerator: async (path) => generateSshKeypair(path),
        ageKeyGenerator: async (path) => generateAgeKeypair(path),
        sopsBootstrap: async (dir, key) => ensureSopsBootstrap(dir, key),
        waitSsh: (host) => waitForSshPort({ host }),
        reporter,
      }).then(
        () => { bus.finish(jobId); singleFlight.release(name); },
        (err) => { bus.fail(jobId, (err as Error).message); singleFlight.release(name); },
      );

      reply.code(202).send({ jobId });
    },
  );

  // POST /api/deployments/:name/update
  app.post<{ Params: { name: string } }>(
    '/api/deployments/:name/update',
    async (request, reply) => {
      const { name } = request.params;

      const existingJob = singleFlight.isRunning(name);
      if (existingJob) {
        reply.code(409).send({ error: 'busy', currentJobId: existingJob });
        return;
      }

      const paths = getStatePaths();
      const store = new StateStore(paths);
      const state = await store.read();
      const deployment = state.deployments[name];
      if (!deployment) {
        reply.code(404).send({ error: `deployment "${name}" not found` });
        return;
      }

      const { jobId, reporter } = bus.createJob(name, 'update');
      singleFlight.acquire(name, jobId);

      const provider = createCloudProvider({
        provider: deployment.cloud,
        region: deployment.region,
        profile: deployment.cloud === 'gcp' ? (deployment.cloud_resources as any).project_id : undefined,
        zone: deployment.cloud === 'gcp' ? (deployment.cloud_resources as any).zone : undefined,
        imageCacheFile: paths.imageCacheFile,
      });

      runUpdate({
        deploymentName: name,
        provider,
        sessionFactory: (host, privateKey) => createSshSession({ host, username: 'root', privateKey }),
        detectPublicIp,
        reporter,
      }).then(
        () => { bus.finish(jobId); singleFlight.release(name); },
        (err) => { bus.fail(jobId, (err as Error).message); singleFlight.release(name); },
      );

      reply.code(202).send({ jobId });
    },
  );

  // POST /api/deployments/:name/destroy
  app.post<{ Params: { name: string }; Body: { confirm: boolean } }>(
    '/api/deployments/:name/destroy',
    async (request, reply) => {
      const { name } = request.params;
      const { confirm } = request.body ?? {};

      if (confirm !== true) {
        reply.code(400).send({ error: 'confirm must be true' });
        return;
      }

      const existingJob = singleFlight.isRunning(name);
      if (existingJob) {
        reply.code(409).send({ error: 'busy', currentJobId: existingJob });
        return;
      }

      const paths = getStatePaths();
      const store = new StateStore(paths);
      const state = await store.read();
      const deployment = state.deployments[name];
      if (!deployment) {
        reply.code(404).send({ error: `deployment "${name}" not found` });
        return;
      }

      const { jobId, reporter } = bus.createJob(name, 'destroy');
      singleFlight.acquire(name, jobId);

      const provider = createCloudProvider({
        provider: deployment.cloud,
        region: deployment.region,
        profile: deployment.cloud === 'gcp' ? (deployment.cloud_resources as any).project_id : undefined,
        zone: deployment.cloud === 'gcp' ? (deployment.cloud_resources as any).zone : undefined,
        imageCacheFile: paths.imageCacheFile,
      });

      runDestroy({
        deploymentName: name,
        provider,
        reporter,
      }).then(
        () => { bus.finish(jobId); singleFlight.release(name); },
        (err) => { bus.fail(jobId, (err as Error).message); singleFlight.release(name); },
      );

      reply.code(202).send({ jobId });
    },
  );

  // POST /api/deployments/:name/adopt
  app.post<{ Params: { name: string }; Body: { projectPath: string; force?: boolean; dryRun?: boolean } }>(
    '/api/deployments/:name/adopt',
    async (request, reply) => {
      const { name } = request.params;
      const { projectPath, force, dryRun } = request.body ?? {};

      if (!projectPath) {
        reply.code(400).send({ error: 'projectPath is required' });
        return;
      }

      try {
        const result = await adoptDeployment({
          name,
          projectPath,
          force,
          dryRun,
        });
        return result;
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
    },
  );
}
