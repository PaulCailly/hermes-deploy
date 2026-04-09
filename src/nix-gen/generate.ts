import type { HermesTomlConfig } from '../schema/hermes-toml.js';
import { CONFIGURATION_NIX, FLAKE_NIX } from './templates.js';

export function generateConfigurationNix(): string {
  return CONFIGURATION_NIX;
}

export function generateFlakeNix(): string {
  return FLAKE_NIX;
}

/**
 * Generate hermes.nix — the NixOS module fragment that configures
 * `services.hermes-agent`. In M1.1 this is intentionally minimal:
 * it only emits `settings.model.default` (the one field the current
 * `hermes.toml` schema can reliably map onto a real upstream option)
 * and an optional nix_extra import escape hatch.
 *
 * The M1 schema's other fields (`soul`, `secrets_file`, `platforms.*`,
 * `mcp_servers`) are intentionally NOT emitted because they don't match
 * the upstream module's actual option surface. Wiring them correctly
 * requires a `hermes.toml` redesign, which is M2 scope.
 *
 * What you get with the current output: hermes-agent starts with a
 * minimal config.yaml ({model: {default: "..."}}), no secrets, no
 * messaging platforms. The deploy pipeline completes; the agent will
 * log "no platforms configured" at runtime. That's the point: prove
 * the pipeline works before re-scoping the user-facing config shape.
 */
export function generateHermesNix(config: HermesTomlConfig): string {
  const lines: string[] = [];
  lines.push('{ config, pkgs, lib, ... }:');
  lines.push('{');
  lines.push('  services.hermes-agent = {');
  lines.push('    enable = true;');
  lines.push('    settings.model.default = "' + config.hermes.model + '";');
  lines.push('  };');

  if (config.hermes.nix_extra) {
    lines.push('');
    lines.push('  imports = [ ' + nixPath(config.hermes.nix_extra.file) + ' ];');
  }

  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function nixPath(p: string): string {
  // Nix unquoted path literals support a limited character set:
  // [a-zA-Z0-9._+-/]. Anything else (including spaces) is invalid syntax.
  if (/[^\w./+-]/.test(p)) {
    throw new Error(
      'nix-gen: path "' + p + '" contains characters that are invalid in a ' +
      'Nix path literal. Use a path with only [A-Za-z0-9._+-/] characters.',
    );
  }
  // Bare relative paths in Nix don't need a "./" prefix unless they would
  // otherwise be parsed as something else.
  if (p.startsWith('./') || p.startsWith('/')) return p;
  return './' + p;
}
