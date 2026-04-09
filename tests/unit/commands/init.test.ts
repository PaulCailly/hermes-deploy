import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initCommand } from '../../../src/commands/init.js';
import { HermesTomlSchema } from '../../../src/schema/hermes-toml.js';
import { parse as parseToml } from 'smol-toml';

describe('initCommand', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hermes-init-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates hermes.toml, SOUL.md, and .gitignore', async () => {
    await initCommand({ name: 'test-bot', dir });
    expect(existsSync(join(dir, 'hermes.toml'))).toBe(true);
    expect(existsSync(join(dir, 'SOUL.md'))).toBe(true);
    expect(existsSync(join(dir, '.gitignore'))).toBe(true);
    expect(readFileSync(join(dir, 'hermes.toml'), 'utf-8')).toContain('name = "test-bot"');
  });

  it('refuses to overwrite an existing hermes.toml', async () => {
    await initCommand({ name: 'first', dir });
    await expect(initCommand({ name: 'second', dir })).rejects.toThrow(/already exists/);
  });

  it('derives a default name from the directory basename', async () => {
    await initCommand({ dir });
    const toml = readFileSync(join(dir, 'hermes.toml'), 'utf-8');
    // Sanitized basename should match the regex; just verify a name line exists
    expect(toml).toMatch(/^name = "[a-z0-9][a-z0-9-]*"/m);
  });

  it('produces a hermes.toml that parses cleanly against the schema', async () => {
    await initCommand({ name: 'parse-test', dir });
    const raw = readFileSync(join(dir, 'hermes.toml'), 'utf-8');
    const parsed = parseToml(raw);
    const result = HermesTomlSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  it('does not overwrite an existing SOUL.md', async () => {
    writeFileSync(join(dir, 'SOUL.md'), '# pre-existing user content');
    await initCommand({ name: 'preserve', dir });
    expect(readFileSync(join(dir, 'SOUL.md'), 'utf-8')).toBe('# pre-existing user content');
  });
});
