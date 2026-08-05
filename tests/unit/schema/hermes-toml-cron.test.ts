import { describe, it, expect } from 'vitest';
import { parse as parseToml } from 'smol-toml';
import { HermesTomlSchema } from '../../../src/schema/hermes-toml.js';

const base = `
name = "cron-test"
[cloud]
provider = "aws"
profile  = "default"
region   = "eu-west-3"
size     = "large"
[hermes]
config_file  = "./config.yaml"
secrets_file = "./secrets.env.enc"
`;

const parse = (toml: string) => HermesTomlSchema.safeParse(parseToml(toml));

describe('HermesTomlSchema — [[hermes.cron]]', () => {
  it('leaves cron undefined when the section is absent (opt-out — box crons untouched)', () => {
    const r = parse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.hermes.cron).toBeUndefined();
  });

  it('accepts an explicit empty cron array (opt-in to authoritative "zero crons")', () => {
    const r = HermesTomlSchema.safeParse({
      ...(parseToml(base) as Record<string, unknown>),
      hermes: { config_file: './config.yaml', secrets_file: './secrets.env.enc', cron: [] },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.hermes.cron).toEqual([]);
  });

  it('parses a declared cron with defaults', () => {
    const r = parse(base + `
[[hermes.cron]]
name = "notion-triage"
schedule = "0 6 * * 1-5"
prompt = "run a pass"
skills = ["release-manager"]
deliver = "discord:1040693401420570704"
`);
    expect(r.success).toBe(true);
    if (r.success) {
      const c = r.data.hermes.cron![0]!;
      expect(c.name).toBe('notion-triage');
      expect(c.schedule).toBe('0 6 * * 1-5');
      expect(c.skills).toEqual(['release-manager']);
      expect(c.enabled).toBe(true); // default
    }
  });

  it('rejects a duplicate cron name', () => {
    const r = parse(base + `
[[hermes.cron]]
name = "dup"
schedule = "0 6 * * 1-5"
[[hermes.cron]]
name = "dup"
schedule = "0 7 * * 1-5"
`);
    expect(r.success).toBe(false);
  });

  it('rejects an unsafe cron name', () => {
    const r = parse(base + `
[[hermes.cron]]
name = "../evil"
schedule = "0 6 * * 1-5"
`);
    expect(r.success).toBe(false);
  });

  it('rejects a cron missing its schedule', () => {
    const r = parse(base + `
[[hermes.cron]]
name = "no-schedule"
`);
    expect(r.success).toBe(false);
  });
});
