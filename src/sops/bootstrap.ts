import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function ensureSopsBootstrap(projectDir: string, agePublicKey: string): void {
  const sopsYamlPath = join(projectDir, '.sops.yaml');
  if (!existsSync(sopsYamlPath)) {
    const content = `creation_rules:
  - path_regex: secrets\\.enc\\.yaml$
    age: ${agePublicKey}
`;
    writeFileSync(sopsYamlPath, content);
  }

  const secretsPath = join(projectDir, 'secrets.enc.yaml');
  if (!existsSync(secretsPath)) {
    // Encrypt an empty placeholder file using sops directly
    const placeholder = '# add secrets with: sops secrets.enc.yaml\nplaceholder: bootstrap\n';
    writeFileSync(secretsPath, placeholder);
    try {
      execFileSync('sops', ['--encrypt', '--in-place', secretsPath], {
        cwd: projectDir,
        stdio: 'pipe',
      });
    } catch (e) {
      throw new Error(
        `sops encryption failed: ${(e as Error).message}. Ensure 'sops' is installed and your age recipient is valid.`,
      );
    }
  }
}
