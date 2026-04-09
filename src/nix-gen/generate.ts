import type { HermesTomlConfig } from '../schema/hermes-toml.js';
import { CONFIGURATION_NIX } from './templates.js';

export function generateConfigurationNix(): string {
  return CONFIGURATION_NIX;
}

export function generateHermesNix(config: HermesTomlConfig): string {
  const lines: string[] = [];
  lines.push('{ config, pkgs, lib, ... }:');
  lines.push('{');
  lines.push('  services.hermes-agent = {');
  lines.push('    enable = true;');
  lines.push(`    model = "${config.hermes.model}";`);
  lines.push(`    soulFile = ${nixPath(config.hermes.soul)};`);
  lines.push('');
  lines.push('    sops = {');
  lines.push(`      secretsFile = ${nixPath(config.hermes.secrets_file)};`);
  lines.push('      ageKeyFile = "/var/lib/sops-nix/age.key";');
  lines.push('    };');

  if (config.hermes.platforms.discord?.enabled) {
    lines.push('');
    lines.push('    platforms.discord = {');
    lines.push('      enable = true;');
    if (config.hermes.platforms.discord.token_key) {
      lines.push(`      tokenSecretKey = "${config.hermes.platforms.discord.token_key}";`);
    }
    lines.push('    };');
  }

  if (config.hermes.platforms.telegram?.enabled) {
    lines.push('');
    lines.push('    platforms.telegram = {');
    lines.push('      enable = true;');
    if (config.hermes.platforms.telegram.token_key) {
      lines.push(`      tokenSecretKey = "${config.hermes.platforms.telegram.token_key}";`);
    }
    lines.push('    };');
  }

  if (config.hermes.mcp_servers.length > 0) {
    lines.push('');
    lines.push('    mcpServers = [');
    for (const m of config.hermes.mcp_servers) {
      lines.push('      {');
      lines.push(`        name = "${m.name}";`);
      lines.push(`        command = "${m.command}";`);
      lines.push(`        args = [ ${m.args.map(a => `"${a}"`).join(' ')} ];`);
      if (m.env_keys.length > 0) {
        lines.push(`        envSecretKeys = [ ${m.env_keys.map(k => `"${k}"`).join(' ')} ];`);
      }
      lines.push('      }');
    }
    lines.push('    ];');
  }

  lines.push('  };');

  if (config.hermes.nix_extra) {
    lines.push('');
    lines.push(`  imports = [ ${nixPath(config.hermes.nix_extra.file)} ];`);
  }

  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function nixPath(p: string): string {
  // Bare relative paths in Nix don't need quoting
  if (p.startsWith('./') || p.startsWith('/')) return p;
  return `./${p}`;
}
