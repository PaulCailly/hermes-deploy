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
      ] ++ nixpkgs.lib.optional (builtins.pathExists ./hermes.extra.nix) ./hermes.extra.nix;
    };
  };
}
`;

export interface CachixConfig {
  name: string;
  public_key: string;
}

/**
 * configuration.nix is the host-level NixOS config. It imports the
 * cloud-specific virtualisation module so the instance boots correctly:
 *   - AWS (EC2):  virtualisation/amazon-image.nix
 *   - GCP (GCE):  virtualisation/google-compute-image.nix
 *
 * It enables flakes, opens sshd, turns on the firewall, and wires
 * sops-nix for secret decryption. It explicitly does NOT import
 * hermes-agent — the flake does that via the modules list above.
 *
 * If a Cachix cache is configured (via [hermes.cachix] in hermes.toml),
 * the substituter and trusted-public-key are appended to nix.settings so
 * subsequent rebuilds substitute the hermes-agent closure from binary
 * cache instead of compiling from source.
 */
const VIRT_MODULE: Record<string, string> = {
  aws: 'amazon-image.nix',
  gcp: 'google-compute-image.nix',
};

export function configurationNix(provider: 'aws' | 'gcp', sshPublicKey?: string, cachix?: CachixConfig): string {
  const virtModule = VIRT_MODULE[provider];
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
    "\${modulesPath}/virtualisation/${virtModule}"
  ];

  nix.settings.experimental-features = [ "nix-command" "flakes" ];
${substitutersBlock}
  system.stateVersion = "25.11";

  services.openssh = {
    enable = true;
    settings.PasswordAuthentication = false;
    settings.PermitRootLogin = "prohibit-password";
  };

  # Don't restart sshd during nixos-rebuild activation. The rebuild runs
  # over SSH — if sshd restarts mid-stream, the SSH channel drops and
  # hermes-deploy loses contact with the box. On GCE this is fatal (the
  # stream breaks silently and the process exits 0 without finishing).
  # On AWS it's a race condition that usually works by luck.
  #
  # With restartIfChanged = false, sshd picks up config changes (like
  # PermitRootLogin and authorized_keys) on the NEXT activation, or when
  # the user manually restarts it. authorized_keys.keys are file-based
  # and take effect immediately without an sshd restart — so SSH access
  # is never actually broken; only sshd_config changes are delayed.
  systemd.services.sshd.restartIfChanged = false;
${sshPublicKey ? `
  # Bake the deployment SSH key into the NixOS config so it survives
  # nixos-rebuild activation. On GCE with nixos-infect, the rebuild
  # removes /etc/ssh/authorized_keys.d/root (set by the guest agent
  # on the Debian base). Without this line, root SSH access is lost
  # after the first rebuild. On AWS this is redundant (amazon-image.nix
  # handles it via cloud-init) but harmless.
  users.users.root.openssh.authorizedKeys.keys = [
    "${sshPublicKey}"
  ];` : ''}
${provider === 'gcp' ? `
  # Disable Google OS Login — it conflicts with standard SSH key auth.
  # google-compute-image.nix enables it by default, which adds a PAM
  # module that rejects the session AFTER the SSH key is accepted,
  # causing "Connection closed by ... port 22" on every login attempt.
  # hermes-deploy manages SSH keys via NixOS config (above), not
  # via Google's IAM-based OS Login.
  security.googleOsLogin.enable = false;` : ''}

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
