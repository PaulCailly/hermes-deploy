import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Initialize the project's sops setup if missing:
 *   - .sops.yaml records the per-deployment age public key as a recipient
 *     for any file matching `secrets.env.enc$`
 *   - secrets.env.enc is a sops-encrypted dotenv file with one placeholder
 *     line (`_HERMES_DEPLOY_PLACEHOLDER=initialized`). The placeholder
 *     keeps the file non-empty so sops accepts it; users immediately
 *     overwrite it via `hermes-deploy secret set`.
 *
 * Idempotent — both files are created only if missing.
 */
export function ensureSopsBootstrap(projectDir: string, agePublicKey: string): void {
  const sopsYamlPath = join(projectDir, '.sops.yaml');
  if (!existsSync(sopsYamlPath)) {
    const content = `creation_rules:
  - path_regex: secrets\\.env\\.enc$
    age: ${agePublicKey}
`;
    writeFileSync(sopsYamlPath, content);
  }

  const secretsPath = join(projectDir, 'secrets.env.enc');
  if (!existsSync(secretsPath)) {
    // Plaintext placeholder content. sops --encrypt will rewrite this
    // file in place with the encrypted version.
    const placeholder = '_HERMES_DEPLOY_PLACEHOLDER=initialized\n';
    writeFileSync(secretsPath, placeholder);
    try {
      execFileSync(
        'sops',
        ['--encrypt', '--input-type', 'dotenv', '--output-type', 'dotenv', '--in-place', secretsPath],
        { cwd: projectDir, stdio: 'pipe' },
      );
    } catch (e) {
      throw new Error(
        `sops encryption failed: ${(e as Error).message}. ` +
        `Ensure 'sops' is installed and your age recipient is valid.`,
      );
    }
  }
}
