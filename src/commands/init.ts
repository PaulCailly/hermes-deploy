import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { HERMES_TOML_TEMPLATE } from '../init-templates/hermes-toml.js';
import { CONFIG_YAML_TEMPLATE } from '../init-templates/config-yaml.js';
import { SOUL_MD_TEMPLATE } from '../init-templates/soul.js';
import { PROJECT_GITIGNORE_TEMPLATE } from '../init-templates/gitignore.js';
import { generateAgeKeypair } from '../crypto/age-keygen.js';
import { ensureSopsBootstrap } from '../sops/bootstrap.js';
import { getStatePaths } from '../state/paths.js';

export interface InitOptions {
  /** Override the deployment name; defaults to a sanitized cwd basename. */
  name?: string;
  /** Override the target directory; defaults to process.cwd(). */
  dir?: string;
}

/**
 * Scaffold a new hermes-deploy project. Writes:
 *   - hermes.toml (M3 schema, with [hermes.documents] pointing at SOUL.md)
 *   - config.yaml (minimal starter — user replaces or copies from ~/.hermes/)
 *   - SOUL.md (starter agent personality)
 *   - .sops.yaml + secrets.env.enc (via ensureSopsBootstrap)
 *   - .gitignore (with comment about secrets.env.enc being safe to commit)
 *
 * Generates a per-deployment age keypair under ~/.config/hermes-deploy/age_keys/<name>
 * because ensureSopsBootstrap needs the public key to encrypt the secrets file.
 *
 * Refuses to overwrite an existing hermes.toml. SOUL.md, config.yaml, .sops.yaml,
 * secrets.env.enc, .gitignore are only written if absent.
 */
export async function initCommand(opts: InitOptions): Promise<void> {
  const dir = opts.dir ?? process.cwd();
  const tomlPath = join(dir, 'hermes.toml');
  if (existsSync(tomlPath)) {
    throw new Error(`hermes.toml already exists at ${tomlPath}`);
  }

  const name = opts.name ?? sanitizeName(basename(dir));

  // Generate the per-deployment age key (or reuse if already present from
  // a previous interrupted init).
  const paths = getStatePaths();
  const ageKeyPath = paths.ageKeyForDeployment(name);
  let agePublicKey: string;
  if (existsSync(ageKeyPath)) {
    // Read pub key from existing file
    const content = readFileSync(ageKeyPath, 'utf-8');
    const m = content.match(/^# public key: (age1[a-z0-9]+)$/m);
    if (!m) throw new Error(`could not read age public key from ${ageKeyPath}`);
    agePublicKey = m[1]!;
  } else {
    mkdirSync(dirname(ageKeyPath), { recursive: true });
    const generated = generateAgeKeypair(ageKeyPath);
    agePublicKey = generated.publicKey;
  }

  // Bootstrap sops files (creates .sops.yaml + empty encrypted secrets.env.enc)
  ensureSopsBootstrap(dir, agePublicKey);

  // Write hermes.toml
  writeFileSync(tomlPath, HERMES_TOML_TEMPLATE(name));

  // Write config.yaml if absent
  const configYamlPath = join(dir, 'config.yaml');
  if (!existsSync(configYamlPath)) writeFileSync(configYamlPath, CONFIG_YAML_TEMPLATE);

  // Write SOUL.md if absent
  const soulPath = join(dir, 'SOUL.md');
  if (!existsSync(soulPath)) writeFileSync(soulPath, SOUL_MD_TEMPLATE);

  // Write .gitignore if absent
  const gitignorePath = join(dir, '.gitignore');
  if (!existsSync(gitignorePath)) writeFileSync(gitignorePath, PROJECT_GITIGNORE_TEMPLATE);

  console.log(`Scaffolded hermes-deploy project at ${dir}`);
  console.log('Next steps:');
  console.log('  1. edit hermes.toml (cloud, region, size)');
  console.log('  2. edit config.yaml (or copy from ~/.hermes/config.yaml)');
  console.log('  3. edit SOUL.md (agent personality)');
  console.log('  4. hermes-deploy secret set ANTHROPIC_API_KEY <your-key>');
  console.log('  5. hermes-deploy up');
}

function sanitizeName(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const trimmed = cleaned.slice(0, 63) || 'hermes-bot';
  return /^[a-z0-9]/.test(trimmed) ? trimmed : `hermes-${trimmed}`;
}
