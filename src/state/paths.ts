import { homedir } from 'node:os';
import { join } from 'node:path';

export interface StatePaths {
  configDir: string;
  stateFile: string;
  lockFile: string;
  sshKeysDir: string;
  ageKeysDir: string;
  imageCacheFile: string;
  sshKeyForDeployment(name: string): string;
  ageKeyForDeployment(name: string): string;
}

export function getStatePaths(): StatePaths {
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  const xdgCache = process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache');

  const configDir = join(xdgConfig, 'hermes-deploy');
  const cacheDir = join(xdgCache, 'hermes-deploy');
  const sshKeysDir = join(configDir, 'ssh_keys');
  const ageKeysDir = join(configDir, 'age_keys');

  return {
    configDir,
    stateFile: join(configDir, 'state.toml'),
    lockFile: join(configDir, 'state.toml.lock'),
    sshKeysDir,
    ageKeysDir,
    imageCacheFile: join(cacheDir, 'images.json'),
    sshKeyForDeployment(name) {
      return join(sshKeysDir, name);
    },
    ageKeyForDeployment(name) {
      return join(ageKeysDir, name);
    },
  };
}
