import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { resolveDeployment } from './resolve.js';
import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';

interface SecretContext {
  projectDir: string;
  secretsPath: string;
  ageKeyPath: string;
}

/**
 * Resolve the deployment, look it up in state to find the project_path
 * and the per-deployment age key path. The age key path is what
 * SOPS_AGE_KEY_FILE points at when we shell out to sops.
 */
async function getContext(name?: string, projectPath?: string): Promise<SecretContext> {
  const { name: resolvedName, projectPath: resolvedProject } = await resolveDeployment({
    name,
    projectPath,
    cwd: process.cwd(),
  });

  const store = new StateStore(getStatePaths());
  const state = await store.read();
  const deployment = state.deployments[resolvedName];
  if (!deployment) {
    throw new Error(
      `deployment "${resolvedName}" not found in state — run \`hermes-deploy up\` first`,
    );
  }
  const secretsPath = join(resolvedProject, 'secrets.enc.yaml');
  return {
    projectDir: resolvedProject,
    secretsPath,
    ageKeyPath: deployment.age_key_path,
  };
}

function runSops(args: string[], ageKeyFile: string): string {
  const result = spawnSync('sops', args, {
    encoding: 'utf-8',
    env: { ...process.env, SOPS_AGE_KEY_FILE: ageKeyFile },
  });
  if (result.status !== 0) {
    throw new Error(`sops ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout;
}

async function readSecrets(ctx: SecretContext): Promise<Record<string, unknown>> {
  const decrypted = runSops(['--decrypt', ctx.secretsPath], ctx.ageKeyPath);
  return (parseYaml(decrypted) ?? {}) as Record<string, unknown>;
}

function writeSecrets(ctx: SecretContext, data: Record<string, unknown>): void {
  const plain = stringifyYaml(data);
  writeFileSync(ctx.secretsPath, plain);
  runSops(['--encrypt', '--in-place', ctx.secretsPath], ctx.ageKeyPath);
}

export interface SecretRefOptions {
  name?: string;
  projectPath?: string;
}

export async function secretSet(
  opts: SecretRefOptions & { key: string; value: string },
): Promise<void> {
  const ctx = await getContext(opts.name, opts.projectPath);
  const data = await readSecrets(ctx);
  data[opts.key] = opts.value;
  writeSecrets(ctx, data);
}

export async function secretGet(
  opts: SecretRefOptions & { key: string },
): Promise<string | undefined> {
  const ctx = await getContext(opts.name, opts.projectPath);
  const data = await readSecrets(ctx);
  const v = data[opts.key];
  return v === undefined ? undefined : String(v);
}

export async function secretRemove(
  opts: SecretRefOptions & { key: string },
): Promise<void> {
  const ctx = await getContext(opts.name, opts.projectPath);
  const data = await readSecrets(ctx);
  delete data[opts.key];
  writeSecrets(ctx, data);
}

export async function secretList(opts: SecretRefOptions): Promise<string[]> {
  const ctx = await getContext(opts.name, opts.projectPath);
  const data = await readSecrets(ctx);
  return Object.keys(data);
}

export async function secretEdit(opts: SecretRefOptions): Promise<void> {
  const ctx = await getContext(opts.name, opts.projectPath);
  // Shell out interactively — sops opens $EDITOR for the user
  execFileSync('sops', [ctx.secretsPath], {
    stdio: 'inherit',
    env: { ...process.env, SOPS_AGE_KEY_FILE: ctx.ageKeyPath },
  });
}
