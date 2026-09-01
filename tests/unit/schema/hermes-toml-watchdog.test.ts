import { describe, it, expect } from 'vitest';
import { parse as parseToml } from 'smol-toml';
import { HermesTomlSchema } from '../../../src/schema/hermes-toml.js';

const base = `
name = "watchdog-test"
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

describe('HermesTomlSchema — [hermes.watchdog]', () => {
  it('leaves watchdog undefined when the section is absent', () => {
    const r = parse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.hermes.watchdog).toBeUndefined();
  });

  it('applies defaults when the section is declared empty', () => {
    const r = parse(base + '\n[hermes.watchdog]\n');
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.hermes.watchdog).toEqual({
        enabled: true,
        interval_min: 5,
        window_min: 15,
        cooldown_min: 30,
      });
    }
  });

  it('accepts explicit values', () => {
    const r = parse(base + `
[hermes.watchdog]
enabled = true
interval_min = 2
window_min = 20
cooldown_min = 60
`);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.hermes.watchdog).toEqual({
        enabled: true,
        interval_min: 2,
        window_min: 20,
        cooldown_min: 60,
      });
    }
  });

  it('rejects a non-positive interval', () => {
    const r = parse(base + '\n[hermes.watchdog]\ninterval_min = 0\n');
    expect(r.success).toBe(false);
  });

  it('rejects a cooldown shorter than the window (pre-restart journal entries would retrigger)', () => {
    const r = parse(base + '\n[hermes.watchdog]\nwindow_min = 20\ncooldown_min = 10\n');
    expect(r.success).toBe(false);
  });

  it('rejects a fractional window', () => {
    const r = parse(base + '\n[hermes.watchdog]\nwindow_min = 1.5\n');
    expect(r.success).toBe(false);
  });
});
