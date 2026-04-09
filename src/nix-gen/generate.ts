import type { HermesTomlConfig } from '../schema/hermes-toml.js';
import { configurationNix, FLAKE_NIX } from './templates.js';

export function generateConfigurationNix(config: HermesTomlConfig): string {
  return configurationNix(config.hermes.cachix);
}

export function generateFlakeNix(): string {
  return FLAKE_NIX;
}

/**
 * Generate hermes.nix from the validated hermes.toml config.
 *
 * Always emits services.hermes-agent.{enable, configFile, environmentFiles}.
 * Conditionally emits .documents and .environment when those tables are
 * non-empty. The user's nix_extra (when set) is uploaded as
 * /etc/nixos/hermes.extra.nix and pulled in by flake.nix's modules list
 * via pathExists — NOT via an `imports = [...]` line in hermes.nix
 * itself, so this generator stays simple.
 *
 * environmentFiles always references config.sops.secrets."hermes-env".path
 * because configuration.nix always declares that secret. The dotenv file
 * is always present (init bootstraps an empty placeholder one) and
 * sops-nix decrypts it at activation.
 */
export function generateHermesNix(config: HermesTomlConfig): string {
  const lines: string[] = [];
  lines.push('{ config, pkgs, lib, ... }:');
  lines.push('{');
  lines.push('  services.hermes-agent = {');
  lines.push('    enable = true;');
  lines.push('    configFile = ./config.yaml;');
  lines.push('    environmentFiles = [ config.sops.secrets."hermes-env".path ];');

  const docEntries = Object.entries(config.hermes.documents);
  if (docEntries.length > 0) {
    lines.push('');
    lines.push('    documents = {');
    for (const [filename, _path] of docEntries) {
      // The file is uploaded to /etc/nixos/<filename> by the orchestrator.
      // Inside hermes.nix the path is just ./<filename> — Nix path literals
      // resolve relative to the file containing them.
      lines.push('      "' + escapeNixString(filename) + '" = ' + nixPath('./' + filename) + ';');
    }
    lines.push('    };');
  }

  const envEntries = Object.entries(config.hermes.environment);
  if (envEntries.length > 0) {
    lines.push('');
    lines.push('    environment = {');
    for (const [key, value] of envEntries) {
      lines.push('      ' + key + ' = "' + escapeNixString(value) + '";');
    }
    lines.push('    };');
  }

  lines.push('  };');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

/**
 * Validate a string going into a Nix path literal. Nix unquoted path
 * literals support a limited character set — anything else (spaces,
 * shell metacharacters, etc.) is invalid syntax. We validate at
 * generation time so users get a clear error instead of a confusing
 * Nix evaluation failure on the box.
 */
function nixPath(p: string): string {
  if (/[^\w./+-]/.test(p)) {
    throw new Error(
      'nix-gen: path "' + p + '" contains characters that are invalid in a ' +
      'Nix path literal. Use a path with only [A-Za-z0-9._+-/] characters.',
    );
  }
  if (p.startsWith('./') || p.startsWith('/')) return p;
  return './' + p;
}

/** Escape a string for inclusion in a Nix double-quoted string literal. */
function escapeNixString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');
}
