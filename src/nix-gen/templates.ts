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

/**
 * configuration.nix is the host-level NixOS config (imports amazon-image
 * so the instance boots correctly as an EC2 VM, enables flakes so
 * nixos-rebuild can re-evaluate the flake later, opens sshd, turns on
 * the firewall). It explicitly does NOT import hermes-agent — the flake
 * does that via the modules list above. It also explicitly does NOT
 * declare any hermes-agent options — those live in ./hermes.nix which
 * is the generator's output.
 */
export const CONFIGURATION_NIX = `{ config, pkgs, lib, modulesPath, ... }:
{
  imports = [
    "\${modulesPath}/virtualisation/amazon-image.nix"
  ];

  nix.settings.experimental-features = [ "nix-command" "flakes" ];

  system.stateVersion = "25.11";

  services.openssh = {
    enable = true;
    settings.PasswordAuthentication = false;
    settings.PermitRootLogin = "prohibit-password";
  };

  networking.firewall.enable = true;

  sops = {
    defaultSopsFile = ./secrets.enc.yaml;
    age.keyFile = "/var/lib/sops-nix/age.key";
  };
}
`;
