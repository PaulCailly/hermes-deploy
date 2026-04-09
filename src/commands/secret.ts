import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDeployment } from './resolve.js';
import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';

interface SecretContext {
  projectDir: string;
  secretsPath: string;
  ageKeyPath: string;
}

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
  const secretsPath = join(resolvedProject, 'secrets.env.enc');
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

/**
 * Parse a dotenv-format string into a Record. Tolerates blank lines and
 * `#`-prefixed comments. Does NOT handle quoted values or multi-line
 * values — hermes-deploy is opinionated about secrets being single-line
 * KEY=value (no spaces around =, no surrounding quotes). If a real
 * user need for quoted values shows up, switch to a real dotenv parser.
 */
function parseDotenv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    if (key) out[key] = value;
  }
  return out;
}

function stringifyDotenv(data: Record<string, string>): string {
  const lines = Object.entries(data).map(([k, v]) => `${k}=${v}`);
  return lines.join('\n') + '\n';
}

async function readSecrets(ctx: SecretContext): Promise<Record<string, string>> {
  const decrypted = runSops(
    ['--decrypt', '--input-type', 'dotenv', '--output-type', 'dotenv', ctx.secretsPath],
    ctx.ageKeyPath,
  );
  return parseDotenv(decrypted);
}

function writeSecrets(ctx: SecretContext, data: Record<string, string>): void {
  const plain = stringifyDotenv(data);
  writeFileSync(ctx.secretsPath, plain);
  runSops(
    ['--encrypt', '--input-type', 'dotenv', '--output-type', 'dotenv', '--in-place', ctx.secretsPath],
    ctx.ageKeyPath,
  );
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
  return data[opts.key];
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
  if (!process.stdout.isTTY) {
    throw new Error(
      'secret edit requires an interactive terminal. Use `secret set <key> <value>` from non-TTY contexts.',
    );
  }

  const ctx = await getContext(opts.name, opts.projectPath);
  // sops detects the .env extension OK on direct edit, but be explicit
  execFileSync('sops', ['--input-type', 'dotenv', '--output-type', 'dotenv', ctx.secretsPath], {
    stdio: 'inherit',
    env: { ...process.env, SOPS_AGE_KEY_FILE: ctx.ageKeyPath },
  });
}
