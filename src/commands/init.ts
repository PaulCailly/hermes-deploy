import { existsSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { HERMES_TOML_TEMPLATE } from '../init-templates/hermes-toml.js';
import { SOUL_MD_TEMPLATE } from '../init-templates/soul.js';
import { PROJECT_GITIGNORE_TEMPLATE } from '../init-templates/gitignore.js';

export interface InitOptions {
  /** Override the deployment name; defaults to a sanitized cwd basename. */
  name?: string;
  /** Override the target directory; defaults to process.cwd(). */
  dir?: string;
}

/**
 * Scaffold a new hermes-deploy project: writes hermes.toml (with the
 * deployment name from --name or the sanitized directory basename),
 * SOUL.md, and .gitignore. Refuses to overwrite an existing hermes.toml
 * because that would clobber the user's deployment config silently.
 * SOUL.md and .gitignore are only written if absent — leaving any
 * existing user content untouched.
 */
export async function initCommand(opts: InitOptions): Promise<void> {
  const dir = opts.dir ?? process.cwd();
  const tomlPath = join(dir, 'hermes.toml');
  if (existsSync(tomlPath)) {
    throw new Error(`hermes.toml already exists at ${tomlPath}`);
  }

  const name = opts.name ?? sanitizeName(basename(dir));
  writeFileSync(tomlPath, HERMES_TOML_TEMPLATE(name));

  const soulPath = join(dir, 'SOUL.md');
  if (!existsSync(soulPath)) writeFileSync(soulPath, SOUL_MD_TEMPLATE);

  const gitignorePath = join(dir, '.gitignore');
  if (!existsSync(gitignorePath)) writeFileSync(gitignorePath, PROJECT_GITIGNORE_TEMPLATE);

  console.log(`Scaffolded hermes-deploy project at ${dir}`);
  console.log('Next steps:');
  console.log('  1. edit hermes.toml (cloud, region, size)');
  console.log('  2. edit SOUL.md (agent personality)');
  console.log('  3. hermes-deploy up');
}

/**
 * Sanitize a directory basename into a valid deployment name. Lowercases,
 * replaces invalid characters with hyphens, trims to 63 chars, and
 * prefixes "hermes-" if the result doesn't start with a letter or digit
 * (so the deployment name always passes the `^[a-z0-9][a-z0-9-]{0,62}$`
 * regex from the schema).
 */
function sanitizeName(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const trimmed = cleaned.slice(0, 63) || 'hermes-bot';
  return /^[a-z0-9]/.test(trimmed) ? trimmed : `hermes-${trimmed}`;
}
