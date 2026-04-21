import type { FastifyInstance } from 'fastify';
import { checkNpmUpdate } from '../../updates/npm-check.js';
import { checkHermesAgentRelease } from '../../updates/hermes-agent-check.js';

declare const HERMES_DEPLOY_VERSION: string;

export async function updateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/updates', async () => {
    const [npmResult, agentRelease] = await Promise.all([
      checkNpmUpdate(HERMES_DEPLOY_VERSION),
      checkHermesAgentRelease(),
    ]);
    return {
      hermesDeploy: npmResult,
      hermesAgent: { latest: agentRelease },
    };
  });
}
