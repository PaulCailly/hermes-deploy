export const CONFIGURATION_NIX = `{ config, pkgs, lib, ... }:
{
  imports = [
    <nixpkgs/nixos/modules/virtualisation/amazon-image.nix>
    "\${builtins.fetchTarball {
      url = \\"https://github.com/NousResearch/hermes-agent/archive/refs/heads/main.tar.gz\\";
    }}/nix/module.nix"
    ./hermes.nix
  ];

  system.stateVersion = "24.05";

  services.openssh = {
    enable = true;
    settings.PasswordAuthentication = false;
    settings.PermitRootLogin = "prohibit-password";
  };

  networking.firewall.enable = true;
}
`;
