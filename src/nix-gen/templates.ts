/**
 * flake.nix lives at /etc/nixos/flake.nix on the box and is what
 * nixos-rebuild --flake /etc/nixos#default evaluates. It imports:
 *   - nixpkgs (pinned to a stable channel)
 *   - hermes-agent (as a flake input, which is the only way upstream
 *     publishes its NixOS module — see docs/specs if you're wondering
 *     why there's no "plain" import path)
 *   - sops-nix (for decrypting the uploaded secrets file at activation)
 *
 * The `nixosConfigurations.default` attribute is the build target for
 * `nixos-rebuild switch --flake /etc/nixos#default`.
 */
export const FLAKE_NIX = `{
  description = "hermes-deploy managed NixOS host";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
    sops-nix = {
      url = "github:Mic92/sops-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    hermes-agent = {
      url = "github:NousResearch/hermes-agent";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, sops-nix, hermes-agent, ... }: {
    nixosConfigurations.default = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        ./configuration.nix
        ./hermes.nix
        sops-nix.nixosModules.sops
        hermes-agent.nixosModules.default
      ];
    };
  };
}
`;

export interface CachixConfig {
  name: string;
  public_key: string;
}

/**
 * configuration.nix is the host-level NixOS config (imports amazon-image
 * so the instance boots correctly as an EC2 VM, enables flakes so
 * nixos-rebuild can re-evaluate the flake later, opens sshd, turns on
 * the firewall). It explicitly does NOT import hermes-agent — the flake
 * does that via the modules list above. It also explicitly does NOT
 * declare any hermes-agent options — those live in ./hermes.nix which
 * is the generator's output.
 *
 * If a Cachix cache is configured (via [hermes.cachix] in hermes.toml),
 * the substituter and trusted-public-key are appended to nix.settings so
 * subsequent rebuilds substitute the hermes-agent closure from binary
 * cache instead of compiling from source.
 */
export function configurationNix(cachix?: CachixConfig): string {
  const substitutersBlock = cachix
    ? `
  nix.settings = {
    substituters = [
      "https://cache.nixos.org/"
      "https://${cachix.name}.cachix.org/"
    ];
    trusted-public-keys = [
      "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY="
      "${cachix.public_key}"
    ];
  };
`
    : '';

  return `{ config, pkgs, lib, modulesPath, ... }:
{
  imports = [
    "\${modulesPath}/virtualisation/amazon-image.nix"
  ];

  nix.settings.experimental-features = [ "nix-command" "flakes" ];
${substitutersBlock}
  system.stateVersion = "25.11";

  services.openssh = {
    enable = true;
    settings.PasswordAuthentication = false;
    settings.PermitRootLogin = "prohibit-password";
  };

  networking.firewall.enable = true;

  sops = {
    defaultSopsFile = ./secrets.env.enc;
    age.keyFile = "/var/lib/sops-nix/age.key";
    # M3 declares a real secret (the dotenv-encoded environment file)
    # instead of M1.1's placeholder workaround. The real secret satisfies
    # hermes-agent's hardcoded \`setupSecrets\` activation dep AND wires
    # the decrypted file into services.hermes-agent.environmentFiles via
    # config.sops.secrets."hermes-env".path (referenced from hermes.nix).
    secrets."hermes-env" = {
      format = "dotenv";
      owner = config.services.hermes-agent.user;
      group = config.services.hermes-agent.group;
    };
  };
}
`;
}
