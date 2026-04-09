{ config, pkgs, lib, ... }:
{
  services.hermes-agent = {
    enable = true;
    model = "anthropic/claude-sonnet-4-5";
    soulFile = ./SOUL.md;

    sops = {
      secretsFile = ./secrets.enc.yaml;
      ageKeyFile = "/var/lib/sops-nix/age.key";
    };

    platforms.discord = {
      enable = true;
      tokenSecretKey = "discord_bot_token";
    };
  };
}
