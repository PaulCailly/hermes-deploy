import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import lockfile from 'proper-lockfile';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { StateTomlSchema, type StateToml } from '../schema/state-toml.js';
import { runMigrations } from './migrations.js';

interface StorePaths {
  configDir: string;
  stateFile: string;
  lockFile: string;
}

const MAX_BACKUPS = 5;

export class StateStore {
  constructor(private readonly paths: StorePaths) {}

  async read(): Promise<StateToml> {
    if (!existsSync(this.paths.stateFile)) {
      return { schema_version: 3, deployments: {} };
    }
    const raw = readFileSync(this.paths.stateFile, 'utf-8');
    const parsed = parseToml(raw);
    // Run forward migrations before validation so older state files
    // (or future ones with extra fields the migration adds) become
    // valid v1 input. M2 ships with a v0→v1 migration scaffold; v0
    // never shipped, but the runner is exercised so M3 can drop in
    // a v2 migration cleanly.
    const migrated = runMigrations(parsed);
    const result = StateTomlSchema.safeParse(migrated);
    if (!result.success) {
      const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`state.toml failed validation: ${issues}`);
    }
    return result.data;
  }

  async update(mutator: (state: StateToml) => void | Promise<void>): Promise<void> {
    this.ensureConfigDir();
    // Ensure the lockfile target exists for proper-lockfile
    if (!existsSync(this.paths.stateFile)) {
      writeFileSync(this.paths.stateFile, 'schema_version = 3\n[deployments]\n');
    }
    const release = await lockfile.lock(this.paths.stateFile, {
      retries: { retries: 30, minTimeout: 100, maxTimeout: 500 },
      stale: 30000,
    });
    try {
      const state = await this.read();
      this.backup();
      await mutator(state);
      // Re-validate before writing
      const validated = StateTomlSchema.parse(state);
      writeFileSync(this.paths.stateFile, stringifyToml(validated));
    } finally {
      await release();
    }
  }

  private ensureConfigDir(): void {
    if (!existsSync(this.paths.configDir)) {
      mkdirSync(this.paths.configDir, { recursive: true });
    }
  }

  private backup(): void {
    if (!existsSync(this.paths.stateFile)) return;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${this.paths.stateFile}.bak.${ts}`;
    copyFileSync(this.paths.stateFile, backupPath);
    this.pruneOldBackups();
  }

  private pruneOldBackups(): void {
    const dir = dirname(this.paths.stateFile);
    const base = `${this.paths.stateFile.split('/').pop()}.bak.`;
    const backups = readdirSync(dir)
      .filter(n => n.startsWith(base))
      .map(n => join(dir, n))
      .sort()
      .reverse();
    for (const old of backups.slice(MAX_BACKUPS)) {
      try { unlinkSync(old); } catch {}
    }
  }
}
