import { join } from 'node:path';
import { findUp } from './find-project.js';
import { loadHermesToml } from '../schema/load.js';
import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';

export interface ResolveOptions {
  /** Explicit deployment name (from --name or positional arg). */
  name?: string;
  /** Explicit project directory (from --project). */
  projectPath?: string;
  /** Current working directory for the cwd-walk fallback. */
  cwd: string;
}

export interface ResolvedDeployment {
  name: string;
  projectPath: string;
  source: 'name' | 'project' | 'cwd';
}

/**
 * Resolve a deployment using the spec §5.1 precedence:
 *
 *   1. --name (or positional [name]) → look up in global state, read
 *      project_path from there. Lets the user run any command from
 *      anywhere on disk by referencing the deployment name.
 *
 *   2. --project <path> → load that directory's hermes.toml and use
 *      its `name` field. Lets the user point at a specific project
 *      directory regardless of cwd.
 *
 *   3. cwd walk → find hermes.toml upward from cwd, use its `name`
 *      field. The "type `hermes-deploy up` from anywhere inside your
 *      project" experience.
 *
 * Throws if --name and --project are both given (mutually exclusive)
 * or if none of the three resolution paths produce a result.
 */
export async function resolveDeployment(
  opts: ResolveOptions,
): Promise<ResolvedDeployment> {
  if (opts.name && opts.projectPath) {
    throw new Error('--name and --project are mutually exclusive');
  }

  if (opts.name) {
    const store = new StateStore(getStatePaths());
    const state = await store.read();
    const deployment = state.deployments[opts.name];
    if (!deployment) {
      throw new Error(`deployment "${opts.name}" not found in state`);
    }
    return { name: opts.name, projectPath: deployment.project_path, source: 'name' };
  }

  if (opts.projectPath) {
    const config = loadHermesToml(join(opts.projectPath, 'hermes.toml'));
    return { name: config.name, projectPath: opts.projectPath, source: 'project' };
  }

  const projectDir = findUp(opts.cwd, 'hermes.toml');
  if (!projectDir) {
    throw new Error('no hermes.toml found in current directory or any parent');
  }
  const config = loadHermesToml(join(projectDir, 'hermes.toml'));
  return { name: config.name, projectPath: projectDir, source: 'cwd' };
}
