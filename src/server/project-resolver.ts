import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';

/**
 * Resolve a deployment's project path from state — no cwd-walking.
 * The server doesn't have a meaningful cwd, so we always look up
 * the project_path from state.toml.
 */
export async function resolveProjectPath(
  deploymentName: string,
): Promise<string> {
  const store = new StateStore(getStatePaths());
  const state = await store.read();
  const deployment = state.deployments[deploymentName];
  if (!deployment) {
    throw new Error(`deployment "${deploymentName}" not found in state`);
  }
  return deployment.project_path;
}
