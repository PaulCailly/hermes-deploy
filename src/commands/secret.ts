import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDeployment } from './resolve.js';
import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';

interface SecretContext {
  projectDir: string;
  secretsPath: string;
  ageKeyPath: string;
}

/**
 * Resolve the deployment context for a secret command. Needs the
 * project directory (for the sops file) and the per-deployment age
 * key path (for decryption).
 *
 * Two resolution paths:
 *   1. Deployment exists in state (post-`up`): read age_key_path
 *      from state.toml — the authoritative source.
 *   2. Deployment NOT in state (post-`init`, pre-`up`): derive the
 *      age key path from the deployment name via getStatePaths().
 *      Init eagerly generates the key; the sops file exists. This
 *      lets users `secret set` immediately after `init`, BEFORE
 *      their first `up`.
 */
async function getContext(name?: string, projectPath?: string): Promise<SecretContext> {
  const { name: resolvedName, projectPath: resolvedProject } = await resolveDeployment({
    name,
    projectPath,
    cwd: process.cwd(),
  });

  const paths = getStatePaths();
  const store = new StateStore(paths);
  const state = await store.read();
  const deployment = state.deployments[resolvedName];

  let ageKeyPath: string;
  if (deployment) {
    // Post-`up`: age key path is recorded in state.
    ageKeyPath = deployment.age_key_path;
  } else {
    // Post-`init`, pre-`up`: derive the path from the deployment name.
    // Init eagerly generates the key at this location.
    ageKeyPath = paths.ageKeyForDeployment(resolvedName);
    if (!existsSync(ageKeyPath)) {
      throw new Error(
        `no age key for deployment "${resolvedName}" — run \`hermes-deploy init\` first`,
      );
    }
  }

  const secretsPath = join(resolvedProject, 'secrets.env.enc');
  return {
    projectDir: resolvedProject,
    secretsPath,
    ageKeyPath,
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
